/**
 * Persistencia de la partida en el servidor (base de datos PostgreSQL).
 *
 * Implementa el mismo puerto `SaveRepository` que localStorage, así que el
 * juego no sabe que ahora guarda en la nube (Inversión de Dependencias).
 *
 * Cómo guarda:
 * - `save()` es síncrono para el juego: solo marca la partida como pendiente
 *   y la envía en segundo plano.
 * - Los envíos van en serie (nunca dos a la vez) y siempre con la versión más
 *   reciente: si el jugador ejecuta 10 comandos seguidos mientras hay un envío
 *   en curso, después solo se manda uno con el estado final.
 * - Sin conexión, reintenta cada pocos segundos sin perder nada.
 * - Si la sesión deja de ser válida (token borrado, caducado o cerrado en
 *   otra pestaña) deja de guardar y avisa con `onSessionLost`.
 */
import { levelForXp } from '../domain/progression';
import type { SaveGame } from './SaveGame';
import type { SaveRepository } from './SaveRepository';

/** Estado de la sincronización, para mostrarlo en la interfaz. */
export type SyncStatus = 'saved' | 'saving' | 'offline' | 'conflict';

/** Motivo por el que el servidor no aceptó la partida. */
export type PushFailure = 'unauthorized' | 'conflict' | 'network';

export class ProgressPushError extends Error {
  readonly reason: PushFailure;

  constructor(reason: PushFailure, message: string = reason) {
    super(message);
    this.name = 'ProgressPushError';
    this.reason = reason;
  }
}

/** Puerto hacia el servidor: lo implementa la capa de autenticación con fetch. */
export interface ProgressGateway {
  /**
   * Envía la partida. Debe rechazar con `ProgressPushError`.
   * @param replace sustituir aunque tenga menos XP (reiniciar o importar)
   * @param keepalive la pestaña se está cerrando
   */
  push(save: SaveGame, replace: boolean, keepalive: boolean): Promise<void>;
}

export interface RemoteSaveOptions {
  /** ¿Sigue existiendo la sesión en este navegador? */
  isSessionAlive: () => boolean;
  /** Se llama una sola vez cuando la sesión deja de ser válida. */
  onSessionLost: () => void;
  /** Espera entre reintentos sin conexión. */
  retryMs?: number;
}

/** Resumen que el servidor guarda en columnas propias (para el ranking). */
export function progressSummary(save: SaveGame) {
  return {
    xp: save.xp,
    level: levelForXp(save.xp),
    points: save.points,
    completedMissions: Object.keys(save.completedMissions).length,
  };
}

export class RemoteSaveRepository implements SaveRepository {
  private latest: SaveGame;
  private dirty = false;
  private replaceNext = false;
  private closed = false;
  private running: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private status: SyncStatus = 'saved';
  private readonly listeners = new Set<() => void>();
  private readonly gateway: ProgressGateway;
  private readonly options: Required<RemoteSaveOptions>;

  constructor(gateway: ProgressGateway, initial: SaveGame, options: RemoteSaveOptions) {
    this.gateway = gateway;
    this.latest = initial;
    this.options = { retryMs: 5000, ...options };
  }

  load(): SaveGame | null {
    return this.latest;
  }

  save(game: SaveGame): void {
    if (this.closed) return;
    if (!this.options.isSessionAlive()) {
      this.loseSession();
      return;
    }
    this.latest = game;
    this.dirty = true;
    this.kick();
  }

  /**
   * Sustituye la partida del servidor aunque tenga menos progreso.
   * Se usa al reiniciar la partida o importar una copia de seguridad.
   */
  replace(game: SaveGame): void {
    this.replaceNext = true;
    this.save(game);
  }

  /** En el servidor la partida se sustituye con `replace`; no hay nada que borrar. */
  clear(): void {}

  /**
   * Espera a que todo lo pendiente llegue al servidor (antes de cerrar sesión).
   * @returns true si quedó todo guardado
   */
  async flush(): Promise<boolean> {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.dirty) this.kick();
    await this.running;
    return !this.dirty && this.status === 'saved';
  }

  /**
   * Último intento al cerrar la pestaña: `keepalive` deja que la petición
   * termine aunque la página ya no exista.
   */
  flushOnUnload(): void {
    if (this.closed || (!this.dirty && !this.running)) return;
    if (!this.options.isSessionAlive()) return;
    void this.gateway.push(this.latest, this.replaceNext, true).catch(() => undefined);
  }

  /** Deja de guardar (al cerrar sesión). */
  close(): void {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.listeners.clear();
  }

  getStatus = (): SyncStatus => this.status;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  // ─────────────────────────────── Internos ───────────────────────────────

  private kick(): void {
    // En conflicto no se reintenta: insistir solo generaría errores en el servidor.
    if (this.running || this.retryTimer || this.closed || this.status === 'conflict') return;
    this.running = this.run().finally(() => {
      this.running = null;
      // Algo se guardó justo cuando terminaba el último envío.
      if (this.dirty && !this.retryTimer && !this.closed && this.status !== 'conflict') this.kick();
    });
  }

  private async run(): Promise<void> {
    while (this.dirty && !this.closed) {
      const save = this.latest;
      const replace = this.replaceNext;
      this.dirty = false;
      this.replaceNext = false;
      this.setStatus('saving');
      try {
        await this.gateway.push(save, replace, false);
        if (!this.dirty) this.setStatus('saved');
      } catch (error) {
        const reason = error instanceof ProgressPushError ? error.reason : 'network';
        if (reason === 'unauthorized') {
          this.loseSession();
          return;
        }
        if (reason === 'conflict') {
          // El servidor tiene MÁS progreso (otra pestaña u otro dispositivo):
          // no lo pisamos. La interfaz invita a recargar.
          this.setStatus('conflict');
          return;
        }
        // Sin conexión: se conserva lo pendiente y se reintenta más tarde.
        this.dirty = true;
        this.replaceNext ||= replace;
        this.setStatus('offline');
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          this.kick();
        }, this.options.retryMs);
        return;
      }
    }
  }

  private loseSession(): void {
    if (this.closed) return;
    this.close();
    this.options.onSessionLost();
  }

  private setStatus(status: SyncStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.listeners.forEach((l) => l());
  }
}
