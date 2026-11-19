/**
 * Reglas de progresión: experiencia, niveles, rangos, estrellas y pistas.
 * Son funciones puras: fáciles de testear y de ajustar para balancear el juego.
 */
import type { Reward } from './curriculum';

/** XP necesaria para pasar del nivel `level` al siguiente: 100, 150, 200, 250... */
export function xpForNextLevel(level: number): number {
  return 100 + (level - 1) * 50;
}

/** XP acumulada necesaria para alcanzar `level` (el nivel 1 empieza en 0). */
export function totalXpForLevel(level: number): number {
  const steps = level - 1;
  return 100 * steps + 25 * steps * (steps - 1);
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (totalXpForLevel(level + 1) <= xp) level++;
  return level;
}

export interface LevelProgress {
  level: number;
  /** XP ganada dentro del nivel actual. */
  current: number;
  /** XP total que requiere el nivel actual. */
  required: number;
  /** De 0 a 1, para la barra de progreso. */
  ratio: number;
}

export function levelProgress(xp: number): LevelProgress {
  const level = levelForXp(xp);
  const current = xp - totalXpForLevel(level);
  const required = xpForNextLevel(level);
  return { level, current, required, ratio: current / required };
}

/** Rangos de la "universidad". Se obtienen al alcanzar el nivel indicado. */
export const RANKS: readonly { minLevel: number; title: string }[] = [
  { minLevel: 1, title: 'Script Kiddie' },
  { minLevel: 3, title: 'Novato' },
  { minLevel: 6, title: 'Operador' },
  { minLevel: 10, title: 'Sysadmin Jr' },
  { minLevel: 15, title: 'Sysadmin' },
  { minLevel: 20, title: 'Root' },
  { minLevel: 25, title: 'Web Master' },
  { minLevel: 32, title: 'Container Captain' },
  { minLevel: 38, title: 'Git Guardian' },
  { minLevel: 44, title: 'Pipeline Pilot' },
  { minLevel: 50, title: 'DevOps Architect' },
];

export function rankForLevel(level: number): string {
  return [...RANKS].reverse().find((r) => level >= r.minLevel)?.title ?? RANKS[0].title;
}

/** Puntos con los que empieza un jugador (suficiente para una primera pista). */
export const STARTING_POINTS = 30;

/** Coste en puntos de cada pista: conceptual, de comando y solución. */
export const HINT_COSTS: readonly [number, number, number] = [10, 25, 50];

export type Stars = 1 | 2 | 3;

/** Estrellas según las pistas usadas: 0 → ★★★, 1-2 → ★★, 3 (solución) → ★. */
export function starsFor(hintsUsed: number): Stars {
  if (hintsUsed === 0) return 3;
  if (hintsUsed < 3) return 2;
  return 1;
}

/**
 * Recompensa final según las pistas usadas. Ver la solución reduce la XP a la mitad
 * para que siga valiendo la pena intentarlo solo.
 */
export function finalReward(base: Reward, hintsUsed: number): Reward {
  const xpFactor = [1, 0.9, 0.75, 0.5][Math.min(hintsUsed, 3)];
  const bonus = hintsUsed === 0 ? Math.round(base.points * 0.5) : 0;
  return { xp: Math.round(base.xp * xpFactor), points: base.points + bonus };
}
