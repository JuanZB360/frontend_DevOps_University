/**
 * Analizador léxico del shell: convierte texto (una línea o un script entero)
 * en tokens.
 *
 * Soporta lo esencial de bash:
 *  - Comillas simples ('literal'), dobles ("con $VARS") y escape con \
 *  - Sustitución de comandos $(...) y `...`, y aritmética $((...))
 *  - Operadores de control: |  ||  &&  ;  ;;  &  (  )  y saltos de línea
 *  - Redirecciones: >  >>  <  2>  2>>  &>  2>&1  >&2  1>  1>>  <<  <<-  <<<
 *  - Here-documents (<<EOF ... EOF) con o sin expansión
 *  - Comentarios con # al inicio de una palabra
 *
 * Cada palabra se guarda como una lista de segmentos que recuerdan cómo
 * estaban entrecomillados, porque eso decide si luego se expanden variables
 * o comodines (* ?).
 */

export type QuoteKind = 'none' | 'single' | 'double';

export interface WordSegment {
  text: string;
  quote: QuoteKind;
  /** Si existe, el segmento no es texto sino una sustitución a ejecutar. */
  subst?: 'command' | 'arith';
}

export type ControlOperator = '|' | '||' | '&&' | ';' | ';;' | '&' | '(' | ')' | '\n';
export type RedirectOperator =
  | '>' | '>>' | '<' | '2>' | '2>>' | '&>' | '2>&1' | '>&2' | '<<' | '<<-' | '<<<';

export interface HereDoc {
  body: string;
  /** false si el delimitador iba entre comillas ('EOF'): el cuerpo no se expande. */
  expand: boolean;
}

export type Token =
  | { kind: 'word'; segments: WordSegment[] }
  | { kind: 'control'; value: ControlOperator }
  | { kind: 'redirect'; value: RedirectOperator; heredoc?: HereDoc };

export class ShellSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShellSyntaxError';
  }
}

/** Redirecciones ordenadas de la más larga a la más corta (para reconocer la más específica). */
const REDIRECTS: readonly RedirectOperator[] = ['2>&1', '<<<', '<<-', '>&2', '2>>', '&>', '2>', '>>', '<<', '>', '<'];
const CONTROLS: readonly ControlOperator[] = ['||', '&&', ';;', '|', ';', '&', '(', ')'];

/**
 * Busca el cierre de una sustitución $( ... ) teniendo en cuenta anidación y comillas.
 * @param start posición justo después de "$("
 * @returns índice del ")" de cierre
 */
