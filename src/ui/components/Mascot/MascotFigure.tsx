/**
 * N0X estilo consola portátil: sprite de 16×20 píxeles en los 4 tonos de
 * verde de una pantalla LCD clásica, dibujado sobre una pantalla de matriz
 * de puntos y animado por fotogramas.
 *
 * - Marcha en el sitio al hablar, salta al emocionarse y tiembla al preocuparse.
 * - Sus ojos se mueven un píxel hacia donde está el cursor.
 * - La paleta es la misma en todos los temas: es la identidad del personaje.
 *
 * El dibujo y los fotogramas están en `pixelSprite.ts` (lógica pura y testeada);
 * este componente solo gestiona el reloj de la animación y pinta los píxeles.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MascotMood } from '../../../game/mascot/MascotDirector';
import styles from './Mascot.module.css';
import { bobOffset, FRAME_MS, paintSprite, shakeOffset, SPRITE_HEIGHT, SPRITE_WIDTH, thinkingDots, toRuns, WALK_FRAME_MS } from './pixelSprite';
import { useEyeTracking } from './useEyeTracking';

interface Props {
  mood: MascotMood;
  /** Ancho en píxeles de pantalla. */
  size?: number;
  className?: string;
  /** Versión reducida (icono): solo la cabeza, sin animación ni seguimiento de ojos. */
  compact?: boolean;
  /**
   * Si es false, se dibuja solo el personaje, sin su pantalla ni su marco:
   * lo usa la consola del compañero, que pone una única pantalla para N0X y su texto.
   */
  framed?: boolean;
  /** Si está caminando: alterna las piernas y mira hacia `walkDir`. */
  walking?: boolean;
  walkDir?: -1 | 1;
}

/**
 * Los 4 tonos de la pantalla LCD (de más oscuro a más claro).
 * Definidos en global.css como --lcd-0 … --lcd-3.
 */
const LCD = {
  darkest: 'var(--lcd-0)',
  dark: 'var(--lcd-1)',
  light: 'var(--lcd-2)',
  lightest: 'var(--lcd-3)',
} as const;

/** Tono de cada carácter del sprite (ver la paleta en pixelSprite.ts). */
const PIXEL_FILL: Record<string, string> = {
  K: LCD.darkest, // contorno
  H: LCD.lightest, // capucha clara
  P: LCD.light, // sudadera
  Q: LCD.dark, // sombra de la tela
  F: LCD.darkest, // rostro en sombra
  S: LCD.lightest, // cordones
  A: LCD.lightest, // punteras
  G: LCD.lightest, // guantes
  N: LCD.dark, // pantalón
  Z: LCD.light, // zapatillas
  E: LCD.lightest, // ojos
  W: LCD.lightest, // brillo del ojo
  Y: LCD.lightest, // ojos preocupados (la forma ya expresa el ánimo)
  T: LCD.darkest, // puntos de "pensando" (sobre el fondo claro)
};

/** Margen alrededor del sprite: arriba para los saltos, a la derecha para los puntos de pensar. */
const VIEWBOX = `-2 -6 ${SPRITE_WIDTH + 4} ${SPRITE_HEIGHT + 7}`;
/** Recorte de la cabeza para el icono. */
const COMPACT_VIEWBOX = '0 -0.5 16 12';

/** Avanza el fotograma según la velocidad de cada estado de ánimo. */
function useSpriteFrame(mood: MascotMood, enabled: boolean, walking: boolean): number {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!enabled || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => setFrame((f) => f + 1), walking ? WALK_FRAME_MS : FRAME_MS[mood]);
    return () => clearInterval(timer);
  }, [mood, enabled, walking]);

  return frame;
}

export function MascotFigure({ mood, size = 160, className, compact = false, framed = true, walking = false, walkDir = 1 }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const look = useEyeTracking(svgRef, !compact);
  const frame = useSpriteFrame(mood, !compact, walking);

  // Ojos: al caminar miran hacia donde va; si no, siguen al cursor (un píxel a cada lado).
  const cursorX: -1 | 0 | 1 = look.x > 1.5 ? 1 : look.x < -1.5 ? -1 : 0;
  const lookX: -1 | 0 | 1 = walking ? walkDir : cursorX;
  const runs = useMemo(
    () => [...toRuns(paintSprite(mood, frame, lookX, walking)), ...(mood === 'thinking' && !compact ? thinkingDots(frame) : [])],
    [mood, frame, lookX, walking, compact],
  );

  const [, , vbWidth, vbHeight] = (compact ? COMPACT_VIEWBOX : VIEWBOX).split(' ').map(Number);
  const height = (size * vbHeight) / vbWidth;
  const offsetX = compact ? 0 : shakeOffset(mood, frame);
  const offsetY = compact ? 0 : bobOffset(mood, frame, walking);

  // IDs únicos por figura (puede haber varias en la página).
  const patternId = `lcd-${useId().replace(/:/g, '')}`;
  const [vbX, vbY] = (compact ? COMPACT_VIEWBOX : VIEWBOX).split(' ').map(Number);

  return (
    <svg
      ref={svgRef}
      viewBox={compact ? COMPACT_VIEWBOX : VIEWBOX}
      width={size}
      height={height}
      shapeRendering="crispEdges"
      className={`${styles.figure} ${framed ? styles.framed : ''} ${compact ? styles.compact : ''} ${className ?? ''}`}
      role="img"
      aria-label={`N0X, tu guía encapuchado (${mood})`}
    >
      {/* Pantalla LCD: fondo verde claro con la rejilla de la matriz de puntos */}
      <defs>
        <pattern id={patternId} width="1" height="1" patternUnits="userSpaceOnUse">
          <rect width="1" height="1" style={{ fill: LCD.lightest }} />
          <rect width="1" height="0.08" className={styles.lcdGrid} />
          <rect width="0.08" height="1" className={styles.lcdGrid} />
        </pattern>
      </defs>
      {framed && <rect x={vbX} y={vbY} width={vbWidth} height={vbHeight} fill={`url(#${patternId})`} />}

      {/* Sombra en el suelo: se encoge mientras salta */}
      {!compact && (
        <rect
          x={2 - offsetY / 2}
          y={SPRITE_HEIGHT}
          width={SPRITE_WIDTH - 4 + offsetY}
          height="1"
          className={styles.shadow}
        />
      )}
      <g transform={`translate(${offsetX} ${offsetY})`}>
        {runs.map((run) => (
          <rect
            key={`${run.x}-${run.y}`}
            x={run.x}
            y={run.y}
            width={run.width}
            height={1}
            style={{ fill: PIXEL_FILL[run.code] }}
          />
        ))}
      </g>
    </svg>
  );
}
