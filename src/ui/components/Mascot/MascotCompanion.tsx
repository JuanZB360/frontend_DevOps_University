/**
 * N0X acompañando al jugador: una única consola portátil en cuya pantalla
 * aparecen su cuadro de diálogo (arriba) y N0X paseando por el suelo (abajo).
 */
import { useEffect, useRef, useState } from 'react';
import type { MascotState } from '../../../game/mascot/MascotDirector';
import styles from './Mascot.module.css';
import { MascotFigure } from './MascotFigure';
import { useWander } from './useWander';

interface Props {
  state: MascotState;
  size?: number;
}

const TYPE_MS = 22;

/**
 * Texto que se escribe letra a letra. Para reiniciar la animación con una
 * frase nueva, el padre cambia su `key` (React crea un estado limpio).
 */
function TypedText({ text }: { text: string }) {
  const [count, setCount] = useState(0);
  const done = count >= text.length;

  useEffect(() => {
    if (done) return;
    const timer = setTimeout(() => setCount((c) => c + 1), TYPE_MS);
    return () => clearTimeout(timer);
  }, [count, done]);

  return (
    <span aria-hidden="true">
      {text.slice(0, count)}
      {!done && <span className={styles.caret} />}
    </span>
  );
}

export function MascotCompanion({ state, size = 64 }: Props) {
  const floor = useRef<HTMLDivElement>(null);
  const wander = useWander(floor, size, state.mood);

  return (
    <div className={styles.console}>
      <div className={styles.screen}>
        <div className={styles.textbox} aria-live="polite">
          <span className={styles.name}>N0X</span>
          {/* El texto completo para lectores de pantalla; el animado es decorativo */}
          <span className="visually-hidden">{state.message}</span>
          <TypedText key={state.id} text={state.message} />
        </div>
        {/* Suelo por el que pasea N0X */}
        <div ref={floor} className={styles.floor}>
          <div className={styles.walker} style={{ transform: `translateX(${wander.x}px)` }}>
            <MascotFigure mood={state.mood} size={size} framed={false} walking={wander.walking} walkDir={wander.dir} />
          </div>
        </div>
      </div>
    </div>
  );
}
