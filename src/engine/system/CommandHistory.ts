/**
 * Historial de comandos (lo que muestra `history` y recorren las flechas ↑ ↓).
 */

/** Tamaño máximo, como HISTSIZE en bash. */
const MAX_ENTRIES = 500;

export class CommandHistory {
  private entries: string[];

  constructor(entries: readonly string[] = []) {
    this.entries = entries.slice(-MAX_ENTRIES);
  }

  /** Añade una línea, ignorando vacías y duplicados consecutivos (HISTCONTROL=ignoredups). */
  add(line: string): void {
    const trimmed = line.trim();
    if (!trimmed || this.entries.at(-1) === trimmed) return;
    this.entries.push(trimmed);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
  }

  clear(): void {
    this.entries = [];
  }

  /** Copia inmutable de las entradas, de la más antigua a la más reciente. */
  list(): readonly string[] {
    return [...this.entries];
  }

  get size(): number {
    return this.entries.length;
  }

  /** Entrada en la posición `index` (0 = la más antigua). */
  at(index: number): string | undefined {
    return this.entries[index];
  }
}
