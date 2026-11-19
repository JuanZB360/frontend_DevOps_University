/**
 * Formato de la partida guardada.
 *
 * ⚠ Si cambias esta estructura, incrementa SAVE_VERSION y añade una migración
 * en `migrations.ts`. Así nadie pierde su progreso al actualizar la app.
 */
import type { SessionSnapshot } from '../../engine/system/ShellSession';
import type { DirNode } from '../../engine/vfs/types';
import type { Stars } from '../domain/progression';

export const SAVE_VERSION = 1;

export interface MissionRecord {
  stars: Stars;
  hintsUsed: number;
  completedAt: number;
}

export interface ActiveMission {
  id: string;
  /** Cuántas pistas se han comprado (0 a 3). */
  hintsRevealed: number;
  /** Si ya se preparó el escenario (para no repetirlo al recargar). */
  setupApplied: boolean;
}

export interface SaveGame {
  version: number;
  player: {
    /** Nombre mostrado, tal como lo escribió el jugador. */
    displayName: string;
    /** Usuario Linux derivado del nombre (minúsculas, sin espacios). */
    username: string;
    createdAt: number;
  };
  xp: number;
  points: number;
  unlockedCommands: string[];
  completedMissions: Record<string, MissionRecord>;
  activeMission: ActiveMission | null;
  /** Estado completo del "servidor" del jugador. */
  world: {
    fs: DirNode;
    session: SessionSnapshot;
    history: string[];
  };
  stats: {
    commandsExecuted: number;
    commandErrors: number;
  };
}

/** Validación estructural mínima (para importar archivos o leer datos corruptos). */
export function isSaveGame(value: unknown): value is SaveGame {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<SaveGame>;
  return (
    typeof v.version === 'number' &&
    typeof v.player?.username === 'string' &&
    typeof v.xp === 'number' &&
    typeof v.points === 'number' &&
    Array.isArray(v.unlockedCommands) &&
    typeof v.completedMissions === 'object' &&
    v.world?.fs?.type === 'dir' &&
    typeof v.world?.session?.cwd === 'string'
  );
}
