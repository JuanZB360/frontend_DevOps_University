/**
 * Hace que N0X pasee de un lado a otro por el suelo de su pantalla.
 *
 * - Camina solo en reposo (despacio) o contento (más rápido).
 * - Al llegar a un borde se da la vuelta; de vez en cuando se para un rato.
 * - Cuando habla, piensa, se emociona o se preocupa, se queda quieto donde esté.
 * - Respeta `prefers-reduced-motion`: en ese caso no camina.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { MascotMood } from '../../../game/mascot/MascotDirector';

export interface WanderState {
  /** Posición horizontal (px) dentro del suelo. */
  x: number;
  /** Dirección en la que mira o camina: -1 izquierda, 1 derecha. */
  dir: -1 | 1;
  walking: boolean;
}

const TICK_MS = 50;
/** Velocidad en píxeles por tick según el ánimo. */
const SPEED: Partial<Record<MascotMood, number>> = { idle: 1.4, happy: 2.4 };
/** Probabilidad por tick de detenerse un momento. */
const PAUSE_CHANCE = 0.006;
const PAUSE_MS: readonly [number, number] = [1200, 3200];

export function useWander(floor: RefObject<HTMLElement | null>, figureWidth: number, mood: MascotMood): WanderState {
  const [state, setState] = useState<WanderState>({ x: 0, dir: 1, walking: false });
  const pausedUntil = useRef(0);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const speed = SPEED[mood];

    const timer = setInterval(() => {
      const width = floor.current?.clientWidth ?? 0;
      const maxX = Math.max(0, width - figureWidth);
      const now = Date.now();

      setState((prev) => {
        // Se queda quieto (pero sin salirse si la pantalla se estrechó).
        if (reduced || speed === undefined || now < pausedUntil.current || maxX === 0) {
          const x = Math.min(prev.x, maxX);
          return prev.walking || x !== prev.x ? { ...prev, x, walking: false } : prev;
        }
        if (Math.random() < PAUSE_CHANCE) {
          pausedUntil.current = now + PAUSE_MS[0] + Math.random() * (PAUSE_MS[1] - PAUSE_MS[0]);
          return { ...prev, walking: false };
        }
        let x = prev.x + prev.dir * speed;
        let dir = prev.dir;
        if (x <= 0) {
          x = 0;
          dir = 1;
        } else if (x >= maxX) {
          x = maxX;
          dir = -1;
        }
        return { x, dir, walking: true };
      });
    }, TICK_MS);

    return () => clearInterval(timer);
  }, [floor, figureWidth, mood]);

  return state;
}
