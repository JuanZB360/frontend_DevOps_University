/**
 * Paletas de la terminal (xterm.js) para cada tema.
 * Los textos del juego usan los 16 colores ANSI estándar, así que cambiar
 * la paleta cambia también el color de briefings, recompensas y prompt.
 */
import type { ITheme } from '@xterm/xterm';
import type { ThemeName } from './themeStore';

export const TERMINAL_THEMES: Record<ThemeName, ITheme> = {
  // Terminal de Ubuntu: fondo berenjena y paleta Tango.
  ubuntu: {
    background: '#300a24',
    foreground: '#ffffff',
    cursor: '#ffffff',
    cursorAccent: '#300a24',
    selectionBackground: '#e9542066',
    scrollbarSliderBackground: '#ffffff30',
    scrollbarSliderHoverBackground: '#ffffff60',
    scrollbarSliderActiveBackground: '#e95420aa',
    black: '#2e3436',
    red: '#cc0000',
    green: '#4e9a06',
    yellow: '#c4a000',
    blue: '#3465a4',
    magenta: '#75507b',
    cyan: '#06989a',
    white: '#d3d7cf',
    brightBlack: '#555753',
    brightRed: '#ef2929',
    brightGreen: '#8ae234',
    brightYellow: '#fce94f',
    brightBlue: '#729fcf',
    brightMagenta: '#ad7fa8',
    // En Ubuntu la ruta del prompt es azul: el juego usa "cyan brillante" para ella.
    brightCyan: '#729fcf',
    brightWhite: '#eeeeec',
  },
  matrix: {
    background: '#000a03',
    foreground: '#b8ffd0',
    cursor: '#00ff66',
    cursorAccent: '#000000',
    selectionBackground: '#00ff6655',
    scrollbarSliderBackground: '#00ff6640',
    scrollbarSliderHoverBackground: '#00ff6680',
    scrollbarSliderActiveBackground: '#00ff66aa',
    black: '#000000',
    red: '#ff4d6d',
    green: '#00ff66',
    yellow: '#ffb000',
    blue: '#3d8bff',
    magenta: '#e05cff',
    cyan: '#00e5ff',
    white: '#d9ffe6',
    brightBlack: '#3b6b4c',
    brightRed: '#ff7a90',
    brightGreen: '#5dff9c',
    brightYellow: '#ffd060',
    brightBlue: '#5fa8ff',
    brightMagenta: '#f08cff',
    brightCyan: '#6ff3ff',
    brightWhite: '#ffffff',
  },
  // Inspirada en las paletas oscuras de GitHub.
  pro: {
    background: '#0d1117',
    foreground: '#c9d1d9',
    cursor: '#58a6ff',
    cursorAccent: '#0d1117',
    selectionBackground: '#388bfd55',
    scrollbarSliderBackground: '#8b949e40',
    scrollbarSliderHoverBackground: '#8b949e80',
    scrollbarSliderActiveBackground: '#58a6ffaa',
    black: '#484f58',
    red: '#ff7b72',
    green: '#3fb950',
    yellow: '#d29922',
    blue: '#58a6ff',
    magenta: '#bc8cff',
    cyan: '#39c5cf',
    white: '#b1bac4',
    brightBlack: '#6e7681',
    brightRed: '#ffa198',
    brightGreen: '#56d364',
    brightYellow: '#e3b341',
    brightBlue: '#79c0ff',
    brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd',
    brightWhite: '#f0f6fc',
  },
};

/** Tipografía de la terminal en cada tema. */
export const TERMINAL_FONTS: Record<ThemeName, { family: string; size: number }> = {
  ubuntu: { family: "'Ubuntu Mono', monospace", size: 16 },
  matrix: { family: "'JetBrains Mono', monospace", size: 14 },
  pro: { family: "'JetBrains Mono', monospace", size: 14 },
};
