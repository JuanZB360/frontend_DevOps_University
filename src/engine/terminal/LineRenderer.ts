/**
 * Dibuja la línea de entrada (prompt + texto) en una terminal ANSI,
 * soportando líneas largas que ocupan varias filas.
 *
 * Mantiene la posición del cursor del último dibujado para poder volver
 * al inicio de la línea antes de redibujarla.
 */

/** Elimina secuencias de color ANSI para medir el ancho visible. */
export function visibleLength(text: string): number {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').length;
}

export class LineRenderer {
  /** Posición lineal del cursor (en caracteres desde el inicio del prompt) tras el último dibujado. */
  private lastCursor = 0;

  /** Se llama tras imprimir un prompt nuevo en una línea limpia. */
  markFreshLine(promptLength: number): void {
    this.lastCursor = promptLength;
  }

  /**
   * Genera la secuencia ANSI para redibujar la línea.
   * @param columns ancho de la terminal.
   */
  render(prompt: string, buffer: string, cursor: number, columns: number): string {
    const cols = Math.max(1, columns);
    const promptLength = visibleLength(prompt);
    let out = '';

    // 1) Subir hasta la fila donde empieza el prompt y limpiar hacia abajo.
    const rowsUp = Math.floor(this.lastCursor / cols);
    if (rowsUp > 0) out += `\x1b[${rowsUp}A`;
    out += '\r\x1b[J';

    // 2) Escribir prompt + texto.
    out += prompt + buffer;
    const end = promptLength + buffer.length;
    // Si el texto llena exactamente la fila, forzamos el salto para que el cursor sea predecible.
    if (end > 0 && end % cols === 0) out += ' \r';

    // 3) Colocar el cursor en su posición lógica.
    const target = promptLength + cursor;
    const endRow = Math.floor(end / cols);
    const targetRow = Math.floor(target / cols);
    if (endRow > targetRow) out += `\x1b[${endRow - targetRow}A`;
    out += `\x1b[${(target % cols) + 1}G`;

    this.lastCursor = target;
    return out;
  }

  /** Secuencia para mover el cursor al final de la línea (antes de un salto al ejecutar). */
  moveToEnd(prompt: string, buffer: string, columns: number): string {
    const cols = Math.max(1, columns);
    const end = visibleLength(prompt) + buffer.length;
    const rowsDown = Math.floor(end / cols) - Math.floor(this.lastCursor / cols);
    this.lastCursor = end;
    return (rowsDown > 0 ? `\x1b[${rowsDown}B` : '') + `\x1b[${(end % cols) + 1}G`;
  }
}
