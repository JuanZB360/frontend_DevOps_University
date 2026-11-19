/**
 * which — indica la ruta del ejecutable de un comando buscando en el PATH.
 * Los builtins del shell (cd, echo...) no tienen ejecutable, así que no aparecen.
 */
import { joinPath } from '../../vfs/path';
import type { Command } from '../Command';
import { EXIT_USAGE, fail } from '../helpers';

export const whichCommand: Command = {
  name: 'which',
  category: 'sistema',
  summary: 'Muestra la ruta de un comando',
  execute(ctx) {
    const all = ctx.args.includes('-a');
    const names = ctx.args.filter((a) => !a.startsWith('-'));
    if (names.length === 0) return fail(ctx, 'missing argument', EXIT_USAGE);
    const dirs = (ctx.session.getVar('PATH') ?? '').split(':').filter(Boolean);
    let exitCode = 0;
    for (const name of names) {
      let found = false;
      for (const dir of dirs) {
        const path = joinPath(dir, name);
        const node = ctx.fs.tryStat(path);
        if (node?.type !== 'file' || (node.mode & 0o111) === 0) continue;
        // /bin es un enlace a /usr/bin: no se repite el mismo programa.
        if (dir === '/bin' && dirs.includes('/usr/bin') && found) continue;
        ctx.stdout.write(path + '\n');
        found = true;
        if (!all) break;
      }
      if (!found) exitCode = 1;
    }
    return exitCode;
  },
};
