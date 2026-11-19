/**
 * Sesión de juego: la fachada que une el motor Linux con las reglas del juego.
 *
 * Responsabilidades (orquestación, sin lógica de detalle):
 *   - Construir el sistema simulado a partir de la partida guardada.
 *   - Llevar el ciclo de vida de las misiones (preparar → validar → recompensar).
 *   - Gestionar pistas y desbloqueos.
 *   - Persistir y notificar cambios (a React y por eventos).
 *
 * La lógica de detalle vive en módulos dedicados: progression.ts (números),
 * MissionCatalog (orden), checks.ts (validación), ManualLibrary (manuales).
 */
import type { TerminalControl } from '../../engine/commands/Command';
import type { CommandGate } from '../../engine/commands/CommandGate';
import type { CommandRegistry } from '../../engine/commands/CommandRegistry';
import { createCommandRegistry } from '../../engine/commands/index';
import { Shell, type ExecutionReport } from '../../engine/shell/Shell';
import { CommandHistory } from '../../engine/system/CommandHistory';
import { groupsOf } from '../../engine/system/accounts';
import { provisionSystem } from '../../engine/system/provision';
import { ShellSession } from '../../engine/system/ShellSession';
import { SUPERUSER } from '../../engine/vfs/types';
import { VirtualFileSystem } from '../../engine/vfs/VirtualFileSystem';
import { EventBus } from '../../shared/EventBus';
import { createGameCommands, type GameActions, type HintResult } from '../commands/gameCommands';
import type { MissionWorld } from '../domain/curriculum';
import { finalReward, HINT_COSTS, levelForXp, levelProgress, rankForLevel, starsFor } from '../domain/progression';
import type { CommandDoc } from '../manual/CommandDoc';
import { ManualLibrary } from '../manual/ManualLibrary';
import type { MissionCatalog, MissionLocation } from '../missions/MissionCatalog';
import type { SaveGame } from '../storage/SaveGame';
import type { SaveRepository } from '../storage/SaveRepository';
import type { ActionSource, GameEvents } from './GameEvents';
import type { PlayerView } from './PlayerView';

/** Comandos disponibles desde el principio (necesarios para jugar). */
export const ALWAYS_AVAILABLE: ReadonlySet<string> = new Set(['help', 'mision', 'pista', 'estado']);

export interface GameSessionDependencies {
  save: SaveGame;
  repository: SaveRepository;
  catalog: MissionCatalog;
  docs: readonly CommandDoc[];
}

export class GameSession implements GameActions {
  readonly events = new EventBus<GameEvents>();
  readonly fs: VirtualFileSystem;
  readonly session: ShellSession;
  readonly history: CommandHistory;
  readonly registry: CommandRegistry;
  readonly manuals: ManualLibrary;
  readonly shell: Shell;
  readonly catalog: MissionCatalog;

  private readonly save: SaveGame;
  private readonly repository: SaveRepository;
  private readonly unlocked: Set<string>;
  private readonly listeners = new Set<() => void>();
  private cachedView: PlayerView | null = null;
  /** Terminal real (xterm); se conecta cuando la interfaz está lista. */
  private terminal: TerminalControl | null = null;

  constructor(deps: GameSessionDependencies) {
    this.save = deps.save;
    this.repository = deps.repository;
    this.catalog = deps.catalog;
    this.unlocked = new Set(deps.save.unlockedCommands);

    this.session = new ShellSession(deps.save.world.session);
    this.fs = new VirtualFileSystem(deps.save.world.fs, { identity: () => this.session.identity() });
    // Completa el sistema con lo que necesitan los capítulos nuevos (idempotente).
    provisionSystem(this.fs, deps.save.player.username, this.session.hostname);
    if (this.session.depth === 0 && this.session.username === deps.save.player.username) {
      this.session.setGroups(groupsOf(this.fs, this.session.username));
    }
    this.history = new CommandHistory(deps.save.world.history);
    this.manuals = new ManualLibrary(deps.docs, (name) => this.isUnlocked(name));
    this.registry = createCommandRegistry({ manuals: this.manuals, extra: createGameCommands(this) });

    const gate: CommandGate = {
      // Un alias hereda el estado de su comando principal (ej. 'ayuda' → 'help').
      isAllowed: (name) => this.isUnlocked(this.registry.get(name)?.name ?? name),
    };
    const terminalProxy: TerminalControl = {
      clear: () => this.terminal?.clear(),
      columns: () => this.terminal?.columns() ?? 80,
      readLine: (prompt, options) => this.terminal?.readLine?.(prompt, options) ?? Promise.resolve(null),
      edit: (filename, content) => this.terminal?.edit?.(filename, content) ?? Promise.resolve(null),
    };
    this.shell = new Shell({
      fs: this.fs, session: this.session, history: this.history,
      registry: this.registry, gate, terminal: terminalProxy,
    });
  }

