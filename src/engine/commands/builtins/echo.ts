/**
 * echo — imprime sus argumentos separados por un espacio.
 *   -n  no añade salto de línea final
 *   -e  interpreta escapes: \n \t \\ \a \033 (colores)
 *   -E  no interpreta escapes (por defecto)
 *
 * Nota: echo NO usa el parser genérico porque, como en bash, cualquier
 * argumento que no sea exactamente una combinación de -n/-e/-E se imprime tal cual.
 */
import type { Command } from '../Command';

const OPTION = /^-[neE]+$/;

function interpretEscapes(text: string): string {
  return text
    .replace(/\\(033|e)/g, '\x1b')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\a/g, '')
    .replace(/\\\\/g, '\\');
}

export const echoCommand: Command = {
  name: 'echo',
  category: 'sistema',
  summary: 'Muestra un texto en pantalla',
  builtin: true,
  execute(ctx) {
    let newline = true;
    let escapes = false;
    let index = 0;

    while (index < ctx.args.length && OPTION.test(ctx.args[index])) {
      for (const flag of ctx.args[index].slice(1)) {
        if (flag === 'n') newline = false;
        if (flag === 'e') escapes = true;
        if (flag === 'E') escapes = false;
      }
      index++;
    }

    let text = ctx.args.slice(index).join(' ');
    if (escapes) text = interpretEscapes(text);
    ctx.stdout.write(newline ? text + '\n' : text);
    return 0;
  },
};
