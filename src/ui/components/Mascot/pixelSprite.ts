/**
 * N0X estilo arcade: sprite de cuerpo entero de 16×20 píxeles, al estilo de
 * los personajes de las recreativas de 8 bits (cabeza grande, contorno negro,
 * colores vivos y animación de pocos fotogramas).
 *
 * El sprite base no tiene ojos: se "pintan" encima según el estado de ánimo,
 * el fotograma y hacia dónde mira. Las piernas tienen dos poses (quieto y
 * paso) para marchar en el sitio. Todo es lógica pura, sin React.
 *
 * Paleta (cada carácter es un píxel):
 *   .  transparente       K  contorno
 *   H  capucha clara      P  capucha/sudadera   Q  sombra de la tela
 *   F  rostro (sombra)    S  cordón             A  puntera del cordón
 *   G  guante             N  pantalón           Z  zapatilla
 *   E  ojo                W  brillo del ojo     Y  ojo preocupado
 *   T  puntos de "pensando"
 */
import type { MascotMood } from '../../../game/mascot/MascotDirector';

export const SPRITE_WIDTH = 16;
export const SPRITE_HEIGHT = 20;

// prettier-ignore
const UPPER_BODY: readonly string[] = [
  '....KKKKKKKK....', //  0  capucha
  '...KHHPPPPPPK...', //  1
  '..KHPPPPPPPPQK..', //  2
  '.KHPPKKKKKKPPQK.', //  3  borde de la abertura
  '.KHPKFFFFFFKPQK.', //  4
  '.KPKFFFFFFFFKPK.', //  5
  '.KPKFFFFFFFFKPK.', //  6  ojos
  '.KPKFFFFFFFFKPK.', //  7  ojos
  '.KPKFFFFFFFFKQK.', //  8
  '.KPQKFFFFFFKQQK.', //  9
  '..KPQKKKKKKQQK..', // 10  barbilla
  '..KKPPSPPSPPKK..', // 11  hombros y cordones
  '.KHKPPSPPSPPKQK.', // 12  brazos
  '.KHKPPAPPAPPKQK.', // 13  punteras
  '.KGKPPPPPPPPKGK.', // 14  guantes
  '..KKQQQQQQQQKK..', // 15  bajo de la sudadera
];

/** Piernas: pose quieta y pose de paso (para marchar en el sitio). */
// prettier-ignore
const LEGS_STAND: readonly string[] = [
  '...KNNNKKNNNK...', // 16
  '...KNNK..KNNK...', // 17
  '..KZZZK..KZZZK..', // 18
  '..KKKKK..KKKKK..', // 19
];
// prettier-ignore
const LEGS_STEP: readonly string[] = [
  '...KNNNKKNNNK...',
  '..KNNK....KNNK..',
  '.KZZZK....KZZZK.',
  '.KKKKK....KKKKK.',
];

export const BASE_SPRITE: readonly string[] = [...UPPER_BODY, ...LEGS_STAND];

/** Columna izquierda de cada ojo (2 px de ancho) y fila superior. */
export const EYES = { leftX: 5, rightX: 9, y: 6 } as const;

type Pixel = readonly [dx: number, dy: number, code: string];

/** Patrones de ojo: píxeles relativos a la esquina superior izquierda del ojo. */
const EYE_OPEN: readonly Pixel[] = [[0, 0, 'W'], [1, 0, 'E'], [0, 1, 'E'], [1, 1, 'E']];
const EYE_BRIGHT: readonly Pixel[] = [[0, 0, 'W'], [1, 0, 'W'], [0, 1, 'E'], [1, 1, 'E']];
const EYE_BLINK: readonly Pixel[] = [[0, 1, 'E'], [1, 1, 'E']];
const EYE_HAPPY: readonly Pixel[] = [[0, 0, 'E'], [1, 0, 'E'], [-1, 1, 'E'], [2, 1, 'E']];
const EYE_BIG: readonly Pixel[] = [[0, -1, 'E'], [1, -1, 'E'], [0, 0, 'W'], [1, 0, 'W'], [0, 1, 'E'], [1, 1, 'E']];
const EYE_SQUINT: readonly Pixel[] = [[0, 1, 'E'], [1, 1, 'E']];
// Preocupado: inclinados hacia fuera.
const EYE_WORRIED_LEFT: readonly Pixel[] = [[1, 0, 'Y'], [0, 1, 'Y'], [1, 1, 'Y']];
const EYE_WORRIED_RIGHT: readonly Pixel[] = [[0, 0, 'Y'], [0, 1, 'Y'], [1, 1, 'Y']];

/** Velocidad de la animación por estado de ánimo (ms por fotograma). */
export const FRAME_MS: Record<MascotMood, number> = {
  idle: 420,
  talking: 200,
  happy: 220,
  excited: 110,
  thinking: 380,
  worried: 200,
};