function findClosingParen(input: string, start: number): number {
  let depth = 1;
  for (let i = start; i < input.length; i++) {
    const ch = input[i];
    if (ch === '\\') {
      i++;
    } else if (ch === "'") {
      const end = input.indexOf("'", i + 1);
      if (end === -1) break;
      i = end;
    } else if (ch === '"') {
      let j = i + 1;
      while (j < input.length && input[j] !== '"') j += input[j] === '\\' ? 2 : 1;
      i = j;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new ShellSyntaxError("unexpected EOF while looking for matching `)'");
}

/** Lee una sustitución que empieza en `i` ("$(", "$((" o "`"). Devuelve el segmento y la nueva posición. */
function readSubstitution(input: string, i: number, quote: QuoteKind): { segment: WordSegment; next: number } {
  if (input[i] === '`') {
    const end = input.indexOf('`', i + 1);
    if (end === -1) throw new ShellSyntaxError('unexpected EOF while looking for matching ``\'');
    return { segment: { text: input.slice(i + 1, end), quote, subst: 'command' }, next: end + 1 };
  }
  if (input.startsWith('$((', i)) {
    const end = findClosingParen(input, i + 3);
    if (input[end + 1] === ')') {
      return { segment: { text: input.slice(i + 3, end), quote, subst: 'arith' }, next: end + 2 };
    }
  }
  const end = findClosingParen(input, i + 2);
  return { segment: { text: input.slice(i + 2, end), quote, subst: 'command' }, next: end + 1 };
}

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let segments: WordSegment[] = [];
  /** Here-documents cuyo cuerpo empieza tras el próximo salto de línea. */
  const pendingHeredocs: { token: Extract<Token, { kind: 'redirect' }>; delimiter: string; stripTabs: boolean }[] = [];
  let i = 0;

  /** Añade texto al segmento actual, fusionando si el tipo de comillas coincide. */
  const append = (text: string, quote: QuoteKind): void => {
    const last = segments.at(-1);
    if (last && last.quote === quote && !last.subst) last.text += text;
    else segments.push({ text, quote });
  };

  /** Cierra la palabra en curso (si la hay) y la añade a los tokens. */
  const flushWord = (): void => {
    if (segments.length > 0) {
      const previous = tokens.at(-1);
      tokens.push({ kind: 'word', segments });
      // El delimitador de un here-document se registra para leer su cuerpo después.
      if (previous?.kind === 'redirect' && (previous.value === '<<' || previous.value === '<<-') && !previous.heredoc) {
        const quoted = segments.some((s) => s.quote !== 'none');
        previous.heredoc = { body: '', expand: !quoted };
        pendingHeredocs.push({ token: previous, delimiter: segments.map((s) => s.text).join(''), stripTabs: previous.value === '<<-' });
      }
    }
    segments = [];
  };

  /** Lee los cuerpos de los here-documents pendientes a partir de la línea siguiente. */
  const readHeredocBodies = (from: number): number => {
    let pos = from;
    for (const pending of pendingHeredocs) {
      const lines: string[] = [];
      let found = false;
      while (pos <= input.length) {
        const end = input.indexOf('\n', pos);
        const rawLine = input.slice(pos, end === -1 ? input.length : end);
        pos = end === -1 ? input.length + 1 : end + 1;
        const line = pending.stripTabs ? rawLine.replace(/^\t+/, '') : rawLine;
        if (line === pending.delimiter) {
          found = true;
          break;
        }
        lines.push(line);
        if (end === -1) break;
      }
      if (!found) throw new ShellSyntaxError(`here-document delimited by end-of-file (wanted \`${pending.delimiter}')`);
      pending.token.heredoc!.body = lines.length ? lines.join('\n') + '\n' : '';
    }
    pendingHeredocs.length = 0;
    return Math.min(pos, input.length);
  };

  while (i < input.length) {
    const ch = input[i];

    if (ch === '\n') {
      flushWord();
      tokens.push({ kind: 'control', value: '\n' });
      i++;
      if (pendingHeredocs.length) i = readHeredocBodies(i);
      continue;
    }

    // Espacios: separan palabras.
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      flushWord();
      i++;
      continue;
    }

    // Comentario: solo si empieza una palabra nueva. Llega hasta el final de la línea.
    if (ch === '#' && segments.length === 0) {
      const end = input.indexOf('\n', i);
      i = end === -1 ? input.length : end;
      continue;
    }

    // Comillas simples: todo literal hasta la siguiente '.
    if (ch === "'") {
      const end = input.indexOf("'", i + 1);
      if (end === -1) throw new ShellSyntaxError("unexpected EOF while looking for matching `''");
      append(input.slice(i + 1, end), 'single');
      i = end + 1;
      continue;
    }

    // Comillas dobles: \ solo escapa $ ` " \ ; variables y $(...) se expandirán después.
    if (ch === '"') {
      let j = i + 1;
      let text = '';
      let produced = false;
      while (j < input.length && input[j] !== '"') {
        if (input[j] === '\\' && j + 1 < input.length && '$`"\\\n'.includes(input[j + 1])) {
          if (input[j + 1] === '$' || input[j + 1] === '`') {
            // Un \$ debe quedar como $ literal: lo marcamos como segmento simple.
            append(text, 'double');
            text = '';
            append(input[j + 1], 'single');
            produced = true;
          } else if (input[j + 1] !== '\n') {
            text += input[j + 1];
          }
          j += 2;
          continue;
        }
        if ((input[j] === '$' && input[j + 1] === '(') || input[j] === '`') {
          if (text) append(text, 'double');
          text = '';
          const { segment, next } = readSubstitution(input, j, 'double');
          segments.push(segment);
          produced = true;
          j = next;
          continue;
        }
        text += input[j];
        j++;
      }
      if (j >= input.length) throw new ShellSyntaxError('unexpected EOF while looking for matching `"\'');
      if (text || !produced) append(text, 'double');
      i = j + 1;
      continue;
    }

    // Escape fuera de comillas: el siguiente carácter es literal (\ + salto de línea continúa la línea).
    if (ch === '\\') {
      if (input[i + 1] === '\n') {
        i += 2;
        continue;
      }
      if (i + 1 < input.length) append(input[i + 1], 'single');
      i += 2;
      continue;
    }

    // Sustituciones sin comillas.
    if ((ch === '$' && input[i + 1] === '(') || ch === '`') {
      const { segment, next } = readSubstitution(input, i, 'none');
      segments.push(segment);
      i = next;
      continue;
    }

    // ${VAR}: se mantiene entero aunque contenga caracteres especiales.
    if (ch === '$' && input[i + 1] === '{') {
      const end = input.indexOf('}', i + 2);
      if (end === -1) throw new ShellSyntaxError("unexpected EOF while looking for matching `}'");
      append(input.slice(i, end + 1), 'none');
      i = end + 1;
      continue;
    }

    // Redirecciones. "2>" solo cuenta si el 2 inicia la palabra (ej. "echo a2>b" no lo es).
    const redirect = REDIRECTS.find((op) => input.startsWith(op, i));
    if (redirect && (!redirect.startsWith('2') || segments.length === 0)) {
      flushWord();
      tokens.push({ kind: 'redirect', value: redirect });
      i += redirect.length;
      continue;
    }
    // "1>" y "1>>" son sinónimos de ">" y ">>".
    if (ch === '1' && segments.length === 0 && input[i + 1] === '>') {
      const isAppend = input[i + 2] === '>';
      tokens.push({ kind: 'redirect', value: isAppend ? '>>' : '>' });
      i += isAppend ? 3 : 2;
      continue;
    }

    const control = CONTROLS.find((op) => input.startsWith(op, i));
    if (control) {
      flushWord();
      tokens.push({ kind: 'control', value: control });
      i += control.length;
      continue;
    }

    append(ch, 'none');
    i++;
  }

  flushWord();
  if (pendingHeredocs.length) {
    const wanted = pendingHeredocs[0].delimiter;
    throw new ShellSyntaxError(`here-document delimited by end-of-file (wanted \`${wanted}')`);
  }
  return tokens;
}

/** Texto plano de una palabra sin expandir (útil para mensajes de error). */
export function rawWord(segments: readonly WordSegment[]): string {
  return segments.map((s) => (s.subst === 'command' ? `$(${s.text})` : s.subst === 'arith' ? `$((${s.text}))` : s.text)).join('');
}

/** ¿La palabra es un texto literal sin comillas ni sustituciones? (para palabras reservadas). */
export function literalWord(segments: readonly WordSegment[]): string | null {
  if (segments.length !== 1) return null;
  const [s] = segments;
  return s.quote === 'none' && !s.subst ? s.text : null;
}
