/**
 * Hace que los ojos de N0X sigan el cursor del ratón (o el dedo en móvil).
 *
 * Devuelve un desplazamiento pequeño (unos píxeles en coordenadas del SVG)
 * según la dirección en la que está el puntero respecto a la figura.
 * Se desactiva con `prefers-reduced-motion` o si `enabled` es false.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';

/** Desplazamiento máximo de los ojos en unidades del viewBox. */
const MAX_X = 4;
const MAX_Y = 3;

export function useEyeTracking(target: RefObject<Element | null>, enabled: boolean): { x: number; y: number } {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const onMove = (event: PointerEvent): void => {
      if (frame.current !== null) return; // Como máximo una actualización por fotograma.
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        const box = target.current?.getBoundingClientRect();
        if (!box) return;
        // Centro aproximado de la cara (40 % de la altura de la figura).
        const dx = event.clientX - (box.left + box.width / 2);
        const dy = event.clientY - (box.top + box.height * 0.4);
        const distance = Math.hypot(dx, dy) || 1;
        // Cuanto más lejos el cursor, más se desplazan los ojos (hasta el máximo).
        const strength = Math.min(1, distance / 300);
        setOffset({ x: (dx / distance) * MAX_X * strength, y: (dy / distance) * MAX_Y * strength });
      });
    };

    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [enabled, target]);

  return offset;
}
