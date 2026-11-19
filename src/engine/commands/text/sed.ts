/**
 * sed — editor de flujo: transforma texto línea a línea.
 *
 * Soporta lo que se usa a diario en administración de sistemas:
 *   s/buscar/reemplazar/[g][i][N][p]   sustituir (cualquier separador: s|a|b|)
 *   d   borrar     p   imprimir     q   salir
 *   a texto / i texto / c texto       añadir después / antes / cambiar la línea
 *   y/abc/xyz/                         traducir caracteres
 *   Direcciones: N, $, /regex/, N,M, /a/,/b/, N,$ y negación con !
 *   Opciones: -n (no imprimir por defecto), -i[SUFIJO] (editar el archivo),
 *             -E / -r (expresiones extendidas), -e (varios scripts)
 */
import type { Command } from '../Command';
import { isFsError } from '../../vfs/errors';
import { compileRegex, RegexError, splitLines } from './regex';

type Address = { kind: 'line'; n: number } | { kind: 'last' } | { kind: 'regex'; re: RegExp };

interface Instruction {
  start: Address | null;
  end: Address | null;
  negate: boolean;
  op: string;
  /** Para s: regex, reemplazo y banderas. Para a/i/c: texto. Para y: tablas. */
  re?: RegExp;
  replacement?: string;
  global?: boolean;
  occurrence?: number;
  print?: boolean;
  text?: string;
  from?: string;
  to?: string;
  /** Estado de un rango activo. */
  inRange?: boolean;
}

class SedError extends Error {}

/** Lee un texto delimitado por `delim` permitiendo \delim. Devuelve [texto, siguiente posición]. */
function readDelimited(script: string, pos: number, delim: string): [string, number] {
  let out = '';
  let i = pos;
  while (i < script.length && script[i] !== delim) {
    if (script[i] === '\\' && i + 1 < script.length) {
      out += script[i + 1] === delim ? delim : script[i] + script[i + 1];
      i += 2;
      continue;
    }
    if (script[i] === '\n' && delim !== '\n') throw new SedError('unterminated `s\' command');
    out += script[i];
    i++;
  }
  if (i >= script.length) throw new SedError(`unterminated address regex`);
  return [out, i + 1];
}

function parseScript(script: string, extended: boolean): Instruction[] {
  const instructions: Instruction[] = [];
  let i = 0;
  const skipSpaces = (): void => {
    while (i < script.length && (script[i] === ' ' || script[i] === '\t')) i++;
  };
  const readAddress = (): Address | null => {
    if (/\d/.test(script[i] ?? '')) {
      let n = '';
      while (/\d/.test(script[i] ?? '')) n += script[i++];
      return { kind: 'line', n: Number(n) };
    }
    if (script[i] === '$') {
      i++;
      return { kind: 'last' };
    }
    if (script[i] === '/' || script[i] === '\\') {
      const delim = script[i] === '\\' ? script[++i] : '/';
      const [body, next] = readDelimited(script, i + 1, delim);
      i = next;
      let flags = '';
      if (script[i] === 'I') {
        flags = 'i';
        i++;
      }
      return { kind: 'regex', re: compileRegex(body, { extended, ignoreCase: flags === 'i' }) };
    }
    return null;
  };

  while (i < script.length) {
    skipSpaces();
    if (script[i] === ';' || script[i] === '\n') {
      i++;
      continue;
    }
    if (i >= script.length) break;
    const instruction: Instruction = { start: readAddress(), end: null, negate: false, op: '' };
    if (instruction.start && script[i] === ',') {
      i++;
      instruction.end = readAddress();
      if (!instruction.end) throw new SedError('unexpected `,\'');
    }
    skipSpaces();
    if (script[i] === '!') {
      instruction.negate = true;
      i++;
      skipSpaces();
    }
    const op = script[i++];
    if (op === undefined) throw new SedError('missing command');
    instruction.op = op;

    switch (op) {
      case 's': {
        const delim = script[i];
        const [pattern, afterPattern] = readDelimited(script, i + 1, delim);
        const [replacement, afterReplacement] = readDelimited(script, afterPattern, delim);
        i = afterReplacement;
        let flags = '';
        while (i < script.length && /[gipI0-9]/.test(script[i])) flags += script[i++];
        instruction.global = flags.includes('g');
        instruction.print = flags.includes('p');
        const n = /\d+/.exec(flags);
        instruction.occurrence = n ? Number(n[0]) : 1;
        instruction.re = compileRegex(pattern, { extended, ignoreCase: /[iI]/.test(flags), global: true });
        instruction.replacement = replacement;
        break;
      }
      case 'y': {
        const delim = script[i];
        const [from, a] = readDelimited(script, i + 1, delim);
        const [to, b] = readDelimited(script, a, delim);
        if (from.length !== to.length) throw new SedError('strings for `y\' command are different lengths');
        instruction.from = from;
        instruction.to = to;
        i = b;
        break;
      }
      case 'a': case 'i': case 'c': {
        // GNU: "a texto" o "a\" + salto + texto.
        if (script[i] === '\\') i++;
        if (script[i] === '\n') i++;
        skipSpaces();
        const end = script.indexOf('\n', i);
        instruction.text = script.slice(i, end === -1 ? script.length : end).replace(/\\n/g, '\n');
        i = end === -1 ? script.length : end;
        break;
      }
      case 'd': case 'p': case 'q': case '=': case 'n':
        break;
      default:
        throw new SedError(`unknown command: \`${op}'`);
    }
    instructions.push(instruction);
  }
  return instructions;
}