/** Cada cuántos fotogramas parpadea en reposo. */
const BLINK_EVERY = 10;

/** Altura de cada fotograma del salto (en píxeles del sprite). */
const JUMP_ARC = [0, -2, -4, -5, -4, -2, 0, 0] as const;

function eyesFor(mood: MascotMood, frame: number): [readonly Pixel[], readonly Pixel[]] {
  switch (mood) {
    case 'happy':
      return [EYE_HAPPY, EYE_HAPPY];
    case 'excited':
      return [EYE_BIG, EYE_BIG];
    case 'talking':
      return frame % 2 === 0 ? [EYE_OPEN, EYE_OPEN] : [EYE_BRIGHT, EYE_BRIGHT];
    case 'thinking':
      return [EYE_OPEN, EYE_SQUINT];
    case 'worried':
      return [EYE_WORRIED_LEFT, EYE_WORRIED_RIGHT];
    default:
      return frame % BLINK_EVERY === BLINK_EVERY - 1 ? [EYE_BLINK, EYE_BLINK] : [EYE_OPEN, EYE_OPEN];
  }
}

/** Velocidad de la animación de piernas mientras camina (ms por fotograma). */
export const WALK_FRAME_MS = 170;

/** ¿Las piernas están en pose de paso en este fotograma? */
function isStepping(mood: MascotMood, frame: number, walking: boolean): boolean {
  if (walking) return frame % 2 === 1;
  if (mood === 'talking' || mood === 'happy') return frame % 2 === 1; // marcha en el sitio
  if (mood === 'excited') return JUMP_ARC[frame % JUMP_ARC.length] < 0; // piernas abiertas en el aire
  return false;
}

/**
 * Devuelve el sprite del fotograma con los ojos pintados.
 * @param lookX -1, 0 o 1: los ojos se desplazan un píxel hacia el cursor.
 * @param walking si está caminando, las piernas alternan las dos poses.
 */
export function paintSprite(mood: MascotMood, frame: number, lookX: -1 | 0 | 1, walking = false): string[] {
  const legs = isStepping(mood, frame, walking) ? LEGS_STEP : LEGS_STAND;
  const grid = [...UPPER_BODY, ...legs].map((row) => row.split(''));
  const set = (x: number, y: number, code: string): void => {
    if (y >= 0 && y < SPRITE_HEIGHT && x >= 0 && x < SPRITE_WIDTH) grid[y][x] = code;
  };

  // Con los ojos en arco o muy abiertos no se desplazan (se saldrían del rostro).
  const shift = mood === 'happy' || mood === 'excited' ? 0 : lookX;
  const [left, right] = eyesFor(mood, frame);
  for (const [dx, dy, code] of left) set(EYES.leftX + shift + dx, EYES.y + dy, code);
  for (const [dx, dy, code] of right) set(EYES.rightX + shift + dx, EYES.y + dy, code);
  return grid.map((row) => row.join(''));
}

/** Puntos suspensivos al pensar: aparecen uno a uno fuera del sprite (arriba a la derecha). */
export function thinkingDots(frame: number): PixelRun[] {
  const dots: readonly [number, number][] = [[14, 2], [16, 0], [18, -2]];
  const visible = Math.min((frame % 4) + 1, dots.length); // 1, 2, 3, 3 y vuelta a empezar
  return dots.slice(0, visible).map(([x, y]) => ({ x, y, width: 1, code: 'T' }));
}

/** Desplazamiento vertical: saltos al emocionarse, botecitos al hablar o caminar y respiración en reposo. */
export function bobOffset(mood: MascotMood, frame: number, walking = false): number {
  if (walking) return frame % 2 === 0 ? 0 : -1;
  if (mood === 'excited') return JUMP_ARC[frame % JUMP_ARC.length];
  if (mood === 'talking' || mood === 'happy') return frame % 2 === 0 ? 0 : -1;
  if (mood === 'idle') return frame % 4 < 2 ? 0 : -0.5;
  return 0;
}

/** Desplazamiento horizontal: tiembla cuando está preocupado. */
export function shakeOffset(mood: MascotMood, frame: number): number {
  if (mood !== 'worried') return 0;
  return frame % 4 === 0 ? -0.5 : frame % 4 === 2 ? 0.5 : 0;
}

export interface PixelRun {
  x: number;
  y: number;
  width: number;
  code: string;
}

/**
 * Agrupa píxeles contiguos del mismo color en rectángulos horizontales
 * para dibujar muchos menos elementos <rect>.
 */
export function toRuns(rows: readonly string[]): PixelRun[] {
  const runs: PixelRun[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const code = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === code) end++;
      if (code !== '.') runs.push({ x, y, width: end - x, code });
      x = end;
    }
  });
  return runs;
}
