/**
 * Traducción de expresiones regulares POSIX a RegExp de JavaScript.
 *
 *  - BRE (básicas, grep y sed por defecto): `+ ? | ( ) { }` son literales;
 *    con barra (`\+ \? \| \( \) \{ \}`) son operadores.
 *  - ERE (extendidas, grep -E / sed -E / awk): los operadores van sin barra.
 *  - Clases POSIX: [[:digit:]] [[:alpha:]] [[:space:]] [[:upper:]]...
 */

const POSIX_CLASSES: Record<string, string> = {
  digit: '0-9',
  alpha: 'A-Za-z',
  alnum: 'A-Za-z0-9',
  upper: 'A-Z',
  lower: 'a-z',
  space: ' \\t\\n\\r\\f\\v',
  blank: ' \\t',
  punct: '!-\\/:-@\\[-`{-~',
  xdigit: '0-9A-Fa-f',
  word: 'A-Za-z0-9_',
};

export interface RegexOptions {
  extended?: boolean;
  ignoreCase?: boolean;
  global?: boolean;
  /** -F: el patrón es texto literal. */
  fixed?: boolean;
  /** -w: solo palabras completas. */
  word?: boolean;
  /** -x: la línea entera. */
  line?: boolean;
}

export class RegexError extends Error {}

function escapeLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** Convierte el cuerpo POSIX a sintaxis JavaScript. */
export function posixToJs(pattern: string, extended: boolean): string {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '[') {
      // Expresión entre corchetes: se copia traduciendo las clases POSIX.
      let j = i + 1;
      let body = '';
      if (pattern[j] === '^') {
        body += '^';
        j++;
      }
      if (pattern[j] === ']') {
        body += '\\]';
        j++;
      }
      while (j < pattern.length && pattern[j] !== ']') {
        const cls = /^\[:([a-z]+):\]/.exec(pattern.slice(j));
        if (cls) {
          body += POSIX_CLASSES[cls[1]] ?? '';
          j += cls[0].length;
          continue;
        }
        body += pattern[j] === '\\' ? '\\\\' : pattern[j];
        j++;
      }
      if (j >= pattern.length) throw new RegexError('Unmatched [, [^, [:, [., or [=');
      out += `[${body}]`;
      i = j;
      continue;
    }
    if (ch === '\\' && i + 1 < pattern.length) {
      const next = pattern[++i];
      if (!extended && '+?|(){}'.includes(next)) out += next;
      else if (next === '<' || next === '>') out += '\\b';
      else if (/[0-9wWsSbB.*[\]^$\\/]/.test(next)) out += '\\' + next;
      else out += escapeLiteral(next);
      continue;
    }
    if (!extended && '+?|(){}'.includes(ch)) {
      out += '\\' + ch;
      continue;
    }
    if (ch === '/') {
      out += '\\/';
      continue;
    }
    out += ch;
  }
  return out;
}

export function compileRegex(pattern: string, options: RegexOptions = {}): RegExp {
  let source = options.fixed ? escapeLiteral(pattern) : posixToJs(pattern, options.extended ?? false);
  if (options.word) source = `(?<![A-Za-z0-9_])(?:${source})(?![A-Za-z0-9_])`;
  if (options.line) source = `^(?:${source})$`;
  const flags = (options.ignoreCase ? 'i' : '') + (options.global ? 'g' : '');
  try {
    return new RegExp(source, flags);
  } catch {
    throw new RegexError('Invalid regular expression');
  }
}

/** Divide un texto en líneas sin la línea vacía final. */
export function splitLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}