/** Traduce el reemplazo de sed (& y \1) al formato de JavaScript ($& y $1). */
function jsReplacement(replacement: string): string {
  let out = '';
  for (let i = 0; i < replacement.length; i++) {
    const ch = replacement[i];
    if (ch === '\\' && i + 1 < replacement.length) {
      const next = replacement[++i];
      if (/\d/.test(next)) out += `$${next}`;
      else if (next === 'n') out += '\n';
      else if (next === 't') out += '\t';
      else if (next === '&') out += '&';
      else out += next;
    } else if (ch === '&') out += '$&';
    else if (ch === '$') out += '$$';
    else out += ch;
  }
  return out;
}

function matches(address: Address, line: string, n: number, isLast: boolean): boolean {
  if (address.kind === 'line') return n === address.n;
  if (address.kind === 'last') return isLast;
  return address.re.test(line);
}

function selected(instruction: Instruction, line: string, n: number, isLast: boolean): boolean {
  let result: boolean;
  if (!instruction.start) result = true;
  else if (!instruction.end) result = matches(instruction.start, line, n, isLast);
  else if (instruction.inRange) {
    result = true;
    const end = instruction.end;
    const finished = end.kind === 'line' ? n >= end.n : matches(end, line, n, isLast);
    if (finished) instruction.inRange = false;
  } else if (matches(instruction.start, line, n, isLast)) {
    result = true;
    const end = instruction.end;
    // Si el final es un número ya alcanzado, el rango es de una sola línea.
    instruction.inRange = !(end.kind === 'line' && end.n <= n) && !(end.kind === 'last' && isLast);
  } else result = false;
  return result !== instruction.negate;
}

/** Ejecuta el script sobre un texto. Devuelve la salida. */
export function runSed(text: string, instructions: Instruction[], quiet: boolean): string {
  const lines = splitLines(text);
  let out = '';
  for (const instruction of instructions) instruction.inRange = false;

  outer: for (let index = 0; index < lines.length; index++) {
    let line = lines[index];
    const n = index + 1;
    const isLast = index === lines.length - 1;
    let deleted = false;
    let appendAfter = '';
    for (const instruction of instructions) {
      if (!selected(instruction, line, n, isLast)) continue;
      switch (instruction.op) {
        case 's': {
          let count = 0;
          let replaced = false;
          const re = instruction.re!;
          re.lastIndex = 0;
          line = line.replace(re, (...args: unknown[]) => {
            count++;
            if (!instruction.global && count !== instruction.occurrence) return args[0] as string;
            if (instruction.global && count < instruction.occurrence!) return args[0] as string;
            replaced = true;
            const groups = args.slice(1, -2) as (string | undefined)[];
            return jsReplacement(instruction.replacement!).replace(/\$(\$|&|\d)/g, (_m, g: string) => {
              if (g === '$') return '$';
              if (g === '&') return args[0] as string;
              return groups[Number(g) - 1] ?? '';
            });
          });
          if (replaced && instruction.print) out += line + '\n';
          break;
        }
        case 'y':
          line = [...line].map((c) => {
            const i = instruction.from!.indexOf(c);
            return i === -1 ? c : instruction.to![i];
          }).join('');
          break;
        case 'd':
          deleted = true;
          break;
        case 'p':
          out += line + '\n';
          break;
        case '=':
          out += `${n}\n`;
          break;
        case 'a':
          appendAfter += instruction.text + '\n';
          break;
        case 'i':
          out += instruction.text + '\n';
          break;
        case 'c':
          // En un rango, el texto se escribe una vez al final del rango.
          if (!instruction.end || !instruction.inRange) out += instruction.text + '\n';
          deleted = true;
          break;
        case 'q':
          if (!quiet) out += line + '\n';
          out += appendAfter;
          break outer;
        case 'n':
          if (!quiet) out += line + '\n';
          index++;
          if (index >= lines.length) {
            deleted = true;
            break;
          }
          line = lines[index];
          break;
      }
      if (deleted) break;
    }
    if (!deleted && !quiet) out += line + '\n';
    out += appendAfter;
  }
  return out;
}

