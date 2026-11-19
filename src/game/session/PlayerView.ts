/**
 * Vista inmutable del estado del jugador para la interfaz.
 * React la lee con useSyncExternalStore; solo cambia de referencia cuando
 * algo cambia de verdad, evitando renderizados innecesarios.
 */
import type { Difficulty } from '../domain/curriculum';
import type { MissionRecord } from '../storage/SaveGame';

export interface CurrentMissionView {
  id: string;
  title: string;
  objective: string;
  difficulty: Difficulty;
  boss: boolean;
  moduleTitle: string;
  chapterNumber: number;
  chapterTitle: string;
  /** Posición dentro del capítulo (1-based) y total del capítulo. */
  missionNumber: number;
  chapterMissionCount: number;
  revealedHints: readonly string[];
  /** Coste de la siguiente pista o null si ya se revelaron todas. */
  nextHintCost: number | null;
}

export interface PlayerView {
  displayName: string;
  username: string;
  xp: number;
  points: number;
  level: number;
  rank: string;
  xpInLevel: number;
  xpRequired: number;
  levelRatio: number;
  unlockedCommands: readonly string[];
  completedMissions: Readonly<Record<string, MissionRecord>>;
  completedCount: number;
  totalMissions: number;
  currentMission: CurrentMissionView | null;
}
