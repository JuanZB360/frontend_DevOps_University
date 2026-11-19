/**
 * exit — termina un script, o cierra la sesión actual (su, sudo -i, ssh).
 * En la sesión original... no hay escapatoria.
 */
import type { Command } from '../Command';

export const exitCommand: Command = {
  name: 'exit',
  aliases: ['logout'],
  category: 'sistema',
  summary: 'Termina un script o cierra la sesión del shell',
  builtin: true,
  execute(ctx) {
    const code = ctx.args[0] === undefined ? ctx.session.lastExitCode : Number(ctx.args[0]) & 255;
    if (ctx.shell.inScript()) return ctx.shell.signal('exit', code);
    if (ctx.session.popSession()) {
      ctx.stdout.write('logout\n');
      return 0;
    }
    ctx.stdout.write('logout\n');
    ctx.stderr.write('N0X: Buen intento. Nadie sale de la Matrix sin terminar su entrenamiento.\n');
    return 0;
  },
};
