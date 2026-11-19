/**
 * nano — editor de texto en la terminal (vi/vim abren el mismo editor).
 *   ^O guardar · ^X salir · ^K cortar · ^U pegar · ^W buscar
 */
import { isFsError } from '../../vfs/errors';
import type { Command } from '../Command';
import { fail } from '../helpers';

export const nanoCommand: Command = {
  name: 'nano',
  aliases: ['vi', 'vim'],
  category: 'archivos',
  summary: 'Editor de texto sencillo (^O guarda, ^X sale)',
  async execute(ctx) {
    const file = ctx.args.find((a) => !a.startsWith('-') && !a.startsWith('+'));
    if (!file) return fail(ctx, 'falta el nombre del archivo: nano archivo.txt');
    if (!ctx.terminal.edit) return fail(ctx, 'Too many errors from stdin');
    const abs = ctx.resolve(file);
    const node = ctx.fs.tryStat(abs);
    if (node?.type === 'dir') return fail(ctx, `"${file}" is a directory`);
    let content = '';
    if (node) {
      try {
        content = ctx.fs.readFile(abs);
      } catch (error) {
        if (!isFsError(error)) throw error;
        ctx.stderr.write(`[ Error reading ${file}: ${error.reason} ]\n`);
      }
    }
    if (ctx.name !== 'nano') ctx.stderr.write(`\x1b[2m(${ctx.name}: el simulador abre nano. En vim real: i para escribir, Esc y :wq para guardar y salir.)\x1b[0m\n`);
    const saved = await ctx.terminal.edit(file, content);
    if (saved === null) return 0;
    try {
      ctx.fs.writeFile(abs, saved);
    } catch (error) {
      if (!isFsError(error)) throw error;
      ctx.stderr.write(`[ Error writing ${file}: ${error.reason} ]\n\x1b[2m(pista: ese archivo es de root. Ábrelo con: sudo nano ${file})\x1b[0m\n`);
      return 1;
    }
    return 0;
  },
};
