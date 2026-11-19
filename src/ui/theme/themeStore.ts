/**
 * Tema visual activo: "ubuntu" (por defecto), "matrix" o "pro".
 *
 * Se guarda en localStorage y se aplica como atributo `data-theme` en <html>;
 * los estilos reaccionan a ese atributo (ver global.css). React lo lee con
 * useSyncExternalStore a través de `useTheme`.
 */
import { useSyncExternalStore } from 'react';

export type ThemeName = 'ubuntu' | 'matrix' | 'pro';

/** Orden en el que se recorren los temas al pulsar "Tema" en el menú. */
export const THEMES: readonly ThemeName[] = ['ubuntu', 'matrix', 'pro'];

export const THEME_LABELS: Record<ThemeName, string> = {
  ubuntu: 'Ubuntu',
  matrix: 'Matrix',
  pro: 'Profesional',
};

const DEFAULT_THEME: ThemeName = 'ubuntu';
/** v2: al introducir el tema Ubuntu como predeterminado se ignora la elección anterior. */
const STORAGE_KEY = 'devops-university:theme-v2';
const listeners = new Set<() => void>();

function readStored(): ThemeName {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return THEMES.includes(stored as ThemeName) ? (stored as ThemeName) : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

let current: ThemeName = readStored();

/** Aplica el tema al documento. Se llama al arrancar, antes de pintar, para evitar parpadeos. */
export function applyTheme(): void {
  document.documentElement.dataset.theme = current;
}

export function getTheme(): ThemeName {
  return current;
}

export function setTheme(theme: ThemeName): void {
  current = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* almacenamiento no disponible: el tema dura solo esta sesión */
  }
  applyTheme();
  listeners.forEach((l) => l());
}

/** Pasa al siguiente tema de la lista (Ubuntu → Matrix → Profesional → Ubuntu). */
export function toggleTheme(): void {
  setTheme(THEMES[(THEMES.indexOf(current) + 1) % THEMES.length]);
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): ThemeName {
  return useSyncExternalStore(subscribeTheme, getTheme);
}
