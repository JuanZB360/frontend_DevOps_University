/**
 * head y tail — muestran el principio o el final de un archivo.
 *   -n N   número de líneas (por defecto 10)
 *   -N     forma abreviada de -n N (ej. `head -5`)
 *
 * Comparten el 95 % de la lógica, así que se construyen con una fábrica
 * parametrizada por la función que recorta las líneas.
 */
import type { Command } from '../Command';
import { EXIT_USAGE, fail, parseOrFail, readInputs } from '../helpers';

const SPECS = [{ key: 'lines', short: 'n', long: 'lines', takesValue: true }] as const;
const DEFAULT_LINES = 10;

type Slicer = (lines: string[], count: number) => string[];

function createLinesCommand(name: 'head' | 'tail', summary: string, slice: Slicer): Command {
  return {
    name,
    category: 'lectura',
    summary,
    execute(rawCtx) {
      // Convierte el atajo "-5" en "-n 5" antes de parsear.
      const args = rawCtx.args.map((a) => (/^-\d+$/.test(a) ? `-n${a.slice(1)}` : a));
      const ctx = { ...rawCtx, args };
      const options = parseOrFail(ctx, SPECS);
      if (!options) return EXIT_USAGE;

      const countText = options.values.get('lines') ?? String(DEFAULT_LINES);
      const count = Number(countText.replace(/^[+-]/, ''));
      if (!Number.isInteger(count) || count < 0) return fail(ctx, `invalid number of lines: '${countText}'`);

      const inputs = readInputs(ctx, options.operands);
      const showHeaders = inputs.length > 1;
      let exitCode = 0;
      inputs.forEach((input, index) => {
        if (input.content === null) {
          exitCode = 1;
          return;
        }
        if (showHeaders) ctx.stdout.write(`${index > 0 ? '\n' : ''}==> ${input.name} <==\n`);
        const lines = input.content.split('\n');
        if (lines.at(-1) === '') lines.pop();
        const selected = slice(lines, count);
        if (selected.length) ctx.stdout.write(selected.join('\n') + '\n');
      });
      return exitCode;
    },
  };
}

export const headCommand = createLinesCommand('head', 'Muestra las primeras líneas de un archivo', (l, n) => l.slice(0, n));
export const tailCommand = createLinesCommand('tail', 'Muestra las últimas líneas de un archivo', (l, n) => (n === 0 ? [] : l.slice(-n)));
