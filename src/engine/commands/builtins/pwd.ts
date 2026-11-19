/**
 * pwd — imprime el directorio de trabajo actual (Print Working Directory).
 */
import type { Command } from '../Command';

export const pwdCommand: Command = {
  name: 'pwd',
  category: 'navegacion',
  summary: 'Muestra la ruta del directorio actual',
  builtin: true,
  execute(ctx) {
    ctx.stdout.write(ctx.session.cwd + '\n');
    return 0;
  },
};
