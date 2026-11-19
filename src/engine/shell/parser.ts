/**
 * Analizador sintáctico: convierte tokens en un árbol (AST) ejecutable.
 *
 * Gramática soportada (subconjunto de bash):
 *   script     := list
 *   list       := and_or ( ( ';' | '&' | '\n' ) and_or )*
 *   and_or     := pipeline ( ( '&&' | '||' ) linebreak pipeline )*
 *   pipeline   := [ '!' ] command ( '|' linebreak command )*
 *   command    := simple | compound redirect*  | funcdef
 *   compound   := if | for | while | until | case | '{' list '}' | '(' list ')'
 *   funcdef    := [ 'function' ] NAME '(' ')' compound | 'function' NAME compound
 */
import { literalWord, ShellSyntaxError, tokenize, type HereDoc, type RedirectOperator, type Token, type WordSegment } from './tokenizer';

export type Word = WordSegment[];

export interface Redirect {
  op: RedirectOperator;
  /** Archivo destino. No existe en las duplicaciones 2>&1 y >&2. */
  target?: Word;
  heredoc?: HereDoc;
}

export interface Assignment {
  name: string;
  value: Word;
}

export interface SimpleCommand {
  type: 'simple';
  assignments: Assignment[];
  words: Word[];
  redirects: Redirect[];
}

export interface IfCommand {
  type: 'if';
  branches: { condition: Script; body: Script }[];
  elseBody: Script | null;
  redirects: Redirect[];
}

export interface ForCommand {
  type: 'for';
  variable: string;
  /** null = sin "in": recorre los argumentos posicionales. */
  items: Word[] | null;
  body: Script;
  redirects: Redirect[];
}

export interface WhileCommand {
  type: 'while';
  until: boolean;
  condition: Script;
  body: Script;
  redirects: Redirect[];
}

export interface CaseCommand {
  type: 'case';
  subject: Word;
  clauses: { patterns: Word[]; body: Script }[];
  redirects: Redirect[];
}

export interface GroupCommand {
  type: 'group';
  /** true para ( ... ): se ejecuta en un subshell que no altera al padre. */
  subshell: boolean;
  body: Script;
  redirects: Redirect[];
}

export interface FunctionDefinition {
  type: 'function';
  name: string;
  body: Command;
}

export type Command = SimpleCommand | IfCommand | ForCommand | WhileCommand | CaseCommand | GroupCommand | FunctionDefinition;

export interface Pipeline {
  commands: Command[];
  /** `! comando` invierte el código de salida. */
  negated: boolean;
}

/** Operador que une un pipeline con el siguiente. */
export type ListOperator = '&&' | '||' | ';';

export interface ListItem {
  pipeline: Pipeline;
  /** Cómo se encadena con el siguiente elemento (null si es el último). */
  next: ListOperator | null;
  /** Terminaba en `&` (segundo plano). */
  background: boolean;
}

export type Script = ListItem[];

const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)(\+?)=/;
const NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** Palabras que terminan una lista dentro de una estructura. */
const TERMINATORS = new Set(['then', 'elif', 'else', 'fi', 'do', 'done', 'esac', '}']);

/** Redirecciones que no necesitan archivo destino. */
const DUPLICATIONS: readonly RedirectOperator[] = ['2>&1', '>&2'];

export function parse(input: string): Script {
  const parser = new Parser(tokenize(input));
  const script = parser.parseList([]);
  parser.expectEnd();
  return script;
}

class Parser {
  private readonly tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  expectEnd(): void {
    this.skipNewlines();
    const token = this.peek();
    if (token) throw unexpected(token);
  }

  /** Lista de and_or hasta encontrar una palabra de cierre o ')' / ';;'. */
  parseList(stopWords: readonly string[]): Script {
    const items: ListItem[] = [];
    for (;;) {
      this.skipNewlines();
      const token = this.peek();
      if (!token) break;
      if (token.kind === 'control' && (token.value === ')' || token.value === ';;')) break;
      const keyword = this.keyword();
      if (keyword && (stopWords.includes(keyword) || TERMINATORS.has(keyword))) break;

      this.parseAndOr(items);
      const separator = this.peek();
      if (separator?.kind === 'control' && (separator.value === ';' || separator.value === '&' || separator.value === '\n')) {
        this.pos++;
        if (separator.value === '&') {
          // Todo el and_or anterior va en segundo plano.
          items.at(-1)!.background = true;
        }
        continue;
      }
      break;
    }
    // El último elemento no encadena con nada.
    const last = items.at(-1);
    if (last) last.next = null;
    return items;
  }

