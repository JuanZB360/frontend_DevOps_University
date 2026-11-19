/**
 * touch — crea archivos vacíos o actualiza su fecha de modificación.
 */
import type { Command } from '../Command';
import { EXIT_USAGE, fail, reportFsError } from '../helpers';

export const touchCommand: Command = {
  name: 'touch',
  category: 'archivos',
  summary: 'Crea archivos vacíos o actualiza su fecha',
  execute(ctx) {
    if (ctx.args.length === 0) return fail(ctx, 'missing file operand', EXIT_USAGE);
    let exitCode = 0;
    for (const target of ctx.args) {
      try {
        ctx.fs.touch(ctx.resolve(target));
      } catch (error) {
        exitCode = reportFsError(ctx, error, target, 'cannot touch');
      }
    }
    return exitCode;
  },
};
