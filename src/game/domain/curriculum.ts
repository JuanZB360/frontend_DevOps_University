/**
 * Modelo del plan de estudios: Módulo → Capítulo → Misión.
 *
 *   Módulo   = una "carrera" (Linux, Nginx, Docker, Git, CI/CD...)
 *   Capítulo = un tema dentro del módulo (ej. "Manipular archivos")
 *   Misión   = un reto concreto que se valida contra el estado del sistema
 *
 * Las misiones son DATOS + funciones de validación puras. Añadir contenido
 * nuevo nunca requiere tocar el motor ni la interfaz.
 */
import type { ExecutionReport } from '../../engine/shell/Shell';
import type { ShellSession } from '../../engine/system/ShellSession';
import type { VirtualFileSystem } from '../../engine/vfs/VirtualFileSystem';

export type ModuleId = 'linux' | 'nginx' | 'docker' | 'git' | 'cicd' | 'databases' | 'monitoring' | 'iac' | 'kubernetes';

export type Difficulty = 1 | 2 | 3 | 4 | 5;

export interface Reward {
  xp: number;
  points: number;
}

/** Lo que una misión puede manipular al prepararse. */
export interface MissionWorld {
  fs: VirtualFileSystem;
  session: ShellSession;
  /** Ejecuta una preparación como root (para crear archivos fuera del home). */
  asRoot<T>(fn: () => T): T;
  /**
   * true cuando el jugador pulsa "Reiniciar escenario": los ayudantes de
   * preparación borran lo que el jugador cambió y lo recrean desde cero.
   */
  resetting: boolean;
}

/** Lo que recibe la validación tras cada línea ejecutada. */
export interface ValidationContext {
  report: ExecutionReport;
  fs: VirtualFileSystem;
  session: ShellSession;
}

/** Función pura que decide si la misión está cumplida. */
export type MissionCheck = (ctx: ValidationContext) => boolean;

export interface Mission {
  /** Identificador estable (no cambiar: se guarda en el progreso). Formato: modulo-capitulo-numero. */
  id: string;
  title: string;
  difficulty: Difficulty;
  /** Comandos que se desbloquean al comenzar la misión (su explicación aparece en el briefing). */
  teaches: readonly string[];
  /** Texto que se escribe en la terminal al empezar. Admite `código` entre comillas invertidas. */
  briefing: readonly string[];
  /** Objetivo en una frase (se muestra en el panel de misión). */
  objective: string;
  /** Tres pistas de menor a mayor ayuda. La tercera es prácticamente la solución. */
  hints: readonly [string, string, string];
  /**
   * Una solución válida, ejecutable tal cual. No se muestra al jugador:
   * los tests la usan para garantizar que toda misión se puede superar.
   */
  solution: string;
  /** Prepara el escenario (crear archivos, cambiar de directorio...). Debe ser idempotente. */
  setup?: (world: MissionWorld) => void;
  check: MissionCheck;
  /** Mensaje al completarla. */
  success: string;
  reward: Reward;
  /** Las misiones jefe cierran un capítulo y son más difíciles. */
  boss?: boolean;
}

export interface Chapter {
  id: string;
  number: number;
  title: string;
  description: string;
  missions: readonly Mission[];
}

export interface CurriculumModule {
  id: ModuleId;
  title: string;
  tagline: string;
  /** Rango que se obtiene al completar el módulo. */
  graduationRank: string;
  chapters: readonly Chapter[];
  /** Capítulos previstos que aún no tienen misiones (se muestran como "próximamente"). */
  upcoming: readonly string[];
}

/** Recompensa estándar según dificultad (las misiones jefe dan el doble). */
export function rewardFor(difficulty: Difficulty, boss = false): Reward {
  const multiplier = boss ? 2 : 1;
  return { xp: (30 + difficulty * 20) * multiplier, points: (5 + difficulty * 5) * multiplier };
}
