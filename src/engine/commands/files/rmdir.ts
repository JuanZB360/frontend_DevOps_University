/**
 * rmdir — elimina directorios VACÍOS. Para borrar con contenido se usa `rm -r`.
 */
import type { Command } from '../Command';
import { EXIT_USAGE, fail, reportFsError } from '../helpers';

export const rmdirCommand: Command = {
  name: 'rmdir',
  category: 'archivos',
  summary: 'Elimina directorios vacíos',
  execute(ctx) {
    if (ctx.args.length === 0) return fail(ctx, 'missing operand', EXIT_USAGE);
    let exitCode = 0;
    for (const target of ctx.args) {
      try {
        ctx.fs.rmdir(ctx.resolve(target));
      } catch (error) {
        exitCode = reportFsError(ctx, error, target, 'failed to remove');
      }
    }
    return exitCode;
  },
};
