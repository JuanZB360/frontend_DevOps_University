/**
 * rm — elimina archivos y directorios. ¡En Linux no hay papelera!
 *   -r, -R  recursivo (necesario para directorios)
 *   -f      fuerza: no avisa si el archivo no existe
 *   -v      informa de cada elemento borrado
 *
 * Incluye las mismas protecciones que GNU rm: se niega a borrar '/', '.' y '..'.
 */
import { basename } from '../../vfs/path';
import { isFsError } from '../../vfs/errors';
import type { Command } from '../Command';
import { EXIT_USAGE, fail, parseOrFail, reportFsError } from '../helpers';

const SPECS = [
  { key: 'recursive', short: 'r', long: 'recursive' },
  { key: 'recursive', short: 'R' },
  { key: 'force', short: 'f', long: 'force' },
  { key: 'verbose', short: 'v', long: 'verbose' },
] as const;

export const rmCommand: Command = {
  name: 'rm',
  category: 'archivos',
  summary: 'Elimina archivos y directorios',
  execute(ctx) {
    const options = parseOrFail(ctx, SPECS);
    if (!options) return EXIT_USAGE;
    const recursive = options.flags.has('recursive');
    const force = options.flags.has('force');
    if (options.operands.length === 0) return force ? 0 : fail(ctx, 'missing operand', EXIT_USAGE);

    let exitCode = 0;
    for (const target of options.operands) {
      const abs = ctx.resolve(target);

      if (abs === '/' && recursive) {
        ctx.stderr.write("rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe\n");
        exitCode = 1;
        continue;
      }
      if (['.', '..'].includes(basename(target)) || target === '.' || target === '..') {
        exitCode = fail(ctx, `refusing to remove '.' or '..' directory: skipping '${target}'`);
        continue;
      }

      try {
        const node = ctx.fs.stat(abs, false);
        ctx.fs.remove(abs, recursive);
        if (options.flags.has('verbose')) {
          ctx.stdout.write(node.type === 'dir' ? `removed directory '${target}'\n` : `removed '${target}'\n`);
        }
      } catch (error) {
        if (force && isFsError(error) && error.code === 'ENOENT') continue;
        exitCode = reportFsError(ctx, error, target, 'cannot remove');
      }
    }
    return exitCode;
  },
};
