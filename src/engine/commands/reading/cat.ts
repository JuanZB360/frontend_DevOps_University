/**
 * cat — concatena archivos y los muestra. Sin archivos, lee la entrada estándar.
 *   -n  numera todas las líneas
 */
import type { Command } from '../Command';
import { EXIT_USAGE, parseOrFail, readInputs } from '../helpers';

const SPECS = [{ key: 'number', short: 'n', long: 'number' }] as const;

export const catCommand: Command = {
  name: 'cat',
  category: 'lectura',
  summary: 'Muestra el contenido de archivos',
  execute(ctx) {
    const options = parseOrFail(ctx, SPECS);
    if (!options) return EXIT_USAGE;

    let exitCode = 0;
    let lineNumber = 1;
    for (const input of readInputs(ctx, options.operands)) {
      if (input.content === null) {
        exitCode = 1;
        continue;
      }
      if (!options.flags.has('number')) {
        ctx.stdout.write(input.content);
        continue;
      }
      const lines = input.content.split('\n');
      if (lines.at(-1) === '') lines.pop();
      for (const line of lines) ctx.stdout.write(`${String(lineNumber++).padStart(6)}\t${line}\n`);
    }
    return exitCode;
  },
};
