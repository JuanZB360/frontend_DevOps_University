/**
 * tree — muestra un directorio como árbol.
 *   -a      incluye ocultos
 *   -d      solo directorios
 *   -L N    profundidad máxima
 */
import { joinPath } from '../../vfs/path';
import type { Command, CommandContext } from '../Command';
import { EXIT_USAGE, fail, parseOrFail, reportFsError } from '../helpers';
import { colorName } from './listingFormat';

const SPECS = [
  { key: 'all', short: 'a' },
  { key: 'dirsOnly', short: 'd' },
  { key: 'level', short: 'L', takesValue: true },
] as const;

interface Counters {
  dirs: number;
  files: number;
}

export const treeCommand: Command = {
  name: 'tree',
  category: 'navegacion',
  summary: 'Muestra directorios en forma de árbol',
  execute(ctx) {
    const options = parseOrFail(ctx, SPECS);
    if (!options) return EXIT_USAGE;

    const levelText = options.values.get('level');
    const maxDepth = levelText === undefined ? Infinity : Number(levelText);
    if (levelText !== undefined && (!Number.isInteger(maxDepth) || maxDepth < 1)) {
      return fail(ctx, 'Invalid level, must be greater than 0.');
    }

    const roots = options.operands.length ? options.operands : ['.'];
    const counters: Counters = { dirs: 0, files: 0 };
    let exitCode = 0;

    for (const root of roots) {
      const abs = ctx.resolve(root);
      if (!ctx.fs.isDirectory(abs)) {
        ctx.stdout.write(`${root}  [error opening dir]\n`);
        exitCode = 2;
        continue;
      }
      ctx.stdout.write(ctx.stdout.isTTY ? colorName({ shownName: root, node: ctx.fs.stat(abs) }, true) + '\n' : root + '\n');
      walk(ctx, abs, '', 1, maxDepth, options.flags, counters);
    }

    const dirWord = counters.dirs === 1 ? 'directory' : 'directories';
    const fileWord = counters.files === 1 ? 'file' : 'files';
    ctx.stdout.write(
      options.flags.has('dirsOnly')
        ? `\n${counters.dirs} ${dirWord}\n`
        : `\n${counters.dirs} ${dirWord}, ${counters.files} ${fileWord}\n`,
    );
    return exitCode;
  },
};

function walk(
  ctx: CommandContext, abs: string, prefix: string, depth: number, maxDepth: number,
  flags: ReadonlySet<string>, counters: Counters,
): void {
  if (depth > maxDepth) return;
  let children;
  try {
    children = ctx.fs.readDir(abs);
  } catch (error) {
    reportFsError(ctx, error, abs);
    return;
  }
  children = children.filter((c) => (flags.has('all') || !c.name.startsWith('.')) && (!flags.has('dirsOnly') || c.type === 'dir'));

  children.forEach((child, index) => {
    const isLast = index === children.length - 1;
    const label = colorName({ shownName: child.name, node: child }, ctx.stdout.isTTY);
    const suffix = child.type === 'symlink' ? ` -> ${child.target}` : '';
    ctx.stdout.write(`${prefix}${isLast ? '└── ' : '├── '}${label}${suffix}\n`);
    if (child.type === 'dir') {
      counters.dirs++;
      walk(ctx, joinPath(abs, child.name), prefix + (isLast ? '    ' : '│   '), depth + 1, maxDepth, flags, counters);
    } else {
      counters.files++;
    }
  });
}
