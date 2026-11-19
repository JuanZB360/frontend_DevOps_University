/**
 * mv — mueve o renombra archivos y directorios (no necesita -r).
 *   -v  informa de cada movimiento
 */
import { isFsError } from '../../vfs/errors';
import type { Command } from '../Command';
import { EXIT_USAGE, fail, parseOrFail, reportFsError } from '../helpers';
import { planTransfer } from './transfer';

const SPECS = [{ key: 'verbose', short: 'v', long: 'verbose' }] as const;

export const mvCommand: Command = {
  name: 'mv',
  category: 'archivos',
  summary: 'Mueve o renombra archivos',
  execute(ctx) {
    const options = parseOrFail(ctx, SPECS);
    if (!options) return EXIT_USAGE;
    const plan = planTransfer(ctx, options.operands);
    if (typeof plan === 'number') return plan;

    let exitCode = 0;
    for (const { src, srcAbs, dest, destAbs } of plan.moves) {
      if (!ctx.fs.tryStat(srcAbs, false)) {
        exitCode = fail(ctx, `cannot stat '${src}': No such file or directory`);
        continue;
      }
      try {
        ctx.fs.move(srcAbs, destAbs);
        if (options.flags.has('verbose')) ctx.stdout.write(`renamed '${src}' -> '${dest}'\n`);
      } catch (error) {
        if (isFsError(error) && error.code === 'EINVAL') {
          exitCode = fail(ctx, `cannot move '${src}' to a subdirectory of itself, '${dest}'`);
          continue;
        }
        exitCode = reportFsError(ctx, error, dest, `cannot move '${src}' to`);
      }
    }
    return exitCode;
  },
};
