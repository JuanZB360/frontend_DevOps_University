/**
 * Editor de texto a pantalla completa estilo GNU nano.
 *
 * Igual que LineEditor, es un modelo puro: recibe teclas y devuelve qué ha
 * pasado; `render()` produce las secuencias ANSI para dibujarlo. Así se puede
 * testear sin navegador.
 *
 * Atajos (los de nano): ^O guardar · ^X salir · ^K cortar línea · ^U pegar
 * ^W buscar · ^G ayuda · ^A/^E inicio/fin de línea · ^C posición · ^S guardar
 */

export type EditorResult = { type: 'continue' } | { type: 'exit'; saved: string | null };

const KEYS: Record<string, string> = {
  '\x1b[A': 'up', '\x1b[B': 'down', '\x1b[C': 'right', '\x1b[D': 'left',
  '\x1b[H': 'home', '\x1b[F': 'end', '\x1b[1~': 'home', '\x1b[4~': 'end',
  '\x1bOH': 'home', '\x1bOF': 'end', '\x1b[3~': 'delete', '\x1b[5~': 'pageup', '\x1b[6~': 'pagedown',
  '\x1bOA': 'up', '\x1bOB': 'down', '\x1bOC': 'right', '\x1bOD': 'left',
};

type Prompt = { kind: 'save-name' | 'exit-confirm' | 'search'; input: string } | null;

export class TextEditor {
  private lines: string[];
  private row = 0;
  private col = 0;
  private top = 0;
  private modified = false;
  private cutBuffer: string[] = [];
  private lastWasCut = false;
  private prompt: Prompt = null;
  private status = '';
  private showHelp = false;
  private savedContent: string | null = null;
  private lastSearch = '';
  readonly filename: string;
  private readonly readOnly: boolean;

  constructor(filename: string, content: string, options: { readOnly?: boolean; isNew?: boolean } = {}) {
    this.filename = filename;
    this.lines = content.replace(/\n$/, '').split('\n');
    if (this.lines.length === 0) this.lines = [''];
    this.readOnly = options.readOnly ?? false;
    this.status = options.isNew ? '[ New File ]' : options.readOnly ? `[ File '${filename}' is unwritable ]` : `[ Read ${this.lines.length} line${this.lines.length === 1 ? '' : 's'} ]`;
  }

  /** Contenido actual (con salto de línea final, como guarda nano). */
  text(): string {
    return this.lines.join('\n') + '\n';
  }

