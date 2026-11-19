/**
 * Expansiones del shell, en el mismo orden que bash:
 *   1. Tilde:        ~  →  /home/usuario
 *   2. Parámetros:   $VAR, ${VAR}, ${VAR:-defecto}, ${#VAR}, $?, $1, $@...
 *   3. Comandos:     $(comando)  y  `comando`
 *   4. Aritmética:   $(( 1 + 2 ))
 *   5. Separación de palabras (solo lo expandido sin comillas)
 *   6. Comodines:    *.txt  →  a.txt b.txt
 *
 * Las comillas controlan qué se expande:
 *   - 'simples'  → nada
 *   - "dobles"   → variables, $(...) y $((...)), sin separar palabras ni comodines
 *   - sin comillas → todo
 */
import type { VirtualFileSystem } from '../vfs/VirtualFileSystem';
import { evaluateArithmetic } from './arithmetic';
import { expandGlob, hasGlob, unescapeGlob } from './glob';
import type { Word } from './parser';

export interface ExpansionContext {
  getVar(name: string): string | undefined;
  setVar?(name: string, value: string): void;
  /** Argumentos posicionales ($1, $2...) para "$@". */
  positional?(): readonly string[];
  /** Ejecuta un comando y devuelve su salida estándar (para $(...)). */
  runCommand?(text: string): Promise<string>;
  home: string;
  cwd: string;
  fs: VirtualFileSystem;
}

