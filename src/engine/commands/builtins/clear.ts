/**
 * clear — limpia la pantalla de la terminal (atajo de teclado: Ctrl+L).
 */
import type { Command } from '../Command';

export const clearCommand: Command = {
  name: 'clear',
  category: 'sistema',
  summary: 'Limpia la pantalla',
  execute(ctx) {
    ctx.terminal.clear();
    return 0;
  },
};
