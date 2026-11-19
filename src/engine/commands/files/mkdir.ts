/**
 * mkdir — crea directorios.
 *   -p  crea también los directorios padre y no falla si ya existe
 *   -v  informa de cada directorio creado
 */
import type { Command } from '../Command';
import { EXIT_USAGE, fail, parseOrFail, reportFsError } from '../helpers';

const SPECS = [
  { key: 'parents', short: 'p', long: 'parents' },
  { key: 'verbose', short: 'v', long: 'verbose' },
] as const;

export const mkdirCommand: Command = {
  name: 'mkdir',
  category: 'archivos',
  summary: 'Crea directorios',
  execute(ctx) {
    const options = parseOrFail(ctx, SPECS);
    if (!options) return EXIT_USAGE;
    if (options.operands.length === 0) return fail(ctx, 'missing operand', EXIT_USAGE);

    const parents = options.flags.has('parents');
    let exitCode = 0;
    for (const target of options.operands) {
      const abs = ctx.resolve(target);
      const existed = ctx.fs.exists(abs);
      try {
        ctx.fs.mkdir(abs, parents);
        if (options.flags.has('verbose') && !existed) ctx.stdout.write(`mkdir: created directory '${target}'\n`);
      } catch (error) {
        exitCode = reportFsError(ctx, error, target, 'cannot create directory');
      }
    }
    return exitCode;
  },
};
