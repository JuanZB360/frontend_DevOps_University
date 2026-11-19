/**
 * Barra superior: identidad del jugador, nivel, experiencia, puntos y menú de partida.
 * En el tema Ubuntu imita la barra superior de GNOME ("Actividades" y reloj centrado).
 */
import { useEffect, useRef, useState } from 'react';
import type { PlayerView } from '../../../game/session/PlayerView';
import type { SyncStatus } from '../../../game/storage/RemoteSaveRepository';
import { sounds } from '../../audio/SoundEngine';
import { useAudioSettings } from '../../hooks/useGame';
import { THEME_LABELS, toggleTheme, useTheme } from '../../theme/themeStore';
import { MascotFigure } from '../Mascot/MascotFigure';
import styles from './Hud.module.css';

interface Props {
  view: PlayerView;
  sync: SyncStatus;
  onToggleManual: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onReset: () => void;
  onLogout: () => void;
}

/** Texto e indicador de cada estado del guardado en el servidor. */
const SYNC_LABELS: Record<SyncStatus, { icon: string; text: string; title: string }> = {
  saved: { icon: '☁', text: 'Guardado', title: 'Tu progreso está guardado en el servidor' },
  saving: { icon: '⟳', text: 'Guardando…', title: 'Enviando tu progreso al servidor' },
  offline: { icon: '⚠', text: 'Sin conexión', title: 'No se puede contactar con el servidor. Se reintentará automáticamente; no cierres la pestaña.' },
  conflict: { icon: '⚠', text: 'No sincronizado', title: 'El servidor tiene una partida más avanzada (¿otra pestaña o dispositivo?). Recarga la página para continuar desde ella.' },
};

/** Fecha y hora al estilo de la barra de GNOME: "vie 14 nov  01:50". */
function formatClock(date: Date): string {
  const day = date.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '').replace(',', '');
  const time = date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  return `${day}  ${time}`;
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return <time className={styles.clock} dateTime={now.toISOString()}>{formatClock(now)}</time>;
}

export function Hud({ view, sync, onToggleManual, onExport, onImport, onReset, onLogout }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const percent = Math.round(view.levelRatio * 100);
  const audio = useAudioSettings();
  const theme = useTheme();

  return (
    <header className={styles.hud}>
      {theme === 'ubuntu' ? (
        <button type="button" className={styles.activities} onClick={onToggleManual} title="Mostrar u ocultar el manual">
          Actividades
        </button>
      ) : (
        <button type="button" className={`btn btn--ghost ${styles.manualToggle}`} onClick={onToggleManual} aria-label="Mostrar u ocultar el manual">
          ☰
        </button>
      )}

      <div className={styles.brand}>
        <MascotFigure mood="idle" size={26} className={styles.brandIcon} compact />
        {theme === 'ubuntu' ? (
          <span className={styles.appName}>DevOps University</span>
        ) : (
          <span className={styles.logo} data-text="DEVOPS//U">DEVOPS//U</span>
        )}
      </div>

      {theme === 'ubuntu' && <Clock />}

      <div className={styles.player}>
        <span className={styles.name}>{view.displayName}</span>
        <span className={styles.rank}>{view.rank}</span>
      </div>

      <div className={styles.level} title={`${view.xpInLevel} / ${view.xpRequired} XP`}>
        <span className={styles.levelLabel}>NV {view.level}</span>
        <div className={styles.xpBar} role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Experiencia del nivel">
          <div className={styles.xpFill} style={{ width: `${percent}%` }} />
        </div>
        <span className={styles.xpText}>{view.xpInLevel}/{view.xpRequired} XP</span>
      </div>

      <div className={styles.points} title="Puntos: se gastan en pistas">
        <span aria-hidden="true">⬢</span> {view.points} <small>pts</small>
      </div>

      <div className={styles.progress} title="Misiones completadas">
        {view.completedCount}/{view.totalMissions} <small>misiones</small>
      </div>

      <button
        type="button"
        className={`btn btn--ghost ${styles.soundToggle}`}
        onClick={() => {
          sounds.unlock();
          sounds.update({ muted: !audio.muted });
        }}
        aria-pressed={!audio.muted}
        aria-label={audio.muted ? 'Activar sonido' : 'Silenciar'}
        title={audio.muted ? 'Activar sonido' : 'Silenciar'}
      >
        {audio.muted ? '🔇' : '🔊'}
      </button>

      <span className={`${styles.sync} ${sync === 'offline' || sync === 'conflict' ? styles.syncWarn : ''}`} title={SYNC_LABELS[sync].title} role="status">
        <span aria-hidden="true">{SYNC_LABELS[sync].icon}</span>
        <span className={styles.syncText}>{SYNC_LABELS[sync].text}</span>
      </span>

      <div className={styles.menuWrap}>
        <button type="button" className="btn" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen}>
          Sistema ▾
        </button>
        {menuOpen && (
          <div className={styles.menu} role="menu" onMouseLeave={() => setMenuOpen(false)}>
            <button type="button" role="menuitem" onClick={toggleTheme}>
              ◐ Tema: {THEME_LABELS[theme]}
            </button>
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={audio.ambient}
              onClick={() => {
                sounds.unlock();
                sounds.update({ ambient: !audio.ambient, muted: false });
              }}
            >
              ♫ Música ambiente: {audio.ambient ? 'ON' : 'OFF'}
            </button>
            <label className={styles.volume}>
              <span>Volumen</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={audio.volume}
                onChange={(e) => sounds.update({ volume: Number(e.target.value), muted: false })}
                onPointerUp={() => sounds.play('key')}
              />
            </label>
            <hr className={styles.separator} />
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onExport(); }}>
              ⇩ Exportar progreso
            </button>
            <button type="button" role="menuitem" onClick={() => fileInput.current?.click()}>
              ⇧ Importar progreso
            </button>
            <button type="button" role="menuitem" className={styles.danger} onClick={() => { setMenuOpen(false); onReset(); }}>
              ✖ Reiniciar partida
            </button>
            <hr className={styles.separator} />
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onLogout(); }}>
              ⏻ Cerrar sesión ({view.username})
            </button>
          </div>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImport(file);
            e.target.value = '';
            setMenuOpen(false);
          }}
        />
      </div>
    </header>
  );
}
