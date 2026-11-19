/**
 * Persistencia de la partida en localStorage.
 *
 * - Tolera datos corruptos o navegadores sin almacenamiento (modo incógnito):
 *   en ese caso el juego sigue funcionando, solo que sin guardar.
 * - Aplica migraciones al cargar partidas antiguas.
 */
import { migrate } from './migrations';
import { isSaveGame, type SaveGame } from './SaveGame';
import type { SaveRepository } from './SaveRepository';

export const STORAGE_KEY = 'devops-university:save';

/** Subconjunto de la API Storage que necesitamos (facilita los tests). */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export class LocalStorageSaveRepository implements SaveRepository {
  private readonly storage: KeyValueStorage | null;
  private readonly key: string;

  constructor(storage?: KeyValueStorage | null, key = STORAGE_KEY) {
    this.storage = storage === undefined ? safeLocalStorage() : storage;
    this.key = key;
  }

  load(): SaveGame | null {
    try {
      const raw = this.storage?.getItem(this.key);
      if (!raw) return null;
      return parseSave(raw);
    } catch (error) {
      console.warn('[save] No se pudo cargar la partida:', error);
      return null;
    }
  }

  save(game: SaveGame): void {
    try {
      this.storage?.setItem(this.key, JSON.stringify(game));
    } catch (error) {
      // Puede ocurrir si se supera la cuota de almacenamiento.
      console.warn('[save] No se pudo guardar la partida:', error);
    }
  }

  clear(): void {
    try {
      this.storage?.removeItem(this.key);
    } catch {
      /* almacenamiento no disponible: nada que borrar */
    }
  }
}

/** Convierte un JSON (de localStorage o de un archivo importado) en una partida válida. */
export function parseSave(json: string): SaveGame {
  const data: unknown = JSON.parse(json);
  if (typeof data !== 'object' || data === null || typeof (data as { version?: unknown }).version !== 'number') {
    throw new Error('El archivo no es una partida de DevOps University');
  }
  const migrated = migrate(data as Record<string, unknown> & { version: number });
  if (!isSaveGame(migrated)) throw new Error('La partida está incompleta o dañada');
  return migrated;
}

function safeLocalStorage(): KeyValueStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}
