/**
 * Flujos de salida (stdout / stderr) del shell.
 *
 * Todos implementan la misma interfaz mínima `OutputStream`, de modo que un
 * comando no sabe ni le importa si escribe en la pantalla, en una tubería (|)
 * o en un archivo (>). Esto es el principio de Inversión de Dependencias:
 * los comandos dependen de la abstracción, no de la terminal concreta.
 */
import type { VirtualFileSystem } from '../vfs/VirtualFileSystem';

export interface OutputStream {
  /** true si el destino es la pantalla (permite colores ANSI, como `ls --color=auto`). */
  readonly isTTY: boolean;
  write(text: string): void;
}

/** Acumula la salida en memoria. Se usa para las tuberías. */
export class BufferedOutput implements OutputStream {
  readonly isTTY = false;
  private chunks: string[] = [];

  write(text: string): void {
    this.chunks.push(text);
  }

  toString(): string {
    return this.chunks.join('');
  }
}

/** Escribe en un archivo del VFS (redirecciones > y >>). */
export class FileOutput implements OutputStream {
  readonly isTTY = false;
  private readonly fs: VirtualFileSystem;
  private readonly path: string;

  /**
   * @param truncate true para `>` (vacía el archivo al abrirlo), false para `>>`.
   * @throws FsError si no se puede abrir (permisos, directorio inexistente...).
   */
  constructor(fs: VirtualFileSystem, path: string, truncate: boolean) {
    this.fs = fs;
    this.path = path;
    if (truncate) fs.writeFile(path, '');
    else fs.writeFile(path, '', true);
  }

  write(text: string): void {
    this.fs.writeFile(this.path, text, true);
  }
}

/**
 * Reenvía la salida a otro flujo y además la registra.
 * Permite que el motor de misiones sepa qué imprimió cada comando.
 */
export class RecordingOutput implements OutputStream {
  private readonly target: OutputStream;
  private chunks: string[] = [];

  constructor(target: OutputStream) {
    this.target = target;
  }

  get isTTY(): boolean {
    return this.target.isTTY;
  }

  write(text: string): void {
    this.chunks.push(text);
    this.target.write(text);
  }

  recorded(): string {
    return this.chunks.join('');
  }
}

/**
 * Entrada estándar compartida: un bucle `while read linea` y los comandos de
 * su cuerpo leen del mismo flujo, línea a línea.
 */
export class InputSource {
  private readonly text: string | null;
  private pos = 0;

  constructor(text: string | null) {
    this.text = text;
  }

  /** true si la entrada viene del teclado (no hay tubería ni redirección). */
  get isTerminal(): boolean {
    return this.text === null;
  }

  /** Lo que queda por leer (null si es el teclado). */
  rest(): string | null {
    return this.text === null ? null : this.text.slice(this.pos);
  }

  /** Lee una línea sin el salto final, o null si se acabó la entrada. */
  readLine(): string | null {
    if (this.text === null || this.pos >= this.text.length) return null;
    const end = this.text.indexOf('\n', this.pos);
    const line = this.text.slice(this.pos, end === -1 ? this.text.length : end);
    this.pos = end === -1 ? this.text.length : end + 1;
    return line;
  }
}

/** Descarta todo. */
export const NULL_OUTPUT: OutputStream = { isTTY: false, write: () => undefined };
