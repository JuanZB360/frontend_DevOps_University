/**
 * Editor de línea (como GNU readline, pero mínimo).
 *
 * Recibe las secuencias de teclas crudas que envía xterm.js y mantiene el
 * texto en edición y la posición del cursor. NO dibuja nada: devuelve
 * acciones que el controlador de la terminal traduce a pantalla. Así la
 * lógica se puede testear sin navegador.
 *
 * Atajos soportados: ← → Inicio Fin Supr Retroceso ↑ ↓ (historial) Tab,
 * Ctrl+A/E (inicio/fin), Ctrl+U (borrar hasta el inicio), Ctrl+K (hasta el final),
 * Ctrl+W (borrar palabra), Ctrl+C (cancelar), Ctrl+L (limpiar pantalla).
 */

export type EditorAction =
  | { type: 'submit'; line: string }
  | { type: 'redraw' }
  | { type: 'interrupt' }
  | { type: 'clearScreen' }
  | { type: 'complete' };

/** Secuencias de escape de las teclas especiales. */
const KEYS: Record<string, string> = {
  '\x1b[A': 'up', '\x1b[B': 'down', '\x1b[C': 'right', '\x1b[D': 'left',
  '\x1b[H': 'home', '\x1b[F': 'end', '\x1b[1~': 'home', '\x1b[4~': 'end',
  '\x1bOH': 'home', '\x1bOF': 'end', '\x1b[3~': 'delete',
};

export class LineEditor {
  private text = '';
  private position = 0;
  /** Índice en el historial mientras se navega con ↑ ↓ (null = línea nueva). */
  private historyIndex: number | null = null;
  /** Lo que el usuario estaba escribiendo antes de navegar por el historial. */
  private draft = '';
  private readonly history: () => readonly string[];

  constructor(history: () => readonly string[]) {
    this.history = history;
  }

  get buffer(): string {
    return this.text;
  }

  get cursor(): number {
    return this.position;
  }

  /** Reemplaza el contenido (lo usa el autocompletado). */
  setBuffer(text: string, cursor = text.length): void {
    this.text = text;
    this.position = Math.max(0, Math.min(cursor, text.length));
  }

  reset(): void {
    this.text = '';
    this.position = 0;
    this.historyIndex = null;
    this.draft = '';
  }

  /** Procesa los datos de teclado y devuelve las acciones resultantes. */
  feed(data: string): EditorAction[] {
    const actions: EditorAction[] = [];
    let i = 0;
    while (i < data.length) {
      const escape = data[i] === '\x1b' ? Object.keys(KEYS).find((seq) => data.startsWith(seq, i)) : undefined;
      if (escape) {
        this.handleKey(KEYS[escape], actions);
        i += escape.length;
        continue;
      }
      if (data[i] === '\x1b') {
        // Secuencia desconocida: se ignora el resto del bloque.
        break;
      }
      this.handleChar(data[i], actions);
      i++;
    }
    return actions;
  }

  private handleChar(ch: string, actions: EditorAction[]): void {
    switch (ch) {
      case '\r':
      case '\n': {
        const line = this.text;
        this.reset();
        actions.push({ type: 'submit', line });
        return;
      }
      case '\x7f': // Retroceso
      case '\b':
        if (this.position > 0) {
          this.text = this.text.slice(0, this.position - 1) + this.text.slice(this.position);
          this.position--;
          actions.push({ type: 'redraw' });
        }
        return;
      case '\t':
        actions.push({ type: 'complete' });
        return;
      case '\x03': // Ctrl+C
        this.reset();
        actions.push({ type: 'interrupt' });
        return;
      case '\x0c': // Ctrl+L
        actions.push({ type: 'clearScreen' });
        return;
      case '\x01': // Ctrl+A
        return this.move(0, actions);
      case '\x05': // Ctrl+E
        return this.move(this.text.length, actions);
      case '\x15': // Ctrl+U
        this.text = this.text.slice(this.position);
        this.position = 0;
        actions.push({ type: 'redraw' });
        return;
      case '\x0b': // Ctrl+K
        this.text = this.text.slice(0, this.position);
        actions.push({ type: 'redraw' });
        return;
      case '\x17': { // Ctrl+W
        const before = this.text.slice(0, this.position).replace(/\S+\s*$/, '');
        this.text = before + this.text.slice(this.position);
        this.position = before.length;
        actions.push({ type: 'redraw' });
        return;
      }
    }
    // Ignora otros caracteres de control.
    if (ch < ' ') return;
    this.text = this.text.slice(0, this.position) + ch + this.text.slice(this.position);
    this.position++;
    actions.push({ type: 'redraw' });
  }

  private handleKey(key: string, actions: EditorAction[]): void {
    switch (key) {
      case 'left': return this.move(this.position - 1, actions);
      case 'right': return this.move(this.position + 1, actions);
      case 'home': return this.move(0, actions);
      case 'end': return this.move(this.text.length, actions);
      case 'delete':
        if (this.position < this.text.length) {
          this.text = this.text.slice(0, this.position) + this.text.slice(this.position + 1);
          actions.push({ type: 'redraw' });
        }
        return;
      case 'up': return this.navigateHistory(-1, actions);
      case 'down': return this.navigateHistory(1, actions);
    }
  }

  private move(position: number, actions: EditorAction[]): void {
    const clamped = Math.max(0, Math.min(position, this.text.length));
    if (clamped === this.position) return;
    this.position = clamped;
    actions.push({ type: 'redraw' });
  }

  private navigateHistory(direction: -1 | 1, actions: EditorAction[]): void {
    const entries = this.history();
    if (entries.length === 0) return;

    if (this.historyIndex === null) {
      if (direction === 1) return;
      this.draft = this.text;
      this.historyIndex = entries.length - 1;
    } else {
      const next = this.historyIndex + direction;
      if (next < 0) return;
      if (next >= entries.length) {
        this.historyIndex = null;
        this.setBuffer(this.draft);
        actions.push({ type: 'redraw' });
        return;
      }
      this.historyIndex = next;
    }
    this.setBuffer(entries[this.historyIndex]);
    actions.push({ type: 'redraw' });
  }
}