const VAR_PATTERN = /\$(?:\{([^}]*)\}|([A-Za-z_][A-Za-z0-9_]*)|([?$#@*!0-9]))/g;

/** Convierte un patrón de shell (*, ?) en expresión regular, para ${VAR%patrón} y case. */
export function shellPatternToRegExp(pattern: string, anchored: 'full' | 'start' | 'end', greedy = true): RegExp {
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\' && i + 1 < pattern.length) source += escapeRegExp(pattern[++i]);
    else if (ch === '*') source += greedy ? '.*' : '.*?';
    else if (ch === '?') source += '.';
    else if (ch === '[') {
      const end = pattern.indexOf(']', i + 1);
      if (end === -1) source += '\\[';
      else {
        source += '[' + pattern.slice(i + 1, end).replace(/^!/, '^') + ']';
        i = end;
      }
    } else source += escapeRegExp(ch);
  }
  if (anchored === 'full') return new RegExp(`^${source}$`, 's');
  if (anchored === 'start') return new RegExp(`^${source}`, 's');
  return new RegExp(`${source}$`, 's');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Resuelve el contenido de ${...}: VAR, #VAR, VAR:-x, VAR:=x, VAR:+x, VAR%p, VAR#p, VAR/a/b, VAR^^, VAR,, */
function expandBraced(inner: string, ctx: Pick<ExpansionContext, 'getVar' | 'setVar'>): string {
  if (inner.startsWith('#') && inner.length > 1) return String((ctx.getVar(inner.slice(1)) ?? '').length);
  const match = /^([A-Za-z_][A-Za-z0-9_]*|[0-9]+|[?$#@*!])(.*)$/s.exec(inner);
  if (!match) return '';
  const [, name, op] = match;
  const value = ctx.getVar(name);
  if (op === '') return value ?? '';
  const empty = value === undefined || value === '';
  if (op.startsWith(':-')) return empty ? op.slice(2) : value;
  if (op.startsWith('-')) return value === undefined ? op.slice(1) : value;
  if (op.startsWith(':=')) {
    if (empty) ctx.setVar?.(name, op.slice(2));
    return empty ? op.slice(2) : value;
  }
  if (op.startsWith(':+')) return empty ? '' : op.slice(2);
  if (op.startsWith(':?')) return value ?? '';
  const text = value ?? '';
  if (op.startsWith('%%')) return text.replace(shellPatternToRegExp(op.slice(2), 'end', true), '');
  if (op.startsWith('%')) {
    // Sufijo más corto: probamos desde el final.
    const re = shellPatternToRegExp(op.slice(1), 'full');
    for (let i = text.length; i >= 0; i--) if (re.test(text.slice(i))) return text.slice(0, i);
    return text;
  }
  if (op.startsWith('##')) return text.replace(shellPatternToRegExp(op.slice(2), 'start', true), '');
  if (op.startsWith('#')) return text.replace(shellPatternToRegExp(op.slice(1), 'start', false), '');
  if (op.startsWith('//') || op.startsWith('/')) {
    const all = op.startsWith('//');
    const [pattern, replacement = ''] = op.slice(all ? 2 : 1).split('/');
    const re = shellPatternToRegExp(pattern, 'full');
    const source = re.source.slice(1, -1);
    return text.replace(new RegExp(source, all ? 'gs' : 's'), replacement);
  }
  if (op === '^^') return text.toUpperCase();
  if (op === ',,') return text.toLowerCase();
  if (op.startsWith(':')) {
    const [offset, length] = op.slice(1).split(':').map((n) => Number(n.trim()));
    const start = offset < 0 ? Math.max(0, text.length + offset) : offset;
    return length === undefined || Number.isNaN(length) ? text.slice(start) : text.slice(start, start + length);
  }
  return text;
}

/** Sustituye las variables de un texto. Las no definidas se expanden a cadena vacía. */
export function expandVariables(text: string, ctx: Pick<ExpansionContext, 'getVar' | 'setVar'>): string {
  return text.replace(VAR_PATTERN, (_m, braced: string | undefined, plain: string | undefined, special: string | undefined) => {
    if (braced !== undefined) return expandBraced(braced, ctx);
    return ctx.getVar(plain ?? special ?? '') ?? '';
  });
}

/** Escapa comodines para que el glob los trate como literales. */
function escapeGlobChars(text: string): string {
  return text.replace(/[\\*?[]/g, '\\$&');
}

/** Un campo en construcción: patrón (con comodines activos) y texto plano. */
interface Field {
  pattern: string;
  plain: string;
  quoted: boolean;
}

/** Valor de una sustitución de comandos: sin los saltos de línea finales. */
async function commandOutput(text: string, ctx: ExpansionContext): Promise<string> {
  if (!ctx.runCommand) return '';
  return (await ctx.runCommand(text)).replace(/\n+$/, '');
}

/**
 * Expande una palabra y devuelve sus campos resultantes.
 * Normalmente es uno, pero la separación de palabras o un comodín pueden
 * producir varios (o ninguno si la palabra era una variable vacía sin comillas).
 */
export async function expandWord(word: Word, ctx: ExpansionContext): Promise<string[]> {
  // "$@" se expande a un campo por argumento, conservando los espacios de cada uno.
  if (word.length === 1 && word[0].quote === 'double' && !word[0].subst && word[0].text === '$@') {
    return [...(ctx.positional?.() ?? [])];
  }

  const fields: Field[] = [{ pattern: '', plain: '', quoted: false }];
  let current = fields[0];

  const appendLiteral = (text: string, quoted: boolean): void => {
    current.pattern += quoted ? escapeGlobChars(text) : text;
    current.plain += text;
    if (quoted) current.quoted = true;
  };
  /** Añade el resultado de una expansión sin comillas: se separa por espacios. */
  const appendSplittable = (value: string): void => {
    const parts = value.split(/[ \t\n]+/);
    parts.forEach((part, index) => {
      if (index > 0) {
        current = { pattern: '', plain: '', quoted: false };
        fields.push(current);
      }
      current.pattern += escapeGlobChars(part);
      current.plain += part;
    });
  };

  for (let index = 0; index < word.length; index++) {
    const segment = word[index];
    if (segment.subst) {
      const value = segment.subst === 'arith'
        ? String(evaluateArithmetic(expandVariables(segment.text, ctx), (n) => ctx.getVar(n)))
        : await commandOutput(segment.text, ctx);
      if (segment.quote === 'none') appendSplittable(value);
      else appendLiteral(value, true);
      continue;
    }
    if (segment.quote === 'single') {
      appendLiteral(segment.text, true);
      continue;
    }
    if (segment.quote === 'double') {
      appendLiteral(expandVariables(segment.text, ctx), true);
      continue;
    }
    // Sin comillas: tilde, variables (separables) y texto literal con comodines activos.
    let text = segment.text;
    if (index === 0) text = expandTilde(text, ctx.home);
    let last = 0;
    for (const match of text.matchAll(VAR_PATTERN)) {
      const literal = text.slice(last, match.index);
      current.pattern += literal;
      current.plain += literal;
      const value = match[1] !== undefined ? expandBraced(match[1], ctx) : ctx.getVar(match[2] ?? match[3]) ?? '';
      appendSplittable(value);
      last = match.index + match[0].length;
    }
    current.pattern += text.slice(last);
    current.plain += text.slice(last);
  }

  const result: string[] = [];
  for (const field of fields) {
    if (hasGlob(field.pattern)) {
      const matches = expandGlob(field.pattern, ctx.cwd, ctx.fs);
      result.push(...(matches.length > 0 ? matches : [unescapeGlob(field.pattern)]));
      continue;
    }
    // Una variable vacía sin comillas desaparece: `echo $NADA` no recibe argumentos.
    if (field.plain === '' && !field.quoted) continue;
    result.push(field.plain);
  }
  return result;
}

/** Expande a un único texto (para destinos de redirección, asignaciones y case). */
export async function expandWordToString(word: Word, ctx: ExpansionContext): Promise<string> {
  const parts: string[] = [];
  for (let index = 0; index < word.length; index++) {
    const segment = word[index];
    if (segment.subst === 'arith') {
      parts.push(String(evaluateArithmetic(expandVariables(segment.text, ctx), (n) => ctx.getVar(n))));
    } else if (segment.subst === 'command') {
      parts.push(await commandOutput(segment.text, ctx));
    } else if (segment.quote === 'single') {
      parts.push(segment.text);
    } else {
      const text = segment.quote === 'none' && index === 0 ? expandTilde(segment.text, ctx.home) : segment.text;
      parts.push(expandVariables(text, ctx));
    }
  }
  return parts.join('');
}

/** Como expandWordToString pero conservando comodines activos (para patrones de case). */
export async function expandPattern(word: Word, ctx: ExpansionContext): Promise<string> {
  const parts: string[] = [];
  for (const segment of word) {
    if (segment.subst || segment.quote !== 'none') {
      const text = await expandWordToString([segment], ctx);
      parts.push(text.replace(/[\\*?[]/g, '\\$&'));
    } else {
      parts.push(expandVariables(segment.text, ctx));
    }
  }
  return parts.join('');
}

function expandTilde(text: string, home: string): string {
  if (text === '~') return home;
  if (text.startsWith('~/')) return home + text.slice(1);
  return text;
}
