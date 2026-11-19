/**
 * grep — busca líneas que coinciden con un patrón.
 *   -i ignora mayúsculas   -v invierte   -n número de línea   -c cuenta
 *   -l solo nombres de archivo   -L archivos sin coincidencias
 *   -r/-R recursivo   -w palabra completa   -x línea completa
 *   -E extendida (egrep)   -F texto literal   -o solo la coincidencia
 *   -h/-H sin/con nombre de archivo   -q silencioso
 *   -A N / -B N / -C N contexto   -e PATRÓN   --color   --include=GLOB
 */
import { isFsError } from '../../vfs/errors';
import { joinPath } from '../../vfs/path';
import type { Command, CommandContext } from '../Command';
import { ansi, EXIT_USAGE, parseOrFail } from '../helpers';
import { compileRegex, RegexError, splitLines } from './regex';

const SPECS = [
  { key: 'ignoreCase', short: 'i', long: 'ignore-case' },
  { key: 'invert', short: 'v', long: 'invert-match' },
  { key: 'number', short: 'n', long: 'line-number' },
  { key: 'count', short: 'c', long: 'count' },
  { key: 'filesWith', short: 'l', long: 'files-with-matches' },
  { key: 'filesWithout', short: 'L', long: 'files-without-match' },
  { key: 'recursive', short: 'r', long: 'recursive' },
  { key: 'recursive', short: 'R', long: 'dereference-recursive' },
  { key: 'word', short: 'w', long: 'word-regexp' },
  { key: 'line', short: 'x', long: 'line-regexp' },
  { key: 'extended', short: 'E', long: 'extended-regexp' },
  { key: 'fixed', short: 'F', long: 'fixed-strings' },
  { key: 'only', short: 'o', long: 'only-matching' },
  { key: 'noName', short: 'h', long: 'no-filename' },
  { key: 'withName', short: 'H', long: 'with-filename' },
  { key: 'quiet', short: 'q', long: 'quiet' },
  { key: 'silent', short: 's', long: 'no-messages' },
  { key: 'after', short: 'A', long: 'after-context', takesValue: true },
  { key: 'before', short: 'B', long: 'before-context', takesValue: true },
  { key: 'context', short: 'C', long: 'context', takesValue: true },
  { key: 'pattern', short: 'e', long: 'regexp', takesValue: true },
  { key: 'color', long: 'color', takesValue: true },
  { key: 'colour', long: 'colour', takesValue: true },
  { key: 'include', long: 'include', takesValue: true },
  { key: 'exclude', long: 'exclude', takesValue: true },
] as const;

/** Convierte un glob sencillo (*.log) en RegExp para --include/--exclude. */
function globToRegExp(glob: string): RegExp {
  return new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
}

