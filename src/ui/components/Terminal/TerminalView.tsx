/**
 * Componente React que monta xterm.js y lo conecta al juego mediante
 * TerminalController. React solo gestiona el ciclo de vida; toda la lógica
 * está en el controlador (que no depende de React).
 */
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';
import type { GameSession } from '../../../game/session/GameSession';
import { sounds } from '../../audio/SoundEngine';
import { TERMINAL_FONTS, TERMINAL_THEMES } from '../../theme/terminalThemes';
import { getTheme, subscribeTheme } from '../../theme/themeStore';
import { TerminalController } from '../../terminal/TerminalController';
import styles from './TerminalView.module.css';

interface Props {
  game: GameSession;
  isNewPlayer: boolean;
}

const MOBILE_KEYS = [
  { label: 'Tab', val: '\t', title: 'Autocompletar comando o ruta' },
  { label: 'Ctrl+C', val: '\x03', title: 'Cancelar o interrumpir (^C)' },
  { label: '▲', val: '\x1b[A', title: 'Comando anterior' },
  { label: '▼', val: '\x1b[B', title: 'Comando siguiente' },
  { label: 'Enter', val: '\r', title: 'Ejecutar' },
  { label: '/', val: '/', title: 'Barra /' },
  { label: '-', val: '-', title: 'Guion -' },
  { label: '~', val: '~', title: 'Home ~' },
  { label: '|', val: '|', title: 'Pipe |' },
];

export function TerminalView({ game, isNewPlayer }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<TerminalController | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const font = TERMINAL_FONTS[getTheme()];
    const term = new Terminal({
      fontFamily: font.family,
      fontSize: window.innerWidth < 600 ? font.size - 2 : font.size,
      lineHeight: 1.25,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 3000,
      theme: TERMINAL_THEMES[getTheme()],
      allowTransparency: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);

    let disposed = false;
    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* el contenedor aún no tiene tamaño */
      }
    });

    // Esperamos a las fuentes: xterm mide el ancho de los caracteres al abrirse.
    // Se piden explícitamente porque aún no las usa ningún elemento de la página.
    const fontsReady = Promise.all(
      Object.values(TERMINAL_FONTS).map((f) => document.fonts.load(`${f.size}px ${f.family}`).catch(() => [])),
    ).then(() => document.fonts.ready);
    void fontsReady.then(() => {
      if (disposed) return;
      term.open(host);
      fit.fit();
      observer.observe(host);

      // Desactiva autocorrector, mayúsculas automáticas y sugerencias de teclado en móviles
      const configureTextarea = () => {
        const textarea = host.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
        if (textarea) {
          textarea.setAttribute('autocapitalize', 'none');
          textarea.setAttribute('autocorrect', 'off');
          textarea.setAttribute('autocomplete', 'off');
          textarea.setAttribute('spellcheck', 'false');
          textarea.setAttribute('aria-autocomplete', 'none');
          textarea.setAttribute('data-gramm', 'false');
          textarea.setAttribute('data-enable-grammarly', 'false');
          textarea.setAttribute('enterkeyhint', 'go');
        }
      };
      configureTextarea();

      const controller = new TerminalController(term, game, sounds);
      controllerRef.current = controller;
      void controller.start(isNewPlayer);
      term.focus();
    });

    // Cambiar de tema actualiza la paleta sin reiniciar la terminal.
    const unsubscribeTheme = subscribeTheme(() => {
      const next = TERMINAL_FONTS[getTheme()];
      term.options.theme = TERMINAL_THEMES[getTheme()];
      term.options.fontFamily = next.family;
      term.options.fontSize = window.innerWidth < 600 ? next.size - 2 : next.size;
      try {
        fit.fit();
      } catch {
        /* la terminal aún no está abierta */
      }
    });

    const persist = (): void => game.persist();
    window.addEventListener('beforeunload', persist);

    return () => {
      disposed = true;
      unsubscribeTheme();
      window.removeEventListener('beforeunload', persist);
      observer.disconnect();
      controllerRef.current?.dispose();
      controllerRef.current = null;
      term.dispose();
    };
    // isNewPlayer solo importa al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game]);

  const handleMobileKey = (val: string) => {
    controllerRef.current?.sendInput(val);
    hostRef.current?.querySelector('textarea')?.focus();
  };

  return (
    <section className={styles.frame} aria-label="Terminal">
      <header className={styles.titlebar}>
        <span className={styles.dots} aria-hidden="true">
          <i /> <i /> <i />
        </span>
        <span className={styles.title}>{game.session.username}@{game.session.hostname}: ~ — bash</span>
        {/* Botones de ventana de GNOME (solo se ven en el tema Ubuntu; decorativos) */}
        <span className={styles.windowControls} aria-hidden="true">
          <i>&#8211;</i>
          <i>&#9633;</i>
          <i>&#10005;</i>
        </span>
      </header>
      <div className={styles.viewport} onClick={() => hostRef.current?.querySelector('textarea')?.focus()}>
        <div ref={hostRef} className={styles.host} />
      </div>
      <div className={styles.mobileToolbar} aria-label="Teclas rápidas de terminal">
        {MOBILE_KEYS.map((k) => (
          <button
            key={k.label}
            type="button"
            className={styles.mobileKey}
            title={k.title}
            onPointerDown={(e) => {
              e.preventDefault(); // Evita perder foco del textarea
              handleMobileKey(k.val);
            }}
          >
            {k.label}
          </button>
        ))}
      </div>
    </section>
  );
}
