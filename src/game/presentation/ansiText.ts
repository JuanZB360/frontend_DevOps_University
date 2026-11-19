/**
 * Formateo de textos del juego para la terminal (colores ANSI y marcos).
 * Centralizarlo aquí mantiene una identidad visual coherente.
 */
/**
 * Se usan los 16 colores ANSI estándar (no 256 colores) para que la paleta
 * de la terminal de cada tema decida el tono exacto.
 */
export const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  brightGreen: '\x1b[1;92m',
  cyan: '\x1b[1;96m',
  amber: '\x1b[1;33m',
  red: '\x1b[1;91m',
  magenta: '\x1b[1;95m',
} as const;

/** Resalta en cian el texto entre `comillas invertidas`. */
export function highlightCode(text: string): string {
  return text.replace(/`([^`]+)`/g, (_m, code: string) => `${C.cyan}${code}${C.reset}`);
}

/** Marco con título, usado para cabeceras de capítulo y misión. */
export function frame(title: string, color: string = C.green, width = 56): string {
  const inner = ` ${title} `;
  const side = Math.max(2, Math.floor((width - inner.length) / 2));
  const line = '═'.repeat(side) + inner + '═'.repeat(Math.max(2, width - side - inner.length));
  return `${color}${line}${C.reset}`;
}

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/** Ancho visible de un texto (sin contar los códigos de color). */
function visibleWidth(text: string): number {
  return text.replace(ANSI_PATTERN, '').length;
}

/**
 * Ajusta una línea al ancho de la terminal cortando entre palabras (no a mitad).
 * Las líneas de continuación conservan la sangría original para que el texto
 * quede alineado. Los códigos ANSI no cuentan para el ancho.
 */
export function wrapAnsi(line: string, width: number): string[] {
  if (width < 20 || visibleWidth(line) <= width) return [line];
  const indent = /^\s*/.exec(line.replace(ANSI_PATTERN, ''))?.[0] ?? '';
  const words = line.trimStart().split(' ');
  const lines: string[] = [];
  let current = indent;
  let currentWidth = indent.length;

  for (const word of words) {
    const wordWidth = visibleWidth(word);
    const needsSpace = currentWidth > indent.length;
    if (needsSpace && currentWidth + 1 + wordWidth > width) {
      lines.push(current);
      current = indent + word;
      currentWidth = indent.length + wordWidth;
    } else {
      current += (needsSpace ? ' ' : '') + word;
      currentWidth += (needsSpace ? 1 : 0) + wordWidth;
    }
  }
  lines.push(current);
  return lines;
}

export function stars(count: number): string {
  return `${C.amber}${'★'.repeat(count)}${C.dim}${'☆'.repeat(3 - count)}${C.reset}`;
}