export const sedCommand: Command = {
  name: 'sed',
  category: 'texto',
  summary: 'Edita texto en flujo (buscar y reemplazar, borrar líneas...)',
  execute(ctx) {
    const scripts: string[] = [];
    const files: string[] = [];
    let quiet = false;
    let inPlace: string | null = null;
    let extended = false;
    for (let i = 0; i < ctx.args.length; i++) {
      const arg = ctx.args[i];
      if (arg === '-n' || arg === '--quiet' || arg === '--silent') quiet = true;
      else if (arg === '-E' || arg === '-r' || arg === '--regexp-extended') extended = true;
      else if (arg === '-e' || arg === '--expression') scripts.push(ctx.args[++i] ?? '');
      else if (arg.startsWith('-i') || arg.startsWith('--in-place')) inPlace = arg.startsWith('-i') ? arg.slice(2) : (arg.split('=')[1] ?? '');
      else if (/^-[nEr]+$/.test(arg)) {
        if (arg.includes('n')) quiet = true;
        if (arg.includes('E') || arg.includes('r')) extended = true;
      } else if (/^-[nEr]*i/.test(arg)) {
        // Combinaciones como -ni o -Ei.
        if (arg.includes('n')) quiet = true;
        if (arg.includes('E') || arg.includes('r')) extended = true;
        inPlace = arg.slice(arg.indexOf('i') + 1);
      } else if (scripts.length === 0 && !arg.startsWith('-')) scripts.push(arg);
      else files.push(arg);
    }
    if (scripts.length === 0) {
      ctx.stderr.write('Usage: sed [OPTION]... {script-only-if-no-other-script} [input-file]...\n');
      return 1;
    }

    let instructions: Instruction[];
    try {
      instructions = parseScript(scripts.join('\n'), extended);
    } catch (error) {
      if (!(error instanceof SedError) && !(error instanceof RegexError)) throw error;
      ctx.stderr.write(`sed: -e expression #1, char 0: ${error.message}\n`);
      return 1;
    }

    if (inPlace !== null) {
      if (files.length === 0) {
        ctx.stderr.write('sed: no input files\n');
        return 1;
      }
      let exitCode = 0;
      for (const file of files) {
        const abs = ctx.resolve(file);
        try {
          const original = ctx.fs.readFile(abs);
          if (inPlace) ctx.fs.writeFile(abs + inPlace, original);
          ctx.fs.writeFile(abs, runSed(original, instructions, quiet));
        } catch (error) {
          if (!isFsError(error)) throw error;
          ctx.stderr.write(`sed: can't read ${file}: ${error.reason}\n`);
          exitCode = 2;
        }
      }
      return exitCode;
    }

    let text = '';
    if (files.length === 0) text = ctx.stdin ?? '';
    else {
      for (const file of files) {
        try {
          text += ctx.fs.readFile(ctx.resolve(file));
        } catch (error) {
          if (!isFsError(error)) throw error;
          ctx.stderr.write(`sed: can't read ${file}: ${error.reason}\n`);
          return 2;
        }
      }
    }
    ctx.stdout.write(runSed(text, instructions, quiet));
    return 0;
  },
};

