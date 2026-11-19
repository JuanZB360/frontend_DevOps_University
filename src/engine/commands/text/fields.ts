/**
 * Herramientas de texto pequeñas:
 *   cut   columnas por separador (-d -f) o por caracteres (-c)
 *   tr    traduce o borra caracteres (-d -s)
 *   tee   copia la entrada a la pantalla Y a archivos (-a añade)
 *   nl    numera líneas
 *   rev   invierte cada línea
 *   paste une archivos línea a línea (-d -s)
 */
import type { Command } from '../Command';
import { EXIT_USAGE, fail, parseOrFail, readInputs, reportFsError } from '../helpers';
import { splitLines } from './regex';

/** Convierte "1,3-5,7-" en una función que dice si la posición (1-based) entra. */
function parseRanges(spec: string): ((n: number) => boolean) | null {
  const parts = spec.split(',').map((part) => {
    const m = /^(\d*)(-?)(\d*)$/.exec(part.trim());
    if (!m || (!m[1] && !m[3])) return null;
    const from = m[1] ? Number(m[1]) : 1;
    const to = m[2] ? (m[3] ? Number(m[3]) : Infinity) : from;
    return { from, to };
  });
  if (parts.some((p) => p === null || p.from < 1)) return null;
  return (n) => parts.some((p) => n >= p!.from && n <= p!.to);
}

const CUT_SPECS = [
  { key: 'delimiter', short: 'd', long: 'delimiter', takesValue: true },
  { key: 'fields', short: 'f', long: 'fields', takesValue: true },
  { key: 'chars', short: 'c', long: 'characters', takesValue: true },
  { key: 'bytes', short: 'b', long: 'bytes', takesValue: true },
  { key: 'onlyDelimited', short: 's', long: 'only-delimited' },
  { key: 'outputDelimiter', long: 'output-delimiter', takesValue: true },
] as const;

export const cutCommand: Command = {
  name: 'cut',
  category: 'texto',
  summary: 'Extrae columnas o caracteres de cada línea',
  execute(ctx) {
    const options = parseOrFail(ctx, CUT_SPECS);
    if (!options) return EXIT_USAGE;
    const fields = options.values.get('fields');
    const chars = options.values.get('chars') ?? options.values.get('bytes');
    if (!fields && !chars) return fail(ctx, 'you must specify a list of bytes, characters, or fields', EXIT_USAGE);
    const select = parseRanges((fields ?? chars)!);
    if (!select) return fail(ctx, 'invalid field value', EXIT_USAGE);
    const delimiter = options.values.get('delimiter') ?? '\t';
    if (delimiter.length !== 1) return fail(ctx, 'the delimiter must be a single character', EXIT_USAGE);
    const outDelimiter = options.values.get('outputDelimiter') ?? delimiter;

    let exitCode = 0;
    for (const input of readInputs(ctx, options.operands)) {
      if (input.content === null) {
        exitCode = 1;
        continue;
      }
      for (const line of splitLines(input.content)) {
        if (chars) {
          ctx.stdout.write([...line].filter((_c, i) => select(i + 1)).join('') + '\n');
          continue;
        }
        if (!line.includes(delimiter)) {
          if (!options.flags.has('onlyDelimited')) ctx.stdout.write(line + '\n');
          continue;
        }
        ctx.stdout.write(line.split(delimiter).filter((_f, i) => select(i + 1)).join(outDelimiter) + '\n');
      }
    }
    return exitCode;
  },
};

/** Expande rangos y clases de tr: "a-z", "[:upper:]", "\n". */
function expandSet(set: string): string[] {
  const classes: Record<string, string> = {
    '[:lower:]': 'abcdefghijklmnopqrstuvwxyz',
    '[:upper:]': 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    '[:digit:]': '0123456789',
    '[:space:]': ' \t\n\r\f\v',
    '[:blank:]': ' \t',
    '[:punct:]': '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~',
  };
  classes['[:alpha:]'] = classes['[:lower:]'] + classes['[:upper:]'];
  classes['[:alnum:]'] = classes['[:alpha:]'] + classes['[:digit:]'];
  const out: string[] = [];
  let i = 0;
  while (i < set.length) {
    const cls = Object.keys(classes).find((c) => set.startsWith(c, i));
    if (cls) {
      out.push(...classes[cls]);
      i += cls.length;
      continue;
    }
    let ch = set[i];
    if (ch === '\\' && i + 1 < set.length) {
      const escapes: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\' };
      ch = escapes[set[i + 1]] ?? set[i + 1];
      i++;
    }
    if (set[i + 1] === '-' && i + 2 < set.length) {
      const end = set[i + 2];
      for (let c = ch.charCodeAt(0); c <= end.charCodeAt(0); c++) out.push(String.fromCharCode(c));
      i += 3;
      continue;
    }
    out.push(ch);
    i++;
  }
  return out;
}

