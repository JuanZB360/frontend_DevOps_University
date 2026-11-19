/**
 * Pantalla principal de juego: HUD + (dock en tema Ubuntu) + manual lateral +
 * terminal + panel de misión con N0X.
 */
import { useEffect, useState } from 'react';
import { ALL_DOCS, catalog } from '../../game/bootstrap';
import type { GameSession } from '../../game/session/GameSession';
import { connectGameSounds } from '../audio/connectGameSounds';
import { sounds } from '../audio/SoundEngine';
import { Dock } from '../components/Dock/Dock';
import { Hud } from '../components/Hud/Hud';
import { ManualSidebar } from '../components/ManualSidebar/ManualSidebar';
import { MascotCompanion } from '../components/Mascot/MascotCompanion';
import { MissionPanel } from '../components/MissionPanel/MissionPanel';
import { TerminalView } from '../components/Terminal/TerminalView';
import { useMascot, usePlayerView, useSyncStatus, type SyncStatusSource } from '../hooks/useGame';
import { useTheme } from '../theme/themeStore';
import styles from './GameScreen.module.css';

interface Props {
  game: GameSession;
  /** Estado del guardado en el servidor (se muestra en la barra superior). */
  syncStatus: SyncStatusSource;
  isNewPlayer: boolean;
  onExport: () => void;
  onImport: (file: File) => void;
  onReset: () => void;
  onLogout: () => void;
}

/** Cuánto tiempo se marca un comando como NUEVO en el manual. */
const NEW_BADGE_MS = 60_000;

export function GameScreen({ game, syncStatus, isNewPlayer, onExport, onImport, onReset, onLogout }: Props) {
  const view = usePlayerView(game);
  const sync = useSyncStatus(syncStatus);
  const mascot = useMascot(game, view.displayName, isNewPlayer);
  const [manualOpen, setManualOpen] = useState(() => window.innerWidth > 1100);
  const [mobileTab, setMobileTab] = useState<'terminal' | 'mission'>('terminal');
  const [recent, setRecent] = useState<string[]>([]);
  const theme = useTheme();
  const nextHintCost = view.currentMission?.nextHintCost ?? null;

  // Efectos de sonido ligados a los eventos del juego.
  useEffect(() => connectGameSounds(game.events, sounds), [game]);

  // Los navegadores solo permiten audio tras una interacción: lo habilitamos en la primera.
  useEffect(() => {
    const unlock = (): void => sounds.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // Marca como NUEVO los comandos recién desbloqueados durante un rato.
  useEffect(() => {
    return game.events.on('commandsUnlocked', ({ commands }) => {
      setRecent((r) => [...r, ...commands]);
      setTimeout(() => setRecent((r) => r.filter((c) => !commands.includes(c))), NEW_BADGE_MS);
    });
  }, [game]);

  return (
    <div className={styles.screen}>
      <Hud
        view={view}
        sync={sync}
        onToggleManual={() => setManualOpen((o) => !o)}
        onExport={onExport}
        onImport={onImport}
        onReset={onReset}
        onLogout={onLogout}
      />
      <div className={styles.desktop}>
        {theme === 'ubuntu' && (
          <Dock
            manualOpen={manualOpen}
            onToggleManual={() => setManualOpen((o) => !o)}
            onHint={() => game.revealHint('ui')}
            hintDisabled={nextHintCost === null || view.points < nextHintCost}
          />
        )}
        <main
          className={`${styles.layout} ${manualOpen ? styles.withManual : ''}`}
          data-mobile-tab={mobileTab}
        >
          {/* Selector de pestañas para móviles (oculto en escritorio) */}
          <div className={styles.mobileTabs} role="tablist" aria-label="Vistas del juego">
            <button
              type="button"
              role="tab"
              aria-selected={mobileTab === 'terminal'}
              className={`${styles.mobileTab} ${mobileTab === 'terminal' ? styles.mobileTabActive : ''}`}
              onClick={() => {
                setMobileTab('terminal');
                document.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')?.focus();
              }}
            >
              💻 Terminal
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mobileTab === 'mission'}
              className={`${styles.mobileTab} ${mobileTab === 'mission' ? styles.mobileTabActive : ''}`}
              onClick={() => setMobileTab('mission')}
            >
              🎯 Misión & N0X
            </button>
          </div>

          <ManualSidebar
            docs={ALL_DOCS}
            unlocked={view.unlockedCommands}
            recentlyUnlocked={recent}
            open={manualOpen}
            onClose={() => setManualOpen(false)}
          />

          <div className={styles.terminal}>
            {/* Resumen rápido de misión sobre la terminal en móviles */}
            {view.currentMission && (
              <div className={styles.mobileMiniMission}>
                <span className={styles.mobileMiniTitle} title={view.currentMission.title}>
                  🎯 {view.currentMission.title}
                </span>
                <div className={styles.mobileMiniActions}>
                  <button
                    type="button"
                    className="btn btn--amber"
                    onClick={() => game.revealHint('ui')}
                    disabled={nextHintCost === null || view.points < nextHintCost}
                  >
                    💡 {nextHintCost !== null ? `${nextHintCost}p` : 'Pista'}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => setMobileTab('mission')}
                  >
                    Detalles ▾
                  </button>
                </div>
              </div>
            )}
            <TerminalView game={game} isNewPlayer={isNewPlayer} />
          </div>
          <div className={styles.side}>
            <MissionPanel
              view={view}
              modules={catalog.modules}
              onHint={() => game.revealHint('ui')}
              onRestart={() => {
                game.restartMission('ui');
                setMobileTab('terminal');
                // Devuelve el foco a la terminal para seguir escribiendo sin hacer clic.
                document.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')?.focus();
              }}
            />
            <div className={styles.companion}>
              <MascotCompanion state={mascot} />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
