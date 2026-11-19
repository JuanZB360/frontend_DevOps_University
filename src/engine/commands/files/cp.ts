/**
 * cp — copia archivos y directorios.
 *   -r, -R  copia directorios de forma recursiva
 *   -v      informa de cada copia
 */
import { isFsError } from '../../vfs/errors';
import { normalize } from '../../vfs/path';
import type { Command } from '../Command';
import { EXIT_USAGE, fail, parseOrFail, reportFsError } from '../helpers';
import { planTransfer } from './transfer';

const SPECS = [
  { key: 'recursive', short: 'r', long: 'recursive' },
  { key: 'recursive', short: 'R' },
  { key: 'verbose', short: 'v', long: 'verbose' },
] as const;

export const cpCommand: Command = {
  name: 'cp',
  category: 'archivos',
  summary: 'Copia archivos y directorios',
  execute(ctx) {
    const options = parseOrFail(ctx, SPECS);
    if (!options) return EXIT_USAGE;
    const plan = planTransfer(ctx, options.operands);
    if (typeof plan === 'number') return plan;

    const recursive = options.flags.has('recursive');
    let exitCode = 0;
    for (const { src, srcAbs, dest, destAbs } of plan.moves) {
      const source = ctx.fs.tryStat(srcAbs);
      if (!source) {
        exitCode = fail(ctx, `cannot stat '${src}': No such file or directory`);
        continue;
      }
      if (source.type === 'dir' && !recursive) {
        exitCode = fail(ctx, `-r not specified; omitting directory '${src}'`);
        continue;
      }
      if (normalize(srcAbs) === normalize(destAbs)) {
        exitCode = fail(ctx, `'${src}' and '${dest}' are the same file`);
        continue;
      }
      try {
        ctx.fs.copy(srcAbs, destAbs, recursive);
        if (options.flags.has('verbose')) ctx.stdout.write(`'${src}' -> '${dest}'\n`);
      } catch (error) {
        if (isFsError(error) && error.code === 'EINVAL') {
          exitCode = fail(ctx, `cannot copy a directory, '${src}', into itself, '${dest}'`);
          continue;
        }
        exitCode = reportFsError(ctx, error, dest, 'cannot create regular file');
      }
    }
    return exitCode;
  },
};
