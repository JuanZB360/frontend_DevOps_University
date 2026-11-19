/**
 * cd — cambia el directorio de trabajo.
 *   cd          → al home
 *   cd ~        → al home (lo expande el shell)
 *   cd -        → al directorio anterior (OLDPWD) y lo imprime
 *   cd ruta     → absoluta o relativa
 */
import type { Command } from '../Command';

export const cdCommand: Command = {
  name: 'cd',
  category: 'navegacion',
  summary: 'Cambia el directorio de trabajo actual',
  builtin: true,
  execute(ctx) {
    // cd es un builtin de bash: sus errores llevan el prefijo "bash: cd:".
    const error = (message: string): number => {
      ctx.stderr.write(`bash: cd: ${message}\n`);
      return 1;
    };

    if (ctx.args.length > 1) return error('too many arguments');
    let target = ctx.args[0] ?? ctx.session.home;

    if (target === '-') {
      const previous = ctx.session.getVar('OLDPWD');
      if (!previous) return error('OLDPWD not set');
      target = previous;
      ctx.stdout.write(previous + '\n');
    }

    const absolute = ctx.resolve(target);
    let node;
    try {
      node = ctx.fs.stat(absolute);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      return error(`${target}: ${reason}`);
    }
    if (node.type !== 'dir') return error(`${target}: Not a directory`);
    if (!ctx.fs.canAccess(absolute, 'x')) return error(`${target}: Permission denied`);

    ctx.session.changeDirectory(absolute);
    return 0;
  },
};
