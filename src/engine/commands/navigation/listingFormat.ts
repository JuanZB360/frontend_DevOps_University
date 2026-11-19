/**
 * Formateo de listados de archivos (compartido por `ls`, y en el futuro `stat`, `find -ls`...).
 */
import { formatMode } from '../../vfs/permissions';
import type { FsNode } from '../../vfs/types';
import { ansi } from '../helpers';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SIX_MONTHS_MS = 182 * 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();

/** Entrada a listar: el nombre mostrado puede diferir del real ('.' y '..'). */
export interface ListingEntry {
  shownName: string;
  node: FsNode;
}

/** Tamaño en bytes tal como lo reporta `ls -l`. */
export function sizeOf(node: FsNode): number {
  if (node.type === 'dir') return 4096;
  if (node.type === 'symlink') return encoder.encode(node.target).length;
  return node.size ?? encoder.encode(node.content).length;
}

/** Bloques de 1K ocupados (para la línea "total" de `ls -l`). */
export function blocksOf(node: FsNode): number {
  return Math.ceil(sizeOf(node) / 4096) * 4;
}

/** Tamaño legible: 512, 4.0K, 1.2M (opción -h). */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return String(bytes);
  const units = ['K', 'M', 'G', 'T'];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit++;
  } while (value >= 1024 && unit < units.length - 1);
  return (value < 10 ? value.toFixed(1) : String(Math.ceil(value))) + units[unit];
}

/** Fecha estilo `ls -l`: "Nov 11 10:42" o "Nov 11  2025" si es antigua. */
export function formatListingDate(mtime: number, now = Date.now()): string {
  const d = new Date(mtime);
  const day = String(d.getDate()).padStart(2, ' ');
  const tail = Math.abs(now - mtime) > SIX_MONTHS_MS
    ? ` ${d.getFullYear()}`
    : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${MONTHS[d.getMonth()]} ${day} ${tail.padStart(5)}`;
}

/** Número de enlaces duros simulado: 2 + subdirectorios para directorios, 1 para el resto. */
export function linkCount(node: FsNode): number {
  if (node.type !== 'dir') return 1;
  return 2 + Object.values(node.children).filter((c) => c.type === 'dir').length;
}

/** Colorea un nombre según su tipo, como `ls --color=auto`. */
export function colorName(entry: ListingEntry, useColor: boolean): string {
  const { node } = entry;
  let name = entry.shownName;
  if (useColor && name.includes(' ')) name = `'${name}'`;
  if (!useColor) return name;
  if (node.type === 'dir') return `${ansi.blue}${name}${ansi.reset}`;
  if (node.type === 'symlink') return `${ansi.cyan}${name}${ansi.reset}`;
  if (node.mode & 0o111) return `${ansi.green}${name}${ansi.reset}`;
  return name;
}

/** Genera las líneas de `ls -l` con columnas alineadas. */
export function formatLongListing(entries: readonly ListingEntry[], human: boolean, useColor: boolean): string[] {
  const rows = entries.map(({ node, shownName }) => ({
    mode: formatMode(node),
    links: String(linkCount(node)),
    owner: node.owner,
    group: node.group,
    size: human ? humanSize(sizeOf(node)) : String(sizeOf(node)),
    date: formatListingDate(node.mtime),
    name: colorName({ node, shownName }, useColor) + (node.type === 'symlink' ? ` -> ${node.target}` : ''),
  }));
  const width = (key: 'links' | 'owner' | 'group' | 'size'): number => Math.max(0, ...rows.map((r) => r[key].length));
  const w = { links: width('links'), owner: width('owner'), group: width('group'), size: width('size') };

  return rows.map((r) =>
    `${r.mode} ${r.links.padStart(w.links)} ${r.owner.padEnd(w.owner)} ${r.group.padEnd(w.group)} ${r.size.padStart(w.size)} ${r.date} ${r.name}`,
  );
}

/**
 * Distribuye nombres en columnas para la terminal, como hace `ls` sin -l.
 * Se rellena por columnas (de arriba a abajo), igual que GNU ls.
 */
export function formatColumns(entries: readonly ListingEntry[], columns: number, useColor: boolean): string[] {
  if (entries.length === 0) return [];
  const plainNames = entries.map((e) => (e.shownName.includes(' ') ? `'${e.shownName}'` : e.shownName));
  const colored = entries.map((e) => colorName(e, useColor));
  const gap = 2;

  for (let cols = entries.length; cols >= 1; cols--) {
    const rows = Math.ceil(entries.length / cols);
    const widths: number[] = [];
    for (let c = 0; c < cols; c++) {
      const slice = plainNames.slice(c * rows, (c + 1) * rows);
      widths.push(slice.length ? Math.max(...slice.map((n) => n.length)) : 0);
    }
    const total = widths.reduce((a, b) => a + b, 0) + gap * (cols - 1);
    if (total <= columns || cols === 1) {
      const lines: string[] = [];
      for (let r = 0; r < rows; r++) {
        let line = '';
        for (let c = 0; c < cols; c++) {
          const index = c * rows + r;
          if (index >= entries.length) continue;
          const isLastInRow = c === cols - 1 || (c + 1) * rows + r >= entries.length;
          line += colored[index] + (isLastInRow ? '' : ' '.repeat(widths[c] - plainNames[index].length + gap));
        }
        lines.push(line);
      }
      return lines;
    }
  }
  return plainNames;
}