  /** pipeline ( (&& | ||) pipeline )* — añade los elementos a `items`. */
  private parseAndOr(items: ListItem[]): void {
    for (;;) {
      const item: ListItem = { pipeline: this.parsePipeline(), next: ';', background: false };
      items.push(item);
      const token = this.peek();
      if (token?.kind === 'control' && (token.value === '&&' || token.value === '||')) {
        this.pos++;
        item.next = token.value;
        this.skipNewlines();
        if (!this.peek()) throw new ShellSyntaxError('syntax error: unexpected end of file');
        continue;
      }
      return;
    }
  }

  private parsePipeline(): Pipeline {
    let negated = false;
    if (this.keyword() === '!') {
      negated = true;
      this.pos++;
    }
    const commands = [this.parseCommand()];
    while (this.peekControl('|')) {
      this.pos++;
      this.skipNewlines();
      commands.push(this.parseCommand());
    }
    return { commands, negated };
  }

  private parseCommand(): Command {
    const token = this.peek();
    if (!token) throw new ShellSyntaxError('syntax error: unexpected end of file');
    if (token.kind === 'control') {
      if (token.value === '(') {
        this.pos++;
        const body = this.parseList([]);
        this.expectControl(')');
        return { type: 'group', subshell: true, body, redirects: this.parseRedirects() };
      }
      throw unexpected(token);
    }

    switch (this.keyword()) {
      case 'if': return this.parseIf();
      case 'for': return this.parseFor();
      case 'while': return this.parseWhile(false);
      case 'until': return this.parseWhile(true);
      case 'case': return this.parseCase();
      case '{': {
        this.pos++;
        const body = this.parseList(['}']);
        this.expectKeyword('}');
        return { type: 'group', subshell: false, body, redirects: this.parseRedirects() };
      }
      case 'function': {
        this.pos++;
        const name = this.expectName();
        if (this.peekControl('(')) {
          this.pos++;
          this.expectControl(')');
        }
        this.skipNewlines();
        return { type: 'function', name, body: this.parseCommand() };
      }
      default:
        break;
    }

    // nombre() { ... }
    const name = this.keyword();
    const after = this.tokens[this.pos + 1];
    const afterNext = this.tokens[this.pos + 2];
    if (name && NAME.test(name) && after?.kind === 'control' && after.value === '(' && afterNext?.kind === 'control' && afterNext.value === ')') {
      this.pos += 3;
      this.skipNewlines();
      return { type: 'function', name, body: this.parseCommand() };
    }

    return this.parseSimple();
  }

  private parseSimple(): SimpleCommand {
    const command: SimpleCommand = { type: 'simple', assignments: [], words: [], redirects: [] };
    while (this.pos < this.tokens.length) {
      const token = this.tokens[this.pos];
      if (token.kind === 'control') break;
      if (token.kind === 'redirect') {
        command.redirects.push(this.parseRedirect());
        continue;
      }
      this.pos++;
      // Palabra: puede ser una asignación VAR=valor si aún no hay comando.
      const assignment = command.words.length === 0 ? asAssignment(token.segments) : null;
      if (assignment) command.assignments.push(assignment);
      else command.words.push(token.segments);
    }
    if (command.words.length === 0 && command.assignments.length === 0 && command.redirects.length === 0) {
      throw unexpected(this.peek());
    }
    return command;
  }

  private parseIf(): IfCommand {
    this.pos++; // if
    const branches: IfCommand['branches'] = [];
    let elseBody: Script | null = null;
    let condition = this.parseList(['then']);
    this.expectKeyword('then');
    let body = this.parseList(['elif', 'else', 'fi']);
    branches.push({ condition, body });
    for (;;) {
      const keyword = this.keyword();
      if (keyword === 'elif') {
        this.pos++;
        condition = this.parseList(['then']);
        this.expectKeyword('then');
        body = this.parseList(['elif', 'else', 'fi']);
        branches.push({ condition, body });
        continue;
      }
      if (keyword === 'else') {
        this.pos++;
        elseBody = this.parseList(['fi']);
      }
      this.expectKeyword('fi');
      break;
    }
    return { type: 'if', branches, elseBody, redirects: this.parseRedirects() };
  }

  private parseFor(): ForCommand {
    this.pos++; // for
    const variable = this.expectName();
    let items: Word[] | null = null;
    this.skipNewlines();
    if (this.keyword() === 'in') {
      this.pos++;
      items = [];
      while (this.peek()?.kind === 'word') {
        items.push((this.tokens[this.pos++] as Extract<Token, { kind: 'word' }>).segments);
      }
    }
    this.skipSeparators();
    this.expectKeyword('do');
    const body = this.parseList(['done']);
    this.expectKeyword('done');
    return { type: 'for', variable, items, body, redirects: this.parseRedirects() };
  }