  // ───────────────────────────── Integración con la UI ─────────────────────────────

  attachTerminal(terminal: TerminalControl): void {
    this.terminal = terminal;
  }

  /** Suscripción para React (useSyncExternalStore). */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Vista inmutable; mantiene la misma referencia mientras nada cambie. */
  view = (): PlayerView => {
    this.cachedView ??= this.buildView();
    return this.cachedView;
  };

  isUnlocked(name: string): boolean {
    return ALWAYS_AVAILABLE.has(name) || this.unlocked.has(name);
  }

  /** Nombres que el autocompletado puede sugerir. */
  availableCommandNames(): string[] {
    return this.registry.list().filter((c) => this.isUnlocked(c.name)).flatMap((c) => [c.name, ...(c.aliases ?? [])]);
  }

  // ───────────────────────────── Ciclo de misiones ─────────────────────────────

  /**
   * Garantiza que hay una misión activa y la anuncia.
   * Se llama al iniciar la terminal y tras completar cada misión.
   * @returns la misión activa o undefined si no queda contenido.
   */
  startCurrentMission(): MissionLocation | undefined {
    let active = this.save.activeMission;
    if (!active || this.save.completedMissions[active.id] || !this.catalog.locate(active.id)) {
      const next = this.catalog.nextPending(this.save.completedMissions);
      if (!next) {
        this.save.activeMission = null;
        this.commit();
        this.events.emit('allMissionsCompleted', { total: this.catalog.size });
        return undefined;
      }
      active = { id: next.mission.id, hintsRevealed: 0, setupApplied: false };
      this.save.activeMission = active;
    }

    const location = this.catalog.locate(active.id)!;
    const resumed = active.setupApplied;
    if (!resumed) {
      this.prepareMission(location);
      active.setupApplied = true;
    }
    this.commit();
    this.events.emit('missionStarted', { location, resumed });
    return location;
  }

  /** Procesa el resultado de cada línea ejecutada en la terminal. */
  handleReport(report: ExecutionReport): void {
    if (report.commands.length === 0 && report.exitCode === 0) return;
    const success = report.exitCode === 0;
    this.save.stats.commandsExecuted++;
    if (!success) this.save.stats.commandErrors++;
    this.events.emit('commandExecuted', { report, success });

    const location = this.activeLocation();
    // El validador ve el sistema entero (como root), aunque el jugador no tenga permisos.
    const passed = location !== undefined && this.fs.privileged(() => {
      try {
        return location.mission.check({ report, fs: this.fs, session: this.session });
      } catch (error) {
        console.error(`[misión ${location.mission.id}] Error al validar:`, error);
        return false;
      }
    });
    if (location && passed) {
      this.completeMission(location);
    }
    this.commit();
  }

  revealHint(source: ActionSource): HintResult {
    const active = this.save.activeMission;
    const location = this.activeLocation();
    if (!active || !location) return this.rejectHint({ ok: false, reason: 'no-mission', points: this.save.points }, source);

    const index = active.hintsRevealed;
    if (index >= HINT_COSTS.length) return this.rejectHint({ ok: false, reason: 'no-more', points: this.save.points }, source);

    const cost = HINT_COSTS[index];
    if (this.save.points < cost) return this.rejectHint({ ok: false, reason: 'no-points', cost, points: this.save.points }, source);

    this.save.points -= cost;
    active.hintsRevealed++;
    const text = location.mission.hints[index];
    this.commit();
    this.events.emit('hintRevealed', { index, text, cost, source });
    return { ok: true, index, text, cost, remainingPoints: this.save.points };
  }

  /**
   * Restaura el escenario de la misión tal como estaba al empezar
   * (por si el jugador lo rompió) y lo anuncia.
   */
  restartMission(source: ActionSource): boolean {
    const location = this.activeLocation();
    if (!location) return false;
    this.prepareMission(location, true);
    // Si estaba dentro de un directorio que se ha borrado, vuelve a su home.
    if (!this.fs.isDirectory(this.session.cwd)) this.session.changeDirectory(this.session.home);
    this.commit();
    this.events.emit('missionRestarted', { location, source });
    return true;
  }

