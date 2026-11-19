/**
 * sort y uniq — ordenar líneas y eliminar/contar repetidas.
 *
 * sort:  -n numérico  -r inverso  -u únicas  -k N[,M] por columna  -t SEP separador
 *        -h tamaños humanos (2K, 1G)  -f ignora mayúsculas  -o ARCHIVO
 * uniq:  -c cuenta  -d solo repetidas  -u solo únicas  -i ignora mayúsculas
 *        (uniq solo junta líneas iguales CONSECUTIVAS: por eso se usa tras sort)
 */
import type { Command } from '../Command';
import { EXIT_USAGE, fail, parseOrFail, readInputs } from '../helpers';
import { splitLines } from './regex';

const SORT_SPECS = [
  { key: 'numeric', short: 'n', long: 'numeric-sort' },
  { key: 'reverse', short: 'r', long: 'reverse' },
  { key: 'unique', short: 'u', long: 'unique' },
  { key: 'human', short: 'h', long: 'human-numeric-sort' },
  { key: 'fold', short: 'f', long: 'ignore-case' },
  { key: 'key', short: 'k', long: 'key', takesValue: true },
  { key: 'sep', short: 't', long: 'field-separator', takesValue: true },
  { key: 'output', short: 'o', long: 'output', takesValue: true },
] as const;

const UNITS: Record<string, number> = { '': 1, K: 1e3, M: 1e6, G: 1e9, T: 1e12 };

function humanValue(text: string): number {
  const m = /^\s*(-?[\d.]+)\s*([KMGT]?)/i.exec(text);
  return m ? Number(m[1]) * (UNITS[m[2].toUpperCase()] ?? 1) : 0;
}

function numericValue(text: string): number {
  const m = /^\s*(-?\d+(?:\.\d+)?)/.exec(text);
  return m ? Number(m[1]) : 0;
}

export const sortCommand: Command = {
  name: 'sort',
  category: 'texto',
  summary: 'Ordena líneas de texto',
  execute(ctx) {
    const options = parseOrFail(ctx, SORT_SPECS);
    if (!options) return EXIT_USAGE;
    const f = options.flags;
    const lines: string[] = [];
    let exitCode = 0;
    for (const input of readInputs(ctx, options.operands)) {
      if (input.content === null) exitCode = 2;
      else lines.push(...splitLines(input.content));
    }

    const sep = options.values.get('sep');
    const keySpec = options.values.get('key');
    let keyStart = 0;
    let keyEnd: number | null = null;
    let keyNumeric = false;
    let keyReverse = false;
    if (keySpec) {
      const m = /^(\d+)([a-z]*)(?:,(\d+)([a-z]*))?$/.exec(keySpec);
      if (!m) return fail(ctx, `invalid number at field start: invalid count at start of '${keySpec}'`, EXIT_USAGE);
      keyStart = Number(m[1]) - 1;
      keyEnd = m[3] ? Number(m[3]) - 1 : null;
      keyNumeric = (m[2] + (m[4] ?? '')).includes('n');
      keyReverse = (m[2] + (m[4] ?? '')).includes('r');
    }
    const keyOf = (line: string): string => {
      if (!keySpec) return line;
      const fields = sep !== undefined ? line.split(sep) : line.trim().split(/\s+/);
      const end = keyEnd ?? fields.length - 1;
      return fields.slice(keyStart, end + 1).join(sep ?? ' ');
    };
    const numeric = f.has('numeric') || keyNumeric;
    const compare = (a: string, b: string): number => {
      const ka = keyOf(a);
      const kb = keyOf(b);
      let result: number;
      if (f.has('human')) result = humanValue(ka) - humanValue(kb);
      else if (numeric) result = numericValue(ka) - numericValue(kb);
      else {
        const x = f.has('fold') ? ka.toLowerCase() : ka;
        const y = f.has('fold') ? kb.toLowerCase() : kb;
        result = x < y ? -1 : x > y ? 1 : 0;
      }
      // Desempate por la línea completa (como sort).
      if (result === 0 && keySpec) result = a < b ? -1 : a > b ? 1 : 0;
      return result;
    };
    const reverse = f.has('reverse') !== keyReverse;
    let sorted = [...lines].sort((a, b) => (reverse ? -compare(a, b) : compare(a, b)));
    if (f.has('unique')) sorted = sorted.filter((line, i) => i === 0 || compare(sorted[i - 1], line) !== 0);

    const text = sorted.map((l) => l + '\n').join('');
    const output = options.values.get('output');
    if (output) ctx.fs.writeFile(ctx.resolve(output), text);
    else ctx.stdout.write(text);
    return exitCode;
  },
};

const UNIQ_SPECS = [
  { key: 'count', short: 'c', long: 'count' },
  { key: 'repeated', short: 'd', long: 'repeated' },
  { key: 'unique', short: 'u', long: 'unique' },
  { key: 'fold', short: 'i', long: 'ignore-case' },
] as const;

export const uniqCommand: Command = {
  name: 'uniq',
  category: 'texto',
  summary: 'Elimina o cuenta líneas repetidas consecutivas',
  execute(ctx) {
    const options = parseOrFail(ctx, UNIQ_SPECS);
    if (!options) return EXIT_USAGE;
    const f = options.flags;
    const [inputName, outputName] = options.operands;
    const [input] = readInputs(ctx, inputName ? [inputName] : []);
    if (input.content === null) return 1;
    const same = (a: string, b: string): boolean => (f.has('fold') ? a.toLowerCase() === b.toLowerCase() : a === b);

    const groups: { line: string; count: number }[] = [];
    for (const line of splitLines(input.content)) {
      const last = groups.at(-1);
      if (last && same(last.line, line)) last.count++;
      else groups.push({ line, count: 1 });
    }
    const text = groups
      .filter((g) => (!f.has('repeated') || g.count > 1) && (!f.has('unique') || g.count === 1))
      .map((g) => (f.has('count') ? `${String(g.count).padStart(7)} ${g.line}` : g.line) + '\n')
      .join('');
    if (outputName) ctx.fs.writeFile(ctx.resolve(outputName), text);
    else ctx.stdout.write(text);
    return 0;
  },
};
