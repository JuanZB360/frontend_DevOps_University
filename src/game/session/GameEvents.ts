/**
 * Catálogo de eventos que emite el juego. Cualquier parte de la app
 * (terminal, mascota, interfaz, futura sincronización) puede escucharlos.
 */
import type { ExecutionReport } from '../../engine/shell/Shell';
import type { Reward } from '../domain/curriculum';
import type { Stars } from '../domain/progression';
import type { MissionLocation } from '../missions/MissionCatalog';

/** Origen de una acción: escrita en la terminal o pulsada en la interfaz. */
export type ActionSource = 'terminal' | 'ui';

export interface GameEvents {
  /** Comienza (o se retoma tras recargar) una misión. */
  missionStarted: { location: MissionLocation; resumed: boolean };
  missionCompleted: { location: MissionLocation; stars: Stars; reward: Reward };
  chapterCompleted: { location: MissionLocation };
  /** Se completaron todas las misiones disponibles por ahora. */
  allMissionsCompleted: { total: number };
  levelUp: { level: number; rank: string; rankChanged: boolean };
  commandsUnlocked: { commands: string[] };
  hintRevealed: { index: number; text: string; cost: number; source: ActionSource };
  /** El jugador restauró el escenario de la misión actual. */
  missionRestarted: { location: MissionLocation; source: ActionSource };
  hintRejected: { reason: 'no-points' | 'no-more' | 'no-mission'; cost?: number; source: ActionSource };
  /** Tras cada línea ejecutada en la terminal. */
  commandExecuted: { report: ExecutionReport; success: boolean };
}
