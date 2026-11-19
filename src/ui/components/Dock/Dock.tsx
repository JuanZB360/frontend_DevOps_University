/**
 * Dock lateral al estilo de Ubuntu (solo se muestra en el tema Ubuntu).
 * Cada icono es un acceso directo a una acción del juego; el punto naranja
 * indica qué "aplicaciones" están abiertas, como en el dock real.
 */
import { sounds } from '../../audio/SoundEngine';
import { useAudioSettings } from '../../hooks/useGame';
import styles from './Dock.module.css';

interface Props {
  manualOpen: boolean;
  onToggleManual: () => void;
  onHint: () => void;
  hintDisabled: boolean;
}

/** Lleva el foco del teclado a la terminal. */
function focusTerminal(): void {
  document.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')?.focus();
}

export function Dock({ manualOpen, onToggleManual, onHint, hintDisabled }: Props) {
  const audio = useAudioSettings();

  return (
    <nav className={styles.dock} aria-label="Dock">
      <button type="button" className={styles.item} onClick={focusTerminal} title="Terminal">
        <span className={`${styles.icon} ${styles.terminal}`} aria-hidden="true">&gt;_</span>
        <span className={styles.running} aria-hidden="true" />
        <span className="visually-hidden">Terminal</span>
      </button>

      <button type="button" className={styles.item} onClick={onToggleManual} title="Manual de comandos" aria-pressed={manualOpen}>
        <span className={`${styles.icon} ${styles.manual}`} aria-hidden="true">?</span>
        {manualOpen && <span className={styles.running} aria-hidden="true" />}
        <span className="visually-hidden">Manual</span>
      </button>

      <button type="button" className={styles.item} onClick={onHint} disabled={hintDisabled} title="Comprar una pista">
        <span className={`${styles.icon} ${styles.hint}`} aria-hidden="true">!</span>
        <span className="visually-hidden">Pista</span>
      </button>

      <button
        type="button"
        className={styles.item}
        onClick={() => {
          sounds.unlock();
          sounds.update({ muted: !audio.muted });
        }}
        title={audio.muted ? 'Activar sonido' : 'Silenciar'}
        aria-pressed={!audio.muted}
      >
        <span className={`${styles.icon} ${styles.sound} ${audio.muted ? styles.muted : ''}`} aria-hidden="true">♪</span>
        <span className="visually-hidden">Sonido</span>
      </button>

      {/* Rejilla de "Mostrar aplicaciones" al final, como en Ubuntu (decorativa) */}
      <span className={styles.apps} aria-hidden="true">
        {Array.from({ length: 9 }, (_, i) => <i key={i} />)}
      </span>
    </nav>
  );
}