  private parseWhile(until: boolean): WhileCommand {
    this.pos++; // while / until
    const condition = this.parseList(['do']);
    this.expectKeyword('do');
    const body = this.parseList(['done']);
    this.expectKeyword('done');
    return { type: 'while', until, condition, body, redirects: this.parseRedirects() };
  }

  private parseCase(): CaseCommand {
    this.pos++; // case
    const subject = this.expectWord();
    this.skipNewlines();
    this.expectKeyword('in');
    const clauses: CaseCommand['clauses'] = [];
    for (;;) {
      this.skipNewlines();
      if (this.keyword() === 'esac') break;
      if (this.peekControl('(')) this.pos++;
      const patterns = [this.expectWord()];
      while (this.peekControl('|')) {
        this.pos++;
        patterns.push(this.expectWord());
      }
      this.expectControl(')');
      const body = this.parseList(['esac']);
      clauses.push({ patterns, body });
      if (this.peekControl(';;')) {
        this.pos++;
        continue;
      }
      this.skipNewlines();
      if (this.keyword() !== 'esac') throw unexpected(this.peek());
    }
    this.expectKeyword('esac');
    return { type: 'case', subject, clauses, redirects: this.parseRedirects() };
  }

  private parseRedirects(): Redirect[] {
    const redirects: Redirect[] = [];
    while (this.peek()?.kind === 'redirect') redirects.push(this.parseRedirect());
    return redirects;
  }

  private parseRedirect(): Redirect {
    const token = this.tokens[this.pos++] as Extract<Token, { kind: 'redirect' }>;
    if (DUPLICATIONS.includes(token.value)) return { op: token.value };
    const target = this.tokens[this.pos];
    if (!target || target.kind !== 'word') throw unexpected(target);
    this.pos++;
    return { op: token.value, target: target.segments, heredoc: token.heredoc };
  }

  // ─────────────────────────────── Utilidades ───────────────────────────────

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  /** Texto de la palabra actual si es un literal sin comillas (posible palabra reservada). */
  private keyword(): string | null {
    const token = this.tokens[this.pos];
    return token?.kind === 'word' ? literalWord(token.segments) : null;
  }

  private peekControl(value: string): boolean {
    const token = this.tokens[this.pos];
    return token?.kind === 'control' && token.value === value;
  }

  private skipNewlines(): void {
    while (this.peekControl('\n')) this.pos++;
  }

  private skipSeparators(): void {
    while (this.peekControl('\n') || this.peekControl(';')) this.pos++;
  }

  private expectKeyword(word: string): void {
    this.skipNewlines();
    if (this.keyword() !== word) {
      const token = this.peek();
      if (!token) throw new ShellSyntaxError(`syntax error: unexpected end of file (falta '${word}')`);
      throw unexpected(token);
    }
    this.pos++;
  }

  private expectControl(value: string): void {
    this.skipNewlines();
    if (!this.peekControl(value)) {
      const token = this.peek();
      if (!token) throw new ShellSyntaxError(`syntax error: unexpected end of file (falta '${value}')`);
      throw unexpected(token);
    }
    this.pos++;
  }

  private expectName(): string {
    const name = this.keyword();
    if (!name || !NAME.test(name)) throw unexpected(this.peek());
    this.pos++;
    return name;
  }

  private expectWord(): Word {
    const token = this.peek();
    if (token?.kind !== 'word') throw unexpected(token);
    this.pos++;
    return token.segments;
  }
}

/** Detecta `NOMBRE=valor` y `NOMBRE+=valor` (el nombre debe estar sin comillas). */
function asAssignment(segments: Word): Assignment | null {
  const first = segments[0];
  if (!first || first.quote !== 'none' || first.subst) return null;
  const match = ASSIGNMENT.exec(first.text);
  if (!match) return null;
  const rest = first.text.slice(match[0].length);
  const value: Word = [...(rest ? [{ text: rest, quote: 'none' as const }] : []), ...segments.slice(1)];
  // `+=` añade al valor actual: se representa como prefijo "$NOMBRE".
  if (match[2] === '+') value.unshift({ text: `\${${match[1]}}`, quote: 'double' });
  return { name: match[1], value };
}

function unexpected(token: Token | undefined): ShellSyntaxError {
  if (!token) return new ShellSyntaxError("syntax error near unexpected token `newline'");
  const text = token.kind === 'word'
    ? token.segments.map((s) => s.text).join('')
    : token.value === '\n' ? 'newline' : token.value;
  return new ShellSyntaxError(`syntax error near unexpected token \`${text}'`);
}