export const trCommand: Command = {
  name: 'tr',
  category: 'texto',
  summary: 'Traduce o elimina caracteres',
  execute(ctx) {
    const options = parseOrFail(ctx, [
      { key: 'delete', short: 'd', long: 'delete' },
      { key: 'squeeze', short: 's', long: 'squeeze-repeats' },
      { key: 'complement', short: 'c', long: 'complement' },
    ]);
    if (!options) return EXIT_USAGE;
    const [set1, set2] = options.operands;
    if (set1 === undefined) return fail(ctx, 'missing operand', EXIT_USAGE);
    const text = ctx.stdin ?? '';
    const from = expandSet(set1);
    const inFrom = (c: string): boolean => from.includes(c) !== options.flags.has('complement');

    if (options.flags.has('delete')) {
      let result = [...text].filter((c) => !inFrom(c)).join('');
      if (options.flags.has('squeeze') && set2) {
        const squeeze = expandSet(set2);
        result = result.replace(/(.)\1+/gs, (m, c: string) => (squeeze.includes(c) ? c : m));
      }
      ctx.stdout.write(result);
      return 0;
    }
    if (set2 === undefined && !options.flags.has('squeeze')) return fail(ctx, `missing operand after '${set1}'`, EXIT_USAGE);
    const to = set2 !== undefined ? expandSet(set2) : [];
    let result = [...text].map((c) => {
      if (!set2) return c;
      const index = from.indexOf(c);
      if (options.flags.has('complement')) return inFrom(c) ? to.at(-1) ?? c : c;
      return index === -1 ? c : to[Math.min(index, to.length - 1)] ?? c;
    }).join('');
    if (options.flags.has('squeeze')) {
      const squeeze = set2 ? to : from;
      result = result.replace(/(.)\1+/gs, (m, c: string) => (squeeze.includes(c) ? c : m));
    }
    ctx.stdout.write(result);
    return 0;
  },
};

export const teeCommand: Command = {
  name: 'tee',
  category: 'texto',
  summary: 'Muestra la entrada en pantalla y la guarda en archivos',
  execute(ctx) {
    const options = parseOrFail(ctx, [{ key: 'append', short: 'a', long: 'append' }]);
    if (!options) return EXIT_USAGE;
    const text = ctx.stdin ?? '';
    let exitCode = 0;
    for (const file of options.operands) {
      try {
        ctx.fs.writeFile(ctx.resolve(file), text, options.flags.has('append'));
      } catch (error) {
        exitCode = reportFsError(ctx, error, file);
      }
    }
    ctx.stdout.write(text);
    return exitCode;
  },
};

export const nlCommand: Command = {
  name: 'nl',
  category: 'texto',
  summary: 'Numera las líneas no vacías',
  execute(ctx) {
    const options = parseOrFail(ctx, [{ key: 'body', short: 'b', takesValue: true }]);
    if (!options) return EXIT_USAGE;
    const all = options.values.get('body') === 'a';
    let n = 1;
    for (const input of readInputs(ctx, options.operands)) {
      if (input.content === null) return 1;
      for (const line of splitLines(input.content)) {
        if (line === '' && !all) ctx.stdout.write('\n');
        else ctx.stdout.write(`${String(n++).padStart(6)}\t${line}\n`);
      }
    }
    return 0;
  },
};

export const revCommand: Command = {
  name: 'rev',
  category: 'texto',
  summary: 'Invierte los caracteres de cada línea',
  execute(ctx) {
    for (const input of readInputs(ctx, ctx.args)) {
      if (input.content === null) return 1;
      for (const line of splitLines(input.content)) ctx.stdout.write([...line].reverse().join('') + '\n');
    }
    return 0;
  },
};

export const pasteCommand: Command = {
  name: 'paste',
  category: 'texto',
  summary: 'Une líneas de varios archivos en columnas',
  execute(ctx) {
    const options = parseOrFail(ctx, [
      { key: 'delimiter', short: 'd', long: 'delimiters', takesValue: true },
      { key: 'serial', short: 's', long: 'serial' },
    ]);
    if (!options) return EXIT_USAGE;
    const delimiter = (options.values.get('delimiter') ?? '\t').replace(/\\t/g, '\t').replace(/\\n/g, '\n');
    const inputs = readInputs(ctx, options.operands);
    if (inputs.some((i) => i.content === null)) return 1;
    const columns = inputs.map((i) => splitLines(i.content!));
    if (options.flags.has('serial')) {
      for (const column of columns) ctx.stdout.write(column.join(delimiter) + '\n');
      return 0;
    }
    const rows = Math.max(0, ...columns.map((c) => c.length));
    for (let r = 0; r < rows; r++) ctx.stdout.write(columns.map((c) => c[r] ?? '').join(delimiter) + '\n');
    return 0;
  },
};
