/**
 * history — muestra los comandos ejecutados.
 *   history      → todo el historial numerado
 *   history N    → las últimas N entradas
 *   history -c   → borra el historial
 */
import type { Command } from '../Command';
import { fail } from '../helpers';

export const historyCommand: Command = {
  name: 'history',
  category: 'sistema',
  summary: 'Muestra el historial de comandos',
  builtin: true,
  execute(ctx) {
    const [arg] = ctx.args;
    if (arg === '-c') {
      ctx.history.clear();
      return 0;
    }

    const entries = ctx.history.list();
    let start = 0;
    if (arg !== undefined) {
      const count = Number(arg);
      if (!Number.isInteger(count) || count < 0) return fail(ctx, `${arg}: numeric argument required`);
      start = Math.max(0, entries.length - count);
    }

    for (let i = start; i < entries.length; i++) {
      ctx.stdout.write(`${String(i + 1).padStart(5)}  ${entries[i]}\n`);
    }
    return 0;
  },
};
