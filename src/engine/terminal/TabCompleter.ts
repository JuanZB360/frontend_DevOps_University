/**
 * Autocompletado con Tab, como en bash:
 *  - Primera palabra → nombres de comandos disponibles.
 *  - Resto → rutas de archivos (añade '/' a directorios y ' ' a archivos).
 *  - Varias coincidencias → completa el prefijo común; si no avanza, las lista.
 */
import type { VirtualFileSystem } from '../vfs/VirtualFileSystem';
import { resolvePath } from '../vfs/path';

export interface CompletionSource {
  commandNames(): string[];
  fs: VirtualFileSystem;
  cwd(): string;
  home(): string;
}

export type CompletionResult =
  | { kind: 'none' }
  | { kind: 'replace'; buffer: string; cursor: number }
  | { kind: 'list'; candidates: string[] };

export class TabCompleter {
  private readonly source: CompletionSource;

  constructor(source: CompletionSource) {
    this.source = source;
  }

  complete(buffer: string, cursor: number): CompletionResult {
    const before = buffer.slice(0, cursor);
    const after = buffer.slice(cursor);
    const wordStart = Math.max(before.lastIndexOf(' '), before.lastIndexOf('|'), before.lastIndexOf(';')) + 1;
    const word = before.slice(wordStart);
    // Es posición de comando si es la primera palabra o va tras | ; &
    const preceding = before.slice(0, wordStart).trimEnd();
    const isCommandPosition = preceding === '' || /[|;&]$/.test(preceding);

    const candidates = isCommandPosition && !word.includes('/')
      ? this.commandCandidates(word)
      : this.pathCandidates(word);

    if (candidates.length === 0) return { kind: 'none' };

    if (candidates.length === 1) {
      const completed = candidates[0];
      const suffix = completed.endsWith('/') ? '' : ' ';
      const newBefore = before.slice(0, wordStart) + completed + suffix;
      return { kind: 'replace', buffer: newBefore + after, cursor: newBefore.length };
    }

    const common = commonPrefix(candidates);
    if (common.length > word.length) {
      const newBefore = before.slice(0, wordStart) + common;
      return { kind: 'replace', buffer: newBefore + after, cursor: newBefore.length };
    }
    // Para listar se muestra solo el nombre final, no la ruta completa.
    return { kind: 'list', candidates: candidates.map((c) => c.replace(/^.*\/(?=.)/, '')) };
  }

  private commandCandidates(prefix: string): string[] {
    return [...new Set(this.source.commandNames())].filter((n) => n.startsWith(prefix)).sort();
  }

  private pathCandidates(word: string): string[] {
    const slash = word.lastIndexOf('/');
    const dirPart = slash === -1 ? '' : word.slice(0, slash + 1);
    const prefix = word.slice(slash + 1);

    let lookupDir = dirPart || '.';
    if (lookupDir === '~/' || lookupDir.startsWith('~/')) lookupDir = this.source.home() + lookupDir.slice(1);
    const abs = resolvePath(this.source.cwd(), lookupDir);

    const { fs } = this.source;
    if (!fs.isDirectory(abs) || !fs.canAccess(abs, 'r')) return [];
    return fs.readDir(abs)
      .filter((node) => node.name.startsWith(prefix) && (prefix.startsWith('.') || !node.name.startsWith('.')))
      .map((node) => {
        const isDir = node.type === 'dir' || (node.type === 'symlink' && fs.isDirectory(resolvePath(abs, node.name)));
        return dirPart + node.name.replace(/ /g, '\\ ') + (isDir ? '/' : '');
      });
  }
}

function commonPrefix(values: readonly string[]): string {
  let prefix = values[0];
  for (const value of values.slice(1)) {
    while (!value.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  return prefix;
}