  feed(data: string): EditorResult {
    let i = 0;
    while (i < data.length) {
      const seq = Object.keys(KEYS).find((k) => data.startsWith(k, i));
      if (seq) {
        this.key(KEYS[seq]);
        i += seq.length;
        continue;
      }
      const ch = data[i];
      if (ch === '\x1b') {
        // Secuencia no reconocida: se ignora entera.
        const m = /^\x1b\[[0-9;]*[A-Za-z~]/.exec(data.slice(i));
        i += m ? m[0].length : 1;
        if (this.prompt) this.prompt = null;
        continue;
      }
      const result = this.char(ch);
      if (result.type === 'exit') return result;
      i++;
    }
    return { type: 'continue' };
  }

  private key(name: string): void {
    if (this.prompt) {
      if (name === 'left' || name === 'right') return;
      return;
    }
    this.lastWasCut = false;
    this.status = '';
    switch (name) {
      case 'up': this.row = Math.max(0, this.row - 1); break;
      case 'down': this.row = Math.min(this.lines.length - 1, this.row + 1); break;
      case 'left':
        if (this.col > 0) this.col--;
        else if (this.row > 0) {
          this.row--;
          this.col = this.lines[this.row].length;
        }
        break;
      case 'right':
        if (this.col < this.lines[this.row].length) this.col++;
        else if (this.row < this.lines.length - 1) {
          this.row++;
          this.col = 0;
        }
        break;
      case 'home': this.col = 0; break;
      case 'end': this.col = this.lines[this.row].length; break;
      case 'pageup': this.row = Math.max(0, this.row - 15); break;
      case 'pagedown': this.row = Math.min(this.lines.length - 1, this.row + 15); break;
      case 'delete': this.deleteForward(); break;
    }
    this.col = Math.min(this.col, this.lines[this.row].length);
  }

  private char(ch: string): EditorResult {
    if (this.prompt) return this.promptChar(ch);
    const wasCut = this.lastWasCut;
    this.lastWasCut = false;
    if (ch !== '\x0b') this.status = '';
    switch (ch) {
      case '\x18': // ^X
        if (!this.modified) return { type: 'exit', saved: this.savedContent };
        this.prompt = { kind: 'exit-confirm', input: '' };
        return { type: 'continue' };
      case '\x0f': case '\x13': // ^O, ^S
        if (this.readOnly) {
          this.status = `[ Error writing ${this.filename}: Permission denied ]`;
          return { type: 'continue' };
        }
        this.prompt = { kind: 'save-name', input: this.filename };
        return { type: 'continue' };
      case '\x17': // ^W
        this.prompt = { kind: 'search', input: '' };
        return { type: 'continue' };
      case '\x07': // ^G
        this.showHelp = !this.showHelp;
        return { type: 'continue' };
      case '\x0b': { // ^K cortar línea
        if (!wasCut) this.cutBuffer = [];
        this.cutBuffer.push(this.lines[this.row]);
        if (this.lines.length > 1) this.lines.splice(this.row, 1);
        else this.lines[0] = '';
        this.row = Math.min(this.row, this.lines.length - 1);
        this.col = 0;
        this.modified = true;
        this.lastWasCut = true;
        return { type: 'continue' };
      }
      case '\x15': // ^U pegar
        if (this.cutBuffer.length) {
          this.lines.splice(this.row, 0, ...this.cutBuffer);
          this.row += this.cutBuffer.length;
          this.col = 0;
          this.modified = true;
        }
        return { type: 'continue' };
      case '\x01': this.col = 0; return { type: 'continue' };
      case '\x05': this.col = this.lines[this.row].length; return { type: 'continue' };
      case '\x03': // ^C posición
        this.status = `[ line ${this.row + 1}/${this.lines.length} (${Math.round(((this.row + 1) / this.lines.length) * 100)}%), col ${this.col + 1}/${this.lines[this.row].length + 1} ]`;
        return { type: 'continue' };
      case '\r': case '\n':
        this.insertNewline();
        return { type: 'continue' };
      case '\x7f': case '\b':
        this.backspace();
        return { type: 'continue' };
      case '\t':
        this.insert('\t');
        return { type: 'continue' };
      default:
        if (ch >= ' ' || ch === ' ') this.insert(ch);
        return { type: 'continue' };
    }
  }

  private promptChar(ch: string): EditorResult {
    const prompt = this.prompt!;
    if (ch === '\x03' || ch === '\x07') {
      this.prompt = null;
      this.status = '[ Cancelled ]';
      return { type: 'continue' };
    }
    if (prompt.kind === 'exit-confirm') {
      const answer = ch.toLowerCase();
      if (answer === 'y' || answer === 's') {
        if (this.readOnly) {
          this.prompt = null;
          this.status = `[ Error writing ${this.filename}: Permission denied ]`;
          return { type: 'continue' };
        }
        this.savedContent = this.text();
        return { type: 'exit', saved: this.savedContent };
      }
      if (answer === 'n') return { type: 'exit', saved: this.savedContent };
      return { type: 'continue' };
    }
    if (ch === '\r' || ch === '\n') {
      this.prompt = null;
      if (prompt.kind === 'save-name') {
        this.savedContent = this.text();
        this.modified = false;
        this.status = `[ Wrote ${this.lines.length} line${this.lines.length === 1 ? '' : 's'} ]`;
      } else this.search(prompt.input || this.lastSearch);
      return { type: 'continue' };
    }
    if (ch === '\x7f' || ch === '\b') prompt.input = prompt.input.slice(0, -1);
    else if (ch >= ' ') prompt.input += ch;
    return { type: 'continue' };
  }

  private search(term: string): void {
    if (!term) return;
    this.lastSearch = term;
    for (let offset = 0; offset < this.lines.length; offset++) {
      const r = (this.row + offset) % this.lines.length;
      const from = offset === 0 ? this.col + 1 : 0;
      const index = this.lines[r].indexOf(term, from);
      if (index !== -1) {
        this.row = r;
        this.col = index;
        return;
      }
    }
    this.status = `[ "${term}" not found ]`;
  }

  private insert(text: string): void {
    const line = this.lines[this.row];
    this.lines[this.row] = line.slice(0, this.col) + text + line.slice(this.col);
    this.col += text.length;
    this.modified = true;
  }

  private insertNewline(): void {
    const line = this.lines[this.row];
    this.lines.splice(this.row + 1, 0, line.slice(this.col));
    this.lines[this.row] = line.slice(0, this.col);
    this.row++;
    this.col = 0;
    this.modified = true;
  }

  private backspace(): void {
    if (this.col > 0) {
      const line = this.lines[this.row];
      this.lines[this.row] = line.slice(0, this.col - 1) + line.slice(this.col);
      this.col--;
    } else if (this.row > 0) {
      const previous = this.lines[this.row - 1];
      this.lines[this.row - 1] = previous + this.lines[this.row];
      this.lines.splice(this.row, 1);
      this.row--;
      this.col = previous.length;
    } else return;
    this.modified = true;
  }

  private deleteForward(): void {
    const line = this.lines[this.row];
    if (this.col < line.length) this.lines[this.row] = line.slice(0, this.col) + line.slice(this.col + 1);
    else if (this.row < this.lines.length - 1) {
      this.lines[this.row] = line + this.lines[this.row + 1];
      this.lines.splice(this.row + 1, 1);
    } else return;
    this.modified = true;
  }

  /** Dibuja el editor completo para una pantalla de `cols` x `rows`. */
  render(cols: number, rows: number): string {
    const inverse = (text: string): string => `\x1b[7m${text}\x1b[27m`;
    const bodyRows = Math.max(3, rows - 4);
    if (this.row < this.top) this.top = this.row;
    if (this.row >= this.top + bodyRows) this.top = this.row - bodyRows + 1;
    const out: string[] = ['\x1b[?25l\x1b[H'];
    const title = `  GNU nano 7.2`;
    const name = this.filename;
    const flag = this.modified ? 'Modified' : '';
    const header = (title + ' '.repeat(Math.max(1, Math.floor((cols - name.length) / 2) - title.length)) + name).padEnd(cols - flag.length - 2) + flag + '  ';
    out.push(inverse(header.slice(0, cols)) + '\x1b[K\r\n');
    const help = [
      'Ayuda de nano (^G para volver)', '',
      '^O / ^S  Guardar el archivo        ^X  Salir',
      '^K       Cortar la línea           ^U  Pegar lo cortado',
      '^W       Buscar texto              ^C  Mostrar posición',
      '^A / ^E  Inicio / fin de línea     ↑↓←→  Moverse',
      '', 'En un servidor real nano funciona exactamente igual.',
    ];
    for (let r = 0; r < bodyRows; r++) {
      if (this.showHelp) {
        out.push((help[r] ?? '').slice(0, cols) + '\x1b[K\r\n');
        continue;
      }
      const line = this.lines[this.top + r];
      if (line === undefined) {
        out.push('\x1b[K\r\n');
        continue;
      }
      const visible = line.replace(/\t/g, '    ');
      const shown = visible.length > cols ? visible.slice(0, cols - 1) + '\x1b[7m>\x1b[27m' : visible;
      out.push(this.highlight(shown) + '\x1b[K\r\n');
    }
    // Línea de estado o de pregunta.
    let statusLine = '';
    if (this.prompt?.kind === 'save-name') statusLine = inverse(`File Name to Write: ${this.prompt.input}`.padEnd(cols).slice(0, cols));
    else if (this.prompt?.kind === 'exit-confirm') statusLine = inverse('Save modified buffer?  (Y/N, ^C cancela)'.padEnd(cols).slice(0, cols));
    else if (this.prompt?.kind === 'search') statusLine = inverse(`Search${this.lastSearch ? ` [${this.lastSearch}]` : ''}: ${this.prompt.input}`.padEnd(cols).slice(0, cols));
    else if (this.status) statusLine = ' '.repeat(Math.max(0, Math.floor((cols - this.status.length) / 2))) + inverse(this.status);
    out.push(statusLine + '\x1b[K\r\n');
    const shortcuts = [['^G', 'Ayuda'], ['^O', 'Guardar'], ['^W', 'Buscar'], ['^K', 'Cortar'], ['^U', 'Pegar'], ['^C', 'Posición'], ['^X', 'Salir']];
    const cell = Math.max(10, Math.floor(cols / shortcuts.length));
    out.push(shortcuts.map(([k, label]) => `${inverse(k)} ${label}`.padEnd(cell + 9)).join('').slice(0, cols + 60) + '\x1b[K');
    // Cursor
    const lineText = this.lines[this.row].slice(0, this.col).replace(/\t/g, '    ');
    const cursorRow = this.prompt ? rows - 1 : this.row - this.top + 2;
    const cursorCol = this.prompt
      ? (this.prompt.kind === 'save-name' ? 20 + this.prompt.input.length : this.prompt.kind === 'search' ? 8 + (this.lastSearch ? this.lastSearch.length + 3 : 0) + this.prompt.input.length : 40) + 1
      : Math.min(cols, lineText.length + 1);
    out.push(`\x1b[${cursorRow};${cursorCol}H\x1b[?25h`);
    return out.join('');
  }

  /** Comentarios en gris, como el resaltado de nano para archivos de configuración. */
  private highlight(line: string): string {
    if (/^\s*[#;]/.test(line)) return `\x1b[36m${line}\x1b[0m`;
    if (/^\s*\[.+\]\s*$/.test(line)) return `\x1b[1;33m${line}\x1b[0m`;
    return line;
  }
}
