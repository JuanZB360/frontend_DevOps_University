/**
 * ls — lista el contenido de directorios.
 *   -a  incluye ocultos (los que empiezan por .) y las entradas . y ..
 *   -A  incluye ocultos pero no . ni ..
 *   -l  formato largo (permisos, dueño, tamaño, fecha)
 *   -h  tamaños legibles (con -l)
 *   -R  recursivo
 *   -r  orden inverso
 *   -t  ordena por fecha de modificación (más reciente primero)
 *   -d  lista el directorio en sí, no su contenido
 *   -1  un nombre por línea
 */
import { basename, joinPath } from '../../vfs/path';
import type { DirNode, FsNode } from '../../vfs/types';
import type { Command, CommandContext } from '../Command';
import { EXIT_USAGE, parseOrFail, reportFsError } from '../helpers';
import type { ParsedOptions } from '../options';
import { blocksOf, formatColumns, formatLongListing, type ListingEntry } from './listingFormat';

const SPECS = [
  { key: 'all', short: 'a', long: 'all' },
  { key: 'almostAll', short: 'A', long: 'almost-all' },
  { key: 'long', short: 'l' },
  { key: 'human', short: 'h', long: 'human-readable' },
  { key: 'recursive', short: 'R', long: 'recursive' },
  { key: 'reverse', short: 'r', long: 'reverse' },
  { key: 'time', short: 't' },
  { key: 'directory', short: 'd', long: 'directory' },
  { key: 'one', short: '1' },
] as const;

export const lsCommand: Command = {
  name: 'ls',
  category: 'navegacion',
  summary: 'Lista archivos y directorios',
  execute(ctx) {
    const options = parseOrFail(ctx, SPECS);
    if (!options) return EXIT_USAGE;
    return new LsRun(ctx, options).run();
  },
};

/** Una ejecución de ls: agrupa el estado para no pasar 6 parámetros a cada función. */
class LsRun {
  private readonly ctx: CommandContext;
  private readonly flags: Set<string>;
  private readonly operands: string[];
  private exitCode = 0;
  private printedBlock = false;

  constructor(ctx: CommandContext, options: ParsedOptions) {
    this.ctx = ctx;
    this.flags = options.flags;
    this.operands = options.operands.length ? options.operands : ['.'];
  }

  run(): number {
    const files: ListingEntry[] = [];
    const dirs: { shown: string; abs: string; node: DirNode }[] = [];

    for (const operand of this.operands) {
      const abs = this.ctx.resolve(operand);
      try {
        // Con -l un enlace operando no se sigue (como `ls -l enlace`).
        const node = this.ctx.fs.stat(abs, !this.flags.has('long'));
        const followed = node.type === 'symlink' ? this.ctx.fs.tryStat(abs) : node;
        if (followed?.type === 'dir' && !this.flags.has('directory')) {
          dirs.push({ shown: operand, abs, node: followed });
        } else {
          files.push({ shownName: operand, node });
        }
      } catch (error) {
        reportFsError(this.ctx, error, operand, 'cannot access');
        this.exitCode = EXIT_USAGE;
      }
    }

    if (files.length) this.printEntries(this.sort(files));
    const showHeaders = this.operands.length > 1 || this.flags.has('recursive');
    for (const dir of this.sortDirs(dirs)) this.listDirectory(dir.shown, dir.abs, dir.node, showHeaders);
    return this.exitCode;
  }

  private listDirectory(shown: string, abs: string, node: DirNode, header: boolean): void {
    let children: FsNode[];
    try {
      children = this.ctx.fs.readDir(abs);
    } catch (error) {
      reportFsError(this.ctx, error, shown, 'cannot open directory');
      this.exitCode = EXIT_USAGE;
      return;
    }

    if (this.printedBlock) this.ctx.stdout.write('\n');
    if (header) this.ctx.stdout.write(`${shown}:\n`);
    this.printedBlock = true;

    const showHidden = this.flags.has('all') || this.flags.has('almostAll');
    let entries: ListingEntry[] = children
      .filter((c) => showHidden || !c.name.startsWith('.'))
      .map((c) => ({ shownName: c.name, node: c }));
    entries = this.sort(entries);

    if (this.flags.has('all')) {
      const parent = this.ctx.fs.tryStat(joinPath(abs, '..')) ?? node;
      entries.unshift({ shownName: '.', node }, { shownName: '..', node: parent });
    }

    if (this.flags.has('long')) {
      const total = entries.reduce((sum, e) => sum + blocksOf(e.node), 0);
      this.ctx.stdout.write(`total ${total}\n`);
    }
    this.printEntries(entries);

    if (this.flags.has('recursive')) {
      for (const entry of entries) {
        if (entry.node.type !== 'dir' || entry.shownName === '.' || entry.shownName === '..') continue;
        const childShown = shown.endsWith('/') ? shown + entry.shownName : `${shown}/${entry.shownName}`;
        this.listDirectory(childShown, joinPath(abs, entry.shownName), entry.node, true);
      }
    }
  }

  private printEntries(entries: readonly ListingEntry[]): void {
    const { stdout, terminal } = this.ctx;
    let lines: string[];
    if (this.flags.has('long')) lines = formatLongListing(entries, this.flags.has('human'), stdout.isTTY);
    else if (this.flags.has('one') || !stdout.isTTY) lines = entries.map((e) => e.shownName);
    else lines = formatColumns(entries, terminal.columns(), true);
    if (lines.length) stdout.write(lines.join('\n') + '\n');
  }

  private sort(entries: ListingEntry[]): ListingEntry[] {
    const sorted = [...entries];
    if (this.flags.has('time')) sorted.sort((a, b) => b.node.mtime - a.node.mtime);
    else sorted.sort((a, b) => basename(a.shownName).localeCompare(basename(b.shownName), 'en', { sensitivity: 'base' }));
    return this.flags.has('reverse') ? sorted.reverse() : sorted;
  }

  private sortDirs<T extends { shown: string }>(dirs: T[]): T[] {
    const sorted = [...dirs].sort((a, b) => a.shown.localeCompare(b.shown));
    return this.flags.has('reverse') ? sorted.reverse() : sorted;
  }
}