export function createGrepCommand(name: 'grep' | 'egrep' | 'fgrep'): Command {
  return {
    name,
    category: 'texto',
    summary: name === 'grep' ? 'Busca líneas que coinciden con un patrón' : `Igual que grep -${name === 'egrep' ? 'E' : 'F'}`,
    execute(ctx) {
      const options = parseOrFail(ctx, SPECS);
      if (!options) return EXIT_USAGE;
      const f = options.flags;
      const operands = [...options.operands];
      const pattern = options.values.get('pattern') ?? operands.shift();
      if (pattern === undefined) {
        ctx.stderr.write(`Usage: ${name} [OPTION]... PATTERNS [FILE]...\nTry '${name} --help' for more information.\n`);
        return EXIT_USAGE;
      }

      let regex: RegExp;
      try {
        regex = compileRegex(pattern, {
          extended: f.has('extended') || name === 'egrep',
          fixed: f.has('fixed') || name === 'fgrep',
          ignoreCase: f.has('ignoreCase'),
          word: f.has('word'),
          line: f.has('line'),
        });
      } catch (error) {
        if (!(error instanceof RegexError)) throw error;
        ctx.stderr.write(`${name}: ${error.message}\n`);
        return EXIT_USAGE;
      }

      const contextN = Number(options.values.get('context') ?? 0);
      const after = Number(options.values.get('after') ?? contextN);
      const before = Number(options.values.get('before') ?? contextN);
      const colorMode = options.values.get('color') ?? options.values.get('colour') ?? 'auto';
      const useColor = colorMode === 'always' || (colorMode === 'auto' && ctx.stdout.isTTY);
      const include = options.values.get('include');
      const exclude = options.values.get('exclude');
      const includeRe = include ? globToRegExp(include) : null;
      const excludeRe = exclude ? globToRegExp(exclude) : null;
      const recursive = f.has('recursive');

      // Archivos a examinar.
      const files: { shown: string; content: string }[] = [];
      let hadError = false;
      const addFile = (shown: string, abs: string, explicit: boolean): void => {
        const base = shown.split('/').at(-1) ?? shown;
        if (!explicit && includeRe && !includeRe.test(base)) return;
        if (excludeRe && excludeRe.test(base)) return;
        try {
          files.push({ shown, content: ctx.fs.readFile(abs) });
        } catch (error) {
          if (!isFsError(error)) throw error;
          if (!f.has('silent')) ctx.stderr.write(`${name}: ${shown}: ${error.reason}\n`);
          hadError = true;
        }
      };
      const walk = (shown: string, abs: string): void => {
        let children;
        try {
          children = ctx.fs.readDir(abs);
        } catch (error) {
          if (!isFsError(error)) throw error;
          if (!f.has('silent')) ctx.stderr.write(`${name}: ${shown}: ${error.reason}\n`);
          hadError = true;
          return;
        }
        for (const child of children) {
          const childShown = shown.endsWith('/') ? shown + child.name : `${shown}/${child.name}`;
          const childAbs = joinPath(abs, child.name);
          if (child.type === 'dir') walk(childShown, childAbs);
          else if (child.type === 'file') addFile(childShown, childAbs, false);
        }
      };

      const useStdin = operands.length === 0 && !recursive;
      if (useStdin) files.push({ shown: '(standard input)', content: ctx.stdin ?? '' });
      const targets = operands.length === 0 && recursive ? ['.'] : operands;
      for (const operand of targets) {
        const abs = ctx.resolve(operand);
        const node = ctx.fs.tryStat(abs);
        if (node?.type === 'dir') {
          if (recursive) walk(operand === '.' && operands.length === 0 ? '.' : operand, abs);
          else {
            if (!f.has('silent')) ctx.stderr.write(`${name}: ${operand}: Is a directory\n`);
            hadError = true;
          }
          continue;
        }
        addFile(operand, abs, true);
      }

      const showName = !f.has('noName') && (f.has('withName') || files.length > 1 || recursive);
      let matchedAny = false;

      for (const file of files) {
        const lines = splitLines(file.content);
        const matches = lines.map((line) => regex.test(line) !== f.has('invert'));
        const count = matches.filter(Boolean).length;
        if (count > 0) matchedAny = true;
        if (f.has('quiet')) {
          if (matchedAny) return 0;
          continue;
        }
        if (f.has('filesWith')) {
          if (count > 0) ctx.stdout.write(`${paint(ctx, useColor, ansi.magenta, file.shown)}\n`);
          continue;
        }
        if (f.has('filesWithout')) {
          if (count === 0) ctx.stdout.write(`${file.shown}\n`);
          continue;
        }
        if (f.has('count')) {
          ctx.stdout.write(`${showName ? file.shown + ':' : ''}${count}\n`);
          continue;
        }
        writeMatches(ctx, { lines, matches, regex, file: file.shown, showName, useColor, only: f.has('only'), number: f.has('number'), invert: f.has('invert'), after, before });
      }
      if (hadError && !f.has('quiet')) return 2;
      return matchedAny ? 0 : 1;
    },
  };
}

function paint(_ctx: CommandContext, useColor: boolean, color: string, text: string): string {
  return useColor ? `${color}${text}${ansi.reset}` : text;
}

interface WriteOptions {
  lines: string[];
  matches: boolean[];
  regex: RegExp;
  file: string;
  showName: boolean;
  useColor: boolean;
  only: boolean;
  number: boolean;
  invert: boolean;
  after: number;
  before: number;
}

function writeMatches(ctx: CommandContext, o: WriteOptions): void {
  const global = new RegExp(o.regex.source, o.regex.flags.includes('g') ? o.regex.flags : o.regex.flags + 'g');
  const highlight = (line: string): string =>
    o.useColor && !o.invert ? line.replace(global, (m) => `${ansi.red}${m}${ansi.reset}`) : line;
  const prefix = (index: number, separator: string): string =>
    (o.showName ? paint(ctx, o.useColor, ansi.magenta, o.file) + paint(ctx, o.useColor, ansi.cyan, separator) : '') +
    (o.number ? paint(ctx, o.useColor, ansi.green, String(index + 1)) + paint(ctx, o.useColor, ansi.cyan, separator) : '');

  if (o.only) {
    o.lines.forEach((line, index) => {
      if (!o.matches[index] || o.invert) return;
      for (const m of line.matchAll(global)) {
        if (m[0] === '') continue;
        ctx.stdout.write(prefix(index, ':') + (o.useColor ? `${ansi.red}${m[0]}${ansi.reset}` : m[0]) + '\n');
      }
    });
    return;
  }

  const hasContext = o.after > 0 || o.before > 0;
  let lastPrinted = -1;
  let afterLeft = 0;
  o.lines.forEach((line, index) => {
    if (o.matches[index]) {
      const start = Math.max(lastPrinted + 1, index - o.before);
      if (hasContext && lastPrinted !== -1 && start > lastPrinted + 1) ctx.stdout.write('--\n');
      for (let i = start; i < index; i++) ctx.stdout.write(prefix(i, '-') + o.lines[i] + '\n');
      ctx.stdout.write(prefix(index, ':') + highlight(line) + '\n');
      lastPrinted = index;
      afterLeft = o.after;
    } else if (afterLeft > 0) {
      ctx.stdout.write(prefix(index, '-') + line + '\n');
      lastPrinted = index;
      afterLeft--;
    }
  });
}

export const grepCommand = createGrepCommand('grep');
export const egrepCommand = createGrepCommand('egrep');