  /** JSON de la partida para descargar como copia de seguridad. */
  exportSave(): string {
    this.syncWorld();
    return JSON.stringify(this.save, null, 2);
  }

  /** Guarda el estado actual (también se llama al cerrar la pestaña). */
  persist(): void {
    this.syncWorld();
    this.repository.save(this.save);
  }

  // ─────────────────────────────── Internos ───────────────────────────────

  private activeLocation(): MissionLocation | undefined {
    const id = this.save.activeMission?.id;
    return id ? this.catalog.locate(id) : undefined;
  }

  private prepareMission(location: MissionLocation, resetting = false): void {
    const newlyUnlocked = location.mission.teaches.filter((c) => !this.unlocked.has(c));
    newlyUnlocked.forEach((c) => this.unlocked.add(c));
    this.save.unlockedCommands = [...this.unlocked];
    if (newlyUnlocked.length) this.events.emit('commandsUnlocked', { commands: newlyUnlocked });

    const world: MissionWorld = {
      fs: this.fs,
      session: this.session,
      asRoot: (fn) => this.session.runAs({ user: SUPERUSER, groups: [SUPERUSER] }, fn),
      resetting,
    };
    try {
      location.mission.setup?.(world);
    } catch (error) {
      console.error(`[misión ${location.mission.id}] Error al preparar el escenario:`, error);
    }
  }

  private completeMission(location: MissionLocation): void {
    const hintsUsed = this.save.activeMission?.hintsRevealed ?? 0;
    const stars = starsFor(hintsUsed);
    const reward = finalReward(location.mission.reward, hintsUsed);
    const previousLevel = levelForXp(this.save.xp);

    this.save.xp += reward.xp;
    this.save.points += reward.points;
    this.save.completedMissions[location.mission.id] = { stars, hintsUsed, completedAt: Date.now() };
    this.save.activeMission = null;

    this.events.emit('missionCompleted', { location, stars, reward });
    if (location.isLastOfChapter) this.events.emit('chapterCompleted', { location });

    const level = levelForXp(this.save.xp);
    if (level > previousLevel) {
      const rank = rankForLevel(level);
      this.events.emit('levelUp', { level, rank, rankChanged: rank !== rankForLevel(previousLevel) });
    }
  }

  private rejectHint(result: Extract<HintResult, { ok: false }>, source: ActionSource): HintResult {
    this.events.emit('hintRejected', { reason: result.reason, cost: result.cost, source });
    return result;
  }

  /** Copia el estado vivo del motor a la partida. */
  private syncWorld(): void {
    this.save.world = { fs: this.fs.snapshot(), session: this.session.snapshot(), history: [...this.history.list()] };
    this.save.unlockedCommands = [...this.unlocked];
  }

  /** Invalida la vista, guarda y avisa a los suscriptores. */
  private commit(): void {
    this.cachedView = null;
    this.persist();
    this.listeners.forEach((l) => l());
  }

  private buildView(): PlayerView {
    const progress = levelProgress(this.save.xp);
    const active = this.save.activeMission;
    const location = this.activeLocation();

    return {
      displayName: this.save.player.displayName,
      username: this.save.player.username,
      xp: this.save.xp,
      points: this.save.points,
      level: progress.level,
      rank: rankForLevel(progress.level),
      xpInLevel: progress.current,
      xpRequired: progress.required,
      levelRatio: progress.ratio,
      unlockedCommands: [...this.unlocked],
      completedMissions: { ...this.save.completedMissions },
      completedCount: Object.keys(this.save.completedMissions).length,
      totalMissions: this.catalog.size,
      currentMission: location && active ? {
        id: location.mission.id,
        title: location.mission.title,
        objective: location.mission.objective,
        difficulty: location.mission.difficulty,
        boss: location.mission.boss ?? false,
        moduleTitle: location.module.title,
        chapterNumber: location.chapter.number,
        chapterTitle: location.chapter.title,
        missionNumber: location.chapter.missions.indexOf(location.mission) + 1,
        chapterMissionCount: location.chapter.missions.length,
        revealedHints: location.mission.hints.slice(0, active.hintsRevealed),
        nextHintCost: active.hintsRevealed < HINT_COSTS.length ? HINT_COSTS[active.hintsRevealed] : null,
      } : null,
    };
  }
}
