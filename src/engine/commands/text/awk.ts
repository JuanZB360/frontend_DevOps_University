/**
 * awk — lenguaje para procesar texto por columnas.
 *
 * Subconjunto amplio de POSIX awk:
 *   - Reglas  patrón { acción }, BEGIN, END, /regex/, expresiones, rangos p1,p2
 *   - Campos $0 $1 ... $NF, variables NR NF FS OFS ORS RS FILENAME
 *   - print, printf, if/else, while, do, for(;;), for (k in arr), next, exit,
 *     break, continue, delete, arrays asociativos, getline no.
 *   - Operadores: + - * / % ^ ++ -- += -= *= /= %= == != < <= > >= ~ !~ && || ! ?: in
 *     y concatenación por yuxtaposición.
 *   - Funciones: length substr index split sub gsub match sprintf tolower toupper
 *     int sqrt rand srand system no.
 */
import type { Command } from '../Command';
import { EXIT_USAGE, readInputs } from '../helpers';
import { compileRegex, posixToJs, splitLines } from './regex';

// ─────────────────────────────── Léxico ───────────────────────────────

type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 're'; v: string }
  | { t: 'name'; v: string }
  | { t: 'func'; v: string }
  | { t: 'kw'; v: string }
  | { t: 'op'; v: string }
  | { t: 'nl' }
  | { t: 'eof' };

const KEYWORDS = new Set(['BEGIN', 'END', 'print', 'printf', 'if', 'else', 'while', 'for', 'do', 'in', 'next', 'exit', 'break', 'continue', 'delete', 'function', 'return', 'getline']);
const BUILTINS = new Set(['length', 'substr', 'index', 'split', 'sub', 'gsub', 'match', 'sprintf', 'tolower', 'toupper', 'int', 'sqrt', 'rand', 'srand', 'exp', 'log', 'sin', 'cos', 'atan2', 'system', 'close']);
const OPS = ['+=', '-=', '*=', '/=', '%=', '^=', '==', '!=', '<=', '>=', '&&', '||', '++', '--', '!~', '>>', '{', '}', '(', ')', '[', ']', ';', ',', '+', '-', '*', '/', '%', '^', '!', '<', '>', '~', '?', ':', '=', '$', '|'];

export class AwkError extends Error {}

function lex(source: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  /** Una / inicia regex si lo anterior no puede ser el final de un operando. */
  const regexAllowed = (): boolean => {
    const last = toks.at(-1);
    if (!last) return true;
    if (last.t === 'num' || last.t === 'str' || last.t === 'name' || last.t === 're') return false;
    if (last.t === 'op' && (last.v === ')' || last.v === ']' || last.v === '$' || last.v === '++' || last.v === '--')) return false;
    if (last.t === 'func') return false;
    return true;
  };
  while (i < source.length) {
    const ch = source[i];
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\\' && source[i + 1] === '\n') {
      i += 2;
      continue;
    }
    if (ch === '\n') {
      toks.push({ t: 'nl' });
      i++;
      continue;
    }
    if (ch === '#') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (ch === '"') {
      let v = '';
      i++;
      while (i < source.length && source[i] !== '"') {
        if (source[i] === '\\' && i + 1 < source.length) {
          const n = source[++i];
          v += ({ n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', '/': '/' } as Record<string, string>)[n] ?? '\\' + n;
        } else v += source[i];
        i++;
      }
      if (i >= source.length) throw new AwkError('unterminated string');
      i++;
      toks.push({ t: 'str', v });
      continue;
    }
    if (ch === '/' && regexAllowed()) {
      let v = '';
      i++;
      while (i < source.length && source[i] !== '/') {
        if (source[i] === '\\' && i + 1 < source.length) {
          v += source[i] + source[i + 1];
          i += 2;
          continue;
        }
        if (source[i] === '\n') throw new AwkError('unterminated regexp');
        v += source[i++];
      }
      if (i >= source.length) throw new AwkError('unterminated regexp');
      i++;
      toks.push({ t: 're', v });
      continue;
    }
    const num = /^(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)/.exec(source.slice(i));
    if (num) {
      toks.push({ t: 'num', v: Number(num[1]) });
      i += num[1].length;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i));
    if (word) {
      const w = word[0];
      i += w.length;
      if (KEYWORDS.has(w)) toks.push({ t: 'kw', v: w });
      else if (BUILTINS.has(w)) toks.push({ t: 'func', v: w });
      else toks.push({ t: 'name', v: w });
      continue;
    }
    const op = OPS.find((o) => source.startsWith(o, i));
    if (op) {
      toks.push({ t: 'op', v: op });
      i += op.length;
      continue;
    }
    throw new AwkError(`syntax error at source line 1: unexpected character '${ch}'`);
  }
  toks.push({ t: 'eof' });
  return toks;
}

// ─────────────────────────────── AST ───────────────────────────────

type Expr =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 're'; v: string }
  | { k: 'var'; name: string }
  | { k: 'field'; index: Expr }
  | { k: 'index'; name: string; keys: Expr[] }
  | { k: 'assign'; op: string; target: Expr; value: Expr }
  | { k: 'cond'; test: Expr; yes: Expr; no: Expr }
  | { k: 'bin'; op: string; left: Expr; right: Expr }
  | { k: 'un'; op: string; arg: Expr }
  | { k: 'incdec'; op: '++' | '--'; prefix: boolean; target: Expr }
  | { k: 'match'; negate: boolean; left: Expr; right: Expr }
  | { k: 'in'; key: Expr[]; name: string }
  | { k: 'call'; name: string; args: Expr[] }
  | { k: 'concat'; parts: Expr[] }
  | { k: 'group'; e: Expr };

type Stmt =
  | { k: 'expr'; e: Expr }
  | { k: 'print'; args: Expr[]; printf: boolean; redirect: { op: string; target: Expr } | null }
  | { k: 'if'; test: Expr; yes: Stmt; no: Stmt | null }
  | { k: 'while'; test: Expr; body: Stmt }
  | { k: 'do'; test: Expr; body: Stmt }
  | { k: 'for'; init: Stmt | null; test: Expr | null; step: Stmt | null; body: Stmt }
  | { k: 'forin'; variable: string; array: string; body: Stmt }
  | { k: 'block'; body: Stmt[] }
  | { k: 'next' }
  | { k: 'exit'; code: Expr | null }
  | { k: 'break' }
  | { k: 'continue' }
  | { k: 'return'; value: Expr | null }
  | { k: 'delete'; name: string; keys: Expr[] | null };

interface Rule {
  kind: 'begin' | 'end' | 'main';
  pattern: Expr | null;
  pattern2: Expr | null;
  action: Stmt[] | null;
  inRange?: boolean;
}

interface FunctionDef {
  params: string[];
  body: Stmt[];
}

class Parser {
  private pos = 0;
  private readonly toks: Tok[];
  /** Dentro de print no se acepta '>' como comparación (es una redirección). */
  private noGreater = false;
  private noIn = false;

  constructor(toks: Tok[]) {
    this.toks = toks;
  }

  private peek(offset = 0): Tok {
    return this.toks[this.pos + offset];
  }

  private isOp(v: string): boolean {
    const t = this.peek();
    return t.t === 'op' && t.v === v;
  }

  private isKw(v: string): boolean {
    const t = this.peek();
    return t.t === 'kw' && t.v === v;
  }

  private expectOp(v: string): void {
    if (!this.isOp(v)) throw new AwkError(`syntax error: expected '${v}'`);
    this.pos++;
  }

  private skipNl(): void {
    while (this.peek().t === 'nl' || this.isOp(';')) this.pos++;
  }

  private optNl(): void {
    while (this.peek().t === 'nl') this.pos++;
  }

  program(): { rules: Rule[]; functions: Map<string, FunctionDef> } {
    const rules: Rule[] = [];
    const functions = new Map<string, FunctionDef>();
    this.skipNl();
    while (this.peek().t !== 'eof') {
      if (this.isKw('function')) {
        this.pos++;
        const name = this.peek();
        if (name.t !== 'name' && name.t !== 'func') throw new AwkError('syntax error in function definition');
        this.pos++;
        this.expectOp('(');
        const params: string[] = [];
        while (!this.isOp(')')) {
          const p = this.peek();
          if (p.t !== 'name') throw new AwkError('syntax error in parameter list');
          params.push(p.v);
          this.pos++;
          if (this.isOp(',')) this.pos++;
        }
        this.pos++;
        this.optNl();
        functions.set((name as { v: string }).v, { params, body: this.block() });
      } else if (this.isKw('BEGIN') || this.isKw('END')) {
        const kind = (this.peek() as { v: string }).v === 'BEGIN' ? 'begin' : 'end';
        this.pos++;
        this.optNl();
        rules.push({ kind, pattern: null, pattern2: null, action: this.block() });
      } else {
        let pattern: Expr | null = null;
        let pattern2: Expr | null = null;
        if (!this.isOp('{')) {
          pattern = this.expr();
          if (this.isOp(',')) {
            this.pos++;
            this.optNl();
            pattern2 = this.expr();
          }
        }
        const action = this.isOp('{') ? this.block() : null;
        rules.push({ kind: 'main', pattern, pattern2, action });
      }
      this.skipNl();
    }
    return { rules, functions };
  }

  private block(): Stmt[] {
    this.expectOp('{');
    const body: Stmt[] = [];
    this.skipNl();
    while (!this.isOp('}')) {
      if (this.peek().t === 'eof') throw new AwkError("syntax error: missing '}'");
      body.push(this.statement());
      this.skipNl();
    }
    this.pos++;
    return body;
  }

  private simpleOrBlock(): Stmt {
    this.optNl();
    if (this.isOp('{')) return { k: 'block', body: this.block() };
    const s = this.statement();
    return s;
  }

  private endStatement(): void {
    if (this.isOp(';') || this.peek().t === 'nl') this.pos++;
  }

  private statement(): Stmt {
    const t = this.peek();
    if (t.t === 'op' && t.v === '{') return { k: 'block', body: this.block() };
    if (t.t === 'kw') {
      switch (t.v) {
        case 'if': {
          this.pos++;
          this.expectOp('(');
          const test = this.expr();
          this.expectOp(')');
          const yes = this.simpleOrBlock();
          // "else" puede venir tras ; o saltos de línea.
          const save = this.pos;
          this.skipNl();
          if (this.isKw('else')) {
            this.pos++;
            return { k: 'if', test, yes, no: this.simpleOrBlock() };
          }
          this.pos = save;
          return { k: 'if', test, yes, no: null };
        }
        case 'while': {
          this.pos++;
          this.expectOp('(');
          const test = this.expr();
          this.expectOp(')');
          if (this.isOp(';')) {
            this.pos++;
            return { k: 'while', test, body: { k: 'block', body: [] } };
          }
          return { k: 'while', test, body: this.simpleOrBlock() };
        }
        case 'do': {
          this.pos++;
          const body = this.simpleOrBlock();
          this.skipNl();
          if (!this.isKw('while')) throw new AwkError('syntax error: expected while');
          this.pos++;
          this.expectOp('(');
          const test = this.expr();
          this.expectOp(')');
          this.endStatement();
          return { k: 'do', test, body };
        }
        case 'for': {
          this.pos++;
          this.expectOp('(');
          const a = this.peek();
          const b = this.peek(1);
          const c = this.peek(2);
          if (a.t === 'name' && b.t === 'kw' && b.v === 'in' && c.t === 'name' && this.peek(3).t === 'op' && (this.peek(3) as { v: string }).v === ')') {
            this.pos += 4;
            return { k: 'forin', variable: a.v, array: c.v, body: this.simpleOrBlock() };
          }
          const init = this.isOp(';') ? null : this.simple();
          this.expectOp(';');
          this.optNl();
          const test = this.isOp(';') ? null : this.expr();
          this.expectOp(';');
          this.optNl();
          const step = this.isOp(')') ? null : this.simple();
          this.expectOp(')');
          if (this.isOp(';')) {
            this.pos++;
            return { k: 'for', init, test, step, body: { k: 'block', body: [] } };
          }
          return { k: 'for', init, test, step, body: this.simpleOrBlock() };
        }
        case 'next': this.pos++; this.endStatement(); return { k: 'next' };
        case 'break': this.pos++; this.endStatement(); return { k: 'break' };
        case 'continue': this.pos++; this.endStatement(); return { k: 'continue' };
        case 'exit': {
          this.pos++;
          const code = this.atEnd() ? null : this.expr();
          this.endStatement();
          return { k: 'exit', code };
        }
        case 'return': {
          this.pos++;
          const value = this.atEnd() ? null : this.expr();
          this.endStatement();
          return { k: 'return', value };
        }
        case 'delete': {
          this.pos++;
          const name = this.peek();
          if (name.t !== 'name') throw new AwkError('syntax error in delete');
          this.pos++;
          let keys: Expr[] | null = null;
          if (this.isOp('[')) {
            this.pos++;
            keys = this.exprList(']');
          }
          this.endStatement();
          return { k: 'delete', name: name.v, keys };
        }
        default:
          break;
      }
    }
    const s = this.simple();
    this.endStatement();
    return s;
  }

  private atEnd(): boolean {
    const t = this.peek();
    return t.t === 'nl' || t.t === 'eof' || (t.t === 'op' && (t.v === ';' || t.v === '}'));
  }

  /** print, printf o expresión. */
  private simple(): Stmt {
    if (this.isKw('print') || this.isKw('printf')) {
      const printf = (this.peek() as { v: string }).v === 'printf';
      this.pos++;
      let args: Expr[] = [];
      this.noGreater = true;
      if (this.isOp('(')) {
        // print (a, b) > "f"  — los paréntesis pueden envolver la lista.
        const save = this.pos;
        this.pos++;
        try {
          const list = this.exprList(')');
          if (this.atEnd() || this.isOp('>') || this.isOp('>>') || this.isOp('|')) args = list;
          else {
            this.pos = save;
            args = this.printArgs();
          }
        } catch {
          this.pos = save;
          args = this.printArgs();
        }
      } else if (!this.atEnd() && !this.isOp('>') && !this.isOp('>>') && !this.isOp('|')) {
        args = this.printArgs();
      }
      this.noGreater = false;
      let redirect: { op: string; target: Expr } | null = null;
      if (this.isOp('>') || this.isOp('>>') || this.isOp('|')) {
        const op = (this.peek() as { v: string }).v;
        this.pos++;
        redirect = { op, target: this.concatenation() };
      }
      return { k: 'print', args, printf, redirect };
    }
    return { k: 'expr', e: this.expr() };
  }

  private printArgs(): Expr[] {
    const args = [this.expr()];
    while (this.isOp(',')) {
      this.pos++;
      this.optNl();
      args.push(this.expr());
    }
    return args;
  }

  private exprList(close: string): Expr[] {
    const list: Expr[] = [];
    this.optNl();
    while (!this.isOp(close)) {
      list.push(this.expr());
      this.optNl();
      if (this.isOp(',')) {
        this.pos++;
        this.optNl();
      } else if (!this.isOp(close)) throw new AwkError(`syntax error: expected '${close}'`);
    }
    this.pos++;
    return list;
  }

  expr(): Expr {
    return this.ternary();
  }

  private ternary(): Expr {
    const test = this.or();
    if (this.isOp('?')) {
      this.pos++;
      this.optNl();
      const yes = this.ternary();
      this.optNl();
      this.expectOp(':');
      this.optNl();
      const no = this.ternary();
      return { k: 'cond', test, yes, no };
    }
    const assignOps = ['=', '+=', '-=', '*=', '/=', '%=', '^='];
    const t = this.peek();
    if (t.t === 'op' && assignOps.includes(t.v) && (test.k === 'var' || test.k === 'field' || test.k === 'index')) {
      this.pos++;
      this.optNl();
      return { k: 'assign', op: t.v, target: test, value: this.ternary() };
    }
    return test;
  }

  private or(): Expr {
    let left = this.and();
    while (this.isOp('||')) {
      this.pos++;
      this.optNl();
      left = { k: 'bin', op: '||', left, right: this.and() };
    }
    return left;
  }

  private and(): Expr {
    let left = this.inExpr();
    while (this.isOp('&&')) {
      this.pos++;
      this.optNl();
      left = { k: 'bin', op: '&&', left, right: this.inExpr() };
    }
    return left;
  }

  private inExpr(): Expr {
    let left = this.matchExpr();
    while (!this.noIn && this.isKw('in')) {
      this.pos++;
      const name = this.peek();
      if (name.t !== 'name') throw new AwkError('syntax error after in');
      this.pos++;
      left = { k: 'in', key: left.k === 'group' && left.e.k === 'concat' ? [left.e] : [left], name: name.v };
    }
    return left;
  }

  private matchExpr(): Expr {
    let left = this.comparison();
    while (this.isOp('~') || this.isOp('!~')) {
      const negate = (this.peek() as { v: string }).v === '!~';
      this.pos++;
      left = { k: 'match', negate, left, right: this.comparison() };
    }
    return left;
  }

  private comparison(): Expr {
    const left = this.concatenation();
    const t = this.peek();
    if (t.t === 'op' && ['<', '<=', '==', '!=', '>=', '>'].includes(t.v) && !(this.noGreater && t.v === '>')) {
      this.pos++;
      return { k: 'bin', op: t.v, left, right: this.concatenation() };
    }
    return left;
  }

  private concatenation(): Expr {
    const parts = [this.additive()];
    for (;;) {
      const t = this.peek();
      const startsOperand =
        t.t === 'num' || t.t === 'str' || t.t === 'name' || t.t === 'func' || t.t === 're' ||
        (t.t === 'op' && (t.v === '$' || t.v === '(' || t.v === '!' || t.v === '++' || t.v === '--' || t.v === '-'));
      if (!startsOperand) break;
      // "a - b" es resta, no concatenación de -b: additive ya lo consumió.
      if (t.t === 'op' && t.v === '-') break;
      parts.push(this.additive());
    }
    return parts.length === 1 ? parts[0] : { k: 'concat', parts };
  }

  private additive(): Expr {
    let left = this.multiplicative();
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.peek() as { v: string }).v;
      this.pos++;
      left = { k: 'bin', op, left, right: this.multiplicative() };
    }
    return left;
  }

  private multiplicative(): Expr {
    let left = this.unary();
    while (this.isOp('*') || this.isOp('/') || this.isOp('%')) {
      const op = (this.peek() as { v: string }).v;
      this.pos++;
      left = { k: 'bin', op, left, right: this.unary() };
    }
    return left;
  }

  private unary(): Expr {
    if (this.isOp('!')) {
      this.pos++;
      return { k: 'un', op: '!', arg: this.unary() };
    }
    if (this.isOp('-') || this.isOp('+')) {
      const op = (this.peek() as { v: string }).v;
      this.pos++;
      return { k: 'un', op, arg: this.unary() };
    }
    return this.power();
  }

  private power(): Expr {
    const base = this.postfix();
    if (this.isOp('^')) {
      this.pos++;
      return { k: 'bin', op: '^', left: base, right: this.unary() };
    }
    return base;
  }

  private postfix(): Expr {
    if (this.isOp('++') || this.isOp('--')) {
      const op = (this.peek() as { v: string }).v as '++' | '--';
      this.pos++;
      return { k: 'incdec', op, prefix: true, target: this.primary() };
    }
    const e = this.primary();
    if ((this.isOp('++') || this.isOp('--')) && (e.k === 'var' || e.k === 'field' || e.k === 'index')) {
      const op = (this.peek() as { v: string }).v as '++' | '--';
      this.pos++;
      return { k: 'incdec', op, prefix: false, target: e };
    }
    return e;
  }

  private primary(): Expr {
    const t = this.peek();
    this.pos++;
    switch (t.t) {
      case 'num': return { k: 'num', v: t.v };
      case 'str': return { k: 'str', v: t.v };
      case 're': return { k: 're', v: t.v };
      case 'func': {
        if (!this.isOp('(')) return { k: 'call', name: t.v, args: [] };
        this.pos++;
        const saveIn = this.noIn;
        const saveGreater = this.noGreater;
        this.noIn = false;
        this.noGreater = false;
        const args = this.exprList(')');
        this.noIn = saveIn;
        this.noGreater = saveGreater;
        return { k: 'call', name: t.v, args };
      }
      case 'name': {
        if (this.isOp('[')) {
          this.pos++;
          return { k: 'index', name: t.v, keys: this.exprList(']') };
        }
        if (this.isOp('(') && this.toks[this.pos - 1] && this.peek().t === 'op') {
          // Llamada a función definida por el usuario (sin espacio antes de "(").
          this.pos++;
          return { k: 'call', name: t.v, args: this.exprList(')') };
        }
        return { k: 'var', name: t.v };
      }
      case 'op':
        if (t.v === '$') return { k: 'field', index: this.postfixNoIncdec() };
        if (t.v === '(') {
          const saveGreater = this.noGreater;
          this.noGreater = false;
          const e = this.expr();
          if (this.isOp(',')) {
            // (a, b) in arr
            const keys = [e];
            while (this.isOp(',')) {
              this.pos++;
              keys.push(this.expr());
            }
            this.expectOp(')');
            this.noGreater = saveGreater;
            if (!this.isKw('in')) throw new AwkError('syntax error');
            this.pos++;
            const name = this.peek();
            this.pos++;
            return { k: 'in', key: keys, name: (name as { v: string }).v };
          }
          this.expectOp(')');
          this.noGreater = saveGreater;
          return { k: 'group', e };
        }
        break;
      default:
        break;
    }
    throw new AwkError(`syntax error at source line 1 near '${'v' in t ? String(t.v) : t.t}'`);
  }

  /** Para $: $NF, $(NF-1), $i++ → ($i)++ */
  private postfixNoIncdec(): Expr {
    if (this.isOp('(')) {
      this.pos++;
      const e = this.expr();
      this.expectOp(')');
      return e;
    }
    if (this.isOp('-')) {
      this.pos++;
      return { k: 'un', op: '-', arg: this.primary() };
    }
    return this.primary();
  }
}

// ─────────────────────────────── Ejecución ───────────────────────────────

class NextSignal {}
class ExitSignal {
  readonly code: number;
  constructor(code: number) {
    this.code = code;
  }
}
class BreakSignal {}
class ContinueSignal {}
class ReturnSignal {
  readonly value: Value;
  constructor(value: Value) {
    this.value = value;
  }
}

type Value = string | number;

function toNum(v: Value): number {
  if (typeof v === 'number') return v;
  const m = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(v);
  return m ? Number(m[0]) : 0;
}

function toStr(v: Value): string {
  if (typeof v === 'string') return v;
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toPrecision(6)));
}

/** ¿Parece un número? (para comparar como números o como texto, igual que awk). */
function looksNumeric(v: Value): boolean {
  return typeof v === 'number' || /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(v);
}

/** Formatea al estilo printf de C: %s %d %i %f %.2f %5s %-10s %x %o %c %e %%. */
export function formatPrintf(format: string, args: Value[]): string {
  let i = 0;
  return format.replace(/%([-+ 0#]*)(\*|\d+)?(?:\.(\*|\d+))?([sdifxXocegG%])/g, (_m, flags: string, width: string | undefined, precision: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const w = width === '*' ? toNum(args[i++] ?? 0) : width ? Number(width) : 0;
    const p = precision === '*' ? toNum(args[i++] ?? 0) : precision !== undefined ? Number(precision) : undefined;
    const arg = args[i++] ?? (conv === 's' || conv === 'c' ? '' : 0);
    let text: string;
    switch (conv) {
      case 's': text = toStr(arg); if (p !== undefined) text = text.slice(0, p); break;
      case 'd': case 'i': text = String(Math.trunc(toNum(arg))); break;
      case 'f': text = toNum(arg).toFixed(p ?? 6); break;
      case 'e': text = toNum(arg).toExponential(p ?? 6); break;
      case 'g': case 'G': text = String(Number(toNum(arg).toPrecision(p || 6))); break;
      case 'x': text = Math.trunc(toNum(arg)).toString(16); break;
      case 'X': text = Math.trunc(toNum(arg)).toString(16).toUpperCase(); break;
      case 'o': text = Math.trunc(toNum(arg)).toString(8); break;
      case 'c': text = typeof arg === 'number' ? String.fromCharCode(arg) : toStr(arg).charAt(0); break;
      default: text = toStr(arg);
    }
    if (flags.includes('+') && /^[dif]$/.test(conv) && toNum(arg) >= 0) text = '+' + text;
    if (text.length < w) {
      if (flags.includes('-')) text = text.padEnd(w);
      else if (flags.includes('0') && conv !== 's') {
        const negative = text.startsWith('-');
        text = (negative ? '-' : '') + text.replace('-', '').padStart(w - (negative ? 1 : 0), '0');
      } else text = text.padStart(w);
    }
    return text;
  }).replace(/\\n/g, '\n').replace(/\\t/g, '\t');
}

interface AwkIO {
  write(text: string): void;
  /** Escribe en un archivo (print > "f"). */
  writeFile(path: string, text: string, append: boolean): void;
}

const MAX_STEPS = 200_000;

export class AwkProgram {
  private readonly rules: Rule[];
  private readonly functions: Map<string, FunctionDef>;
  private readonly globals = new Map<string, Value>();
  private readonly arrays = new Map<string, Map<string, Value>>();
  private fields: string[] = [''];
  private fieldsDirty = false;
  private record = '';
  private steps = 0;
  private readonly openedFiles = new Set<string>();
  private locals: { scalars: Map<string, Value>; arrays: Map<string, Map<string, Value>> }[] = [];

  constructor(source: string) {
    const { rules, functions } = new Parser(lex(source)).program();
    this.rules = rules;
    this.functions = functions;
    this.globals.set('FS', ' ');
    this.globals.set('OFS', ' ');
    this.globals.set('ORS', '\n');
    this.globals.set('RS', '\n');
    this.globals.set('NR', 0);
    this.globals.set('NF', 0);
    this.globals.set('FNR', 0);
    this.globals.set('SUBSEP', '\x1c');
  }

  setVar(name: string, value: string): void {
    this.globals.set(name, value.replace(/\\t/g, '\t').replace(/\\n/g, '\n'));
  }

  /** Ejecuta el programa. @returns código de salida. */
  run(inputs: { name: string; content: string }[], io: AwkIO): number {
    try {
      for (const rule of this.rules) if (rule.kind === 'begin') this.execBlock(rule.action!, io);
      const hasMain = this.rules.some((r) => r.kind === 'main' || r.kind === 'end');
      if (hasMain) {
        outer: for (const input of inputs) {
          this.globals.set('FILENAME', input.name === '-' ? '' : input.name);
          this.globals.set('FNR', 0);
          for (const line of this.splitRecords(input.content)) {
            this.globals.set('NR', toNum(this.globals.get('NR')!) + 1);
            this.globals.set('FNR', toNum(this.globals.get('FNR')!) + 1);
            this.setRecord(line);
            try {
              for (const rule of this.rules) {
                if (rule.kind !== 'main') continue;
                if (!this.ruleMatches(rule)) continue;
                if (rule.action) this.execBlock(rule.action, io);
                else io.write(this.record + toStr(this.globals.get('ORS')!));
              }
            } catch (signal) {
              if (signal instanceof NextSignal) continue;
              if (signal instanceof ExitSignal) {
                this.runEnd(io);
                return signal.code;
              }
              throw signal;
            }
            if (this.steps > MAX_STEPS) break outer;
          }
        }
      }
      this.runEnd(io);
      return 0;
    } catch (signal) {
      if (signal instanceof ExitSignal) return signal.code;
      throw signal;
    }
  }

  private runEnd(io: AwkIO): void {
    try {
      for (const rule of this.rules) if (rule.kind === 'end') this.execBlock(rule.action!, io);
    } catch (signal) {
      if (!(signal instanceof ExitSignal)) throw signal;
    }
  }

  private splitRecords(content: string): string[] {
    const rs = toStr(this.globals.get('RS')!);
    if (rs === '\n') return splitLines(content);
    if (rs === '') return content.split(/\n\n+/).filter((r) => r.trim() !== '');
    const records = content.split(rs);
    if (records.at(-1)?.replace(/\n$/, '') === '') records.pop();
    return records;
  }

  private ruleMatches(rule: Rule): boolean {
    if (!rule.pattern) return true;
    if (rule.pattern2) {
      if (rule.inRange) {
        if (this.truthy(this.evalPattern(rule.pattern2))) rule.inRange = false;
        return true;
      }
      if (this.truthy(this.evalPattern(rule.pattern))) {
        rule.inRange = !this.truthy(this.evalPattern(rule.pattern2));
        return true;
      }
      return false;
    }
    return this.truthy(this.evalPattern(rule.pattern));
  }

  /** Un patrón /re/ solo se compara con $0. */
  private evalPattern(e: Expr): Value {
    if (e.k === 're') return this.regex(e.v).test(this.record) ? 1 : 0;
    return this.eval(e);
  }

  // ─── Registro y campos ───

  private setRecord(line: string): void {
    this.record = line;
    this.fields = [line, ...this.splitFields(line)];
    this.fieldsDirty = false;
    this.globals.set('NF', this.fields.length - 1);
  }

  private splitFields(line: string): string[] {
    const fs = toStr(this.globals.get('FS')!);
    if (fs === ' ') return line.trim() === '' ? [] : line.trim().split(/[ \t\n]+/);
    if (line === '') return [];
    if (fs.length === 1 && fs !== '\\') return line.split(fs);
    return line.split(new RegExp(posixToJs(fs, true)));
  }

  private getField(i: number): string {
    if (i === 0) {
      if (this.fieldsDirty) this.rebuildRecord();
      return this.record;
    }
    return this.fields[i] ?? '';
  }

  private setField(i: number, value: string): void {
    if (i === 0) {
      this.setRecord(value);
      return;
    }
    while (this.fields.length <= i) this.fields.push('');
    this.fields[i] = value;
    this.globals.set('NF', Math.max(toNum(this.globals.get('NF')!), i));
    this.fieldsDirty = true;
    this.rebuildRecord();
  }

  private rebuildRecord(): void {
    const nf = toNum(this.globals.get('NF')!);
    this.fields.length = nf + 1;
    this.record = this.fields.slice(1).map((f) => f ?? '').join(toStr(this.globals.get('OFS')!));
    this.fields[0] = this.record;
    this.fieldsDirty = false;
  }

  // ─── Variables ───

  private scope(name: string): Map<string, Value> | null {
    const frame = this.locals.at(-1);
    if (frame?.scalars.has(name)) return frame.scalars;
    return null;
  }

  private getVar(name: string): Value {
    const local = this.scope(name);
    if (local) return local.get(name)!;
    if (name === 'NF' && this.fieldsDirty) this.rebuildRecord();
    return this.globals.get(name) ?? '';
  }

  private setVarValue(name: string, value: Value): void {
    const local = this.scope(name);
    if (local) {
      local.set(name, value);
      return;
    }
    this.globals.set(name, value);
    if (name === 'NF') {
      const nf = toNum(value);
      while (this.fields.length <= nf) this.fields.push('');
      this.fields.length = nf + 1;
      this.rebuildRecord();
    }
  }

  private array(name: string): Map<string, Value> {
    const frame = this.locals.at(-1);
    if (frame?.arrays.has(name)) return frame.arrays.get(name)!;
    let arr = this.arrays.get(name);
    if (!arr) {
      arr = new Map();
      this.arrays.set(name, arr);
    }
    return arr;
  }

  private key(keys: Expr[]): string {
    return keys.map((k) => toStr(this.eval(k))).join(toStr(this.globals.get('SUBSEP')!));
  }

  private assignTo(target: Expr, value: Value): void {
    if (target.k === 'var') this.setVarValue(target.name, value);
    else if (target.k === 'field') this.setField(Math.trunc(toNum(this.eval(target.index))), toStr(value));
    else if (target.k === 'index') this.array(target.name).set(this.key(target.keys), value);
  }

  private readTarget(target: Expr): Value {
    if (target.k === 'var') return this.getVar(target.name);
    if (target.k === 'field') return this.getField(Math.trunc(toNum(this.eval(target.index))));
    if (target.k === 'index') {
      const arr = this.array(target.name);
      const key = this.key(target.keys);
      if (!arr.has(key)) arr.set(key, '');
      return arr.get(key)!;
    }
    return '';
  }

  // ─── Expresiones ───

  private readonly regexCache = new Map<string, RegExp>();

  private regex(source: string): RegExp {
    let re = this.regexCache.get(source);
    if (!re) {
      re = compileRegex(source, { extended: true });
      this.regexCache.set(source, re);
    }
    return re;
  }

  private toRegex(e: Expr): RegExp {
    if (e.k === 're') return this.regex(e.v);
    return this.regex(toStr(this.eval(e)));
  }

  private truthy(v: Value): boolean {
    if (typeof v === 'number') return v !== 0;
    // Texto con aspecto de número (p. ej. un campo "0") se evalúa como número.
    if (looksNumeric(v)) return toNum(v) !== 0;
    return v !== '';
  }

  private eval(e: Expr): Value {
    if (++this.steps > MAX_STEPS * 10) throw new AwkError('demasiados pasos (¿bucle infinito?)');
    switch (e.k) {
      case 'num': return e.v;
      case 'str': return e.v;
      case 're': return this.regex(e.v).test(this.record) ? 1 : 0;
      case 'group': return this.eval(e.e);
      case 'var': return this.getVar(e.name);
      case 'field': return this.getField(Math.trunc(toNum(this.eval(e.index))));
      case 'index': return this.readTarget(e);
      case 'in': return this.array(e.name).has(this.key(e.key)) ? 1 : 0;
      case 'concat': return e.parts.map((p) => toStr(this.eval(p))).join('');
      case 'cond': return this.truthy(this.eval(e.test)) ? this.eval(e.yes) : this.eval(e.no);
      case 'match': {
        const matched = this.toRegex(e.right).test(toStr(this.eval(e.left)));
        return matched !== e.negate ? 1 : 0;
      }
      case 'un': {
        if (e.op === '!') return this.truthy(this.eval(e.arg)) ? 0 : 1;
        const n = toNum(this.eval(e.arg));
        return e.op === '-' ? -n : n;
      }
      case 'incdec': {
        const old = toNum(this.readTarget(e.target));
        const next = e.op === '++' ? old + 1 : old - 1;
        this.assignTo(e.target, next);
        return e.prefix ? next : old;
      }
      case 'assign': {
        let value = this.eval(e.value);
        if (e.op !== '=') {
          const current = toNum(this.readTarget(e.target));
          const r = toNum(value);
          switch (e.op) {
            case '+=': value = current + r; break;
            case '-=': value = current - r; break;
            case '*=': value = current * r; break;
            case '/=': value = current / r; break;
            case '%=': value = current % r; break;
            case '^=': value = current ** r; break;
          }
        }
        this.assignTo(e.target, value);
        return value;
      }
      case 'bin': {
        if (e.op === '&&') return this.truthy(this.eval(e.left)) && this.truthy(this.eval(e.right)) ? 1 : 0;
        if (e.op === '||') return this.truthy(this.eval(e.left)) || this.truthy(this.eval(e.right)) ? 1 : 0;
        const l = this.eval(e.left);
        const r = this.eval(e.right);
        switch (e.op) {
          case '+': return toNum(l) + toNum(r);
          case '-': return toNum(l) - toNum(r);
          case '*': return toNum(l) * toNum(r);
          case '/': {
            if (toNum(r) === 0) throw new AwkError('division by zero');
            return toNum(l) / toNum(r);
          }
          case '%': return toNum(l) % toNum(r);
          case '^': return toNum(l) ** toNum(r);
          default: {
            const numeric = looksNumeric(l) && looksNumeric(r);
            const cmp = numeric ? toNum(l) - toNum(r) : toStr(l) < toStr(r) ? -1 : toStr(l) > toStr(r) ? 1 : 0;
            const results: Record<string, boolean> = { '<': cmp < 0, '<=': cmp <= 0, '>': cmp > 0, '>=': cmp >= 0, '==': cmp === 0, '!=': cmp !== 0 };
            return results[e.op] ? 1 : 0;
          }
        }
      }
      case 'call': return this.call(e.name, e.args);
    }
  }

  private call(name: string, args: Expr[]): Value {
    const s = (i: number): string => (args[i] ? toStr(this.eval(args[i])) : '');
    const n = (i: number): number => (args[i] ? toNum(this.eval(args[i])) : 0);
    switch (name) {
      case 'length': {
        if (args.length === 0) return this.getField(0).length;
        const a = args[0];
        if (a.k === 'var' && (this.arrays.has(a.name) || this.locals.at(-1)?.arrays.has(a.name))) return this.array(a.name).size;
        return s(0).length;
      }
      case 'substr': {
        const str = s(0);
        const start = Math.round(n(1));
        const len = args.length > 2 ? Math.round(n(2)) : Infinity;
        const from = Math.max(start, 1);
        const to = start + len;
        return str.slice(from - 1, Math.max(from - 1, to - 1));
      }
      case 'index': return s(0).indexOf(s(1)) + 1;
      case 'split': {
        const str = s(0);
        const target = args[1];
        if (target?.k !== 'var') throw new AwkError('split: second argument must be an array');
        const arr = this.array(target.name);
        arr.clear();
        const sep = args[2] ? (args[2].k === 're' ? this.regex(args[2].v) : toStr(this.eval(args[2]))) : toStr(this.globals.get('FS')!);
        let parts: string[];
        if (sep === ' ') parts = str.trim() === '' ? [] : str.trim().split(/\s+/);
        else if (typeof sep === 'string') parts = str === '' ? [] : sep.length === 1 ? str.split(sep) : str.split(new RegExp(posixToJs(sep, true)));
        else parts = str === '' ? [] : str.split(sep);
        parts.forEach((p, i) => arr.set(String(i + 1), p));
        return parts.length;
      }
      case 'sub': case 'gsub': {
        const re = this.toRegex(args[0]);
        const replacement = s(1);
        const target = args[2] ?? { k: 'field', index: { k: 'num', v: 0 } } as Expr;
        const original = toStr(this.readTarget(target));
        let count = 0;
        const global = new RegExp(re.source, re.flags.replace('g', '') + (name === 'gsub' ? 'g' : ''));
        const result = original.replace(global, (m) => {
          count++;
          return replacement.replace(/\\\\&|\\&|&/g, (x) => (x === '&' ? m : x === '\\&' ? '&' : '\\'));
        });
        if (count > 0) this.assignTo(target, result);
        return count;
      }
      case 'match': {
        const m = this.toRegex(args[1]).exec(s(0));
        this.globals.set('RSTART', m ? m.index + 1 : 0);
        this.globals.set('RLENGTH', m ? m[0].length : -1);
        return m ? m.index + 1 : 0;
      }
      case 'sprintf': return formatPrintf(s(0), args.slice(1).map((a) => this.eval(a)));
      case 'tolower': return s(0).toLowerCase();
      case 'toupper': return s(0).toUpperCase();
      case 'int': return Math.trunc(n(0));
      case 'sqrt': return Math.sqrt(n(0));
      case 'exp': return Math.exp(n(0));
      case 'log': return Math.log(n(0));
      case 'sin': return Math.sin(n(0));
      case 'cos': return Math.cos(n(0));
      case 'atan2': return Math.atan2(n(0), n(1));
      case 'rand': return Math.random();
      case 'srand': return 0;
      case 'system': case 'close': return 0;
      default: return this.callUser(name, args);
    }
  }

  private callUser(name: string, args: Expr[]): Value {
    const fn = this.functions.get(name);
    if (!fn) throw new AwkError(`calling undefined function ${name}`);
    if (this.locals.length > 200) throw new AwkError('function call nesting is too deep');
    const frame = { scalars: new Map<string, Value>(), arrays: new Map<string, Map<string, Value>>() };
    fn.params.forEach((param, i) => {
      const arg = args[i];
      // Los arrays se pasan por referencia.
      if (arg?.k === 'var' && (this.arrays.has(arg.name) || this.locals.at(-1)?.arrays.has(arg.name))) frame.arrays.set(param, this.array(arg.name));
      else frame.scalars.set(param, arg ? this.eval(arg) : '');
    });
    this.locals.push(frame);
    try {
      this.execBlock(fn.body, this.currentIO!);
      return '';
    } catch (signal) {
      if (signal instanceof ReturnSignal) return signal.value;
      throw signal;
    } finally {
      this.locals.pop();
    }
  }

  // ─── Sentencias ───

  private currentIO: AwkIO | null = null;

  private execBlock(body: Stmt[], io: AwkIO): void {
    this.currentIO = io;
    for (const stmt of body) this.exec(stmt, io);
  }

  private exec(stmt: Stmt, io: AwkIO): void {
    if (++this.steps > MAX_STEPS * 10) throw new AwkError('demasiados pasos (¿bucle infinito?)');
    switch (stmt.k) {
      case 'expr': this.eval(stmt.e); return;
      case 'block': this.execBlock(stmt.body, io); return;
      case 'print': {
        let text: string;
        if (stmt.printf) {
          const values = stmt.args.map((a) => this.eval(a));
          text = formatPrintf(toStr(values[0] ?? ''), values.slice(1));
        } else {
          const values = stmt.args.length ? stmt.args.map((a) => this.eval(a)) : [this.getField(0)];
          text = values.map(toStr).join(toStr(this.getVar('OFS'))) + toStr(this.getVar('ORS'));
        }
        if (stmt.redirect && stmt.redirect.op !== '|') {
          const path = toStr(this.eval(stmt.redirect.target));
          const append = stmt.redirect.op === '>>' || this.openedFiles.has(path);
          this.openedFiles.add(path);
          io.writeFile(path, text, append);
        } else io.write(text);
        return;
      }
      case 'if':
        if (this.truthy(this.eval(stmt.test))) this.exec(stmt.yes, io);
        else if (stmt.no) this.exec(stmt.no, io);
        return;
      case 'while':
        while (this.truthy(this.eval(stmt.test))) {
          if (this.loopBody(stmt.body, io)) break;
        }
        return;
      case 'do':
        do {
          if (this.loopBody(stmt.body, io)) break;
        } while (this.truthy(this.eval(stmt.test)));
        return;
      case 'for':
        if (stmt.init) this.exec(stmt.init, io);
        while (!stmt.test || this.truthy(this.eval(stmt.test))) {
          if (this.loopBody(stmt.body, io)) break;
          if (stmt.step) this.exec(stmt.step, io);
        }
        return;
      case 'forin': {
        const keys = [...this.array(stmt.array).keys()];
        for (const key of keys) {
          this.setVarValue(stmt.variable, key);
          if (this.loopBody(stmt.body, io)) break;
        }
        return;
      }
      case 'next': throw new NextSignal();
      case 'exit': throw new ExitSignal(stmt.code ? Math.trunc(toNum(this.eval(stmt.code))) : 0);
      case 'break': throw new BreakSignal();
      case 'continue': throw new ContinueSignal();
      case 'return': throw new ReturnSignal(stmt.value ? this.eval(stmt.value) : '');
      case 'delete':
        if (stmt.keys) this.array(stmt.name).delete(this.key(stmt.keys));
        else this.array(stmt.name).clear();
        return;
    }
  }

  /** @returns true si hay que salir del bucle (break). */
  private loopBody(body: Stmt, io: AwkIO): boolean {
    try {
      this.exec(body, io);
    } catch (signal) {
      if (signal instanceof BreakSignal) return true;
      if (signal instanceof ContinueSignal) return false;
      throw signal;
    }
    return false;
  }
}

export const awkCommand: Command = {
  name: 'awk',
  category: 'texto',
  summary: 'Procesa texto por columnas con un pequeño lenguaje',
  execute(ctx) {
    let source: string | null = null;
    let fieldSeparator: string | null = null;
    const assignments: [string, string][] = [];
    const files: string[] = [];
    for (let i = 0; i < ctx.args.length; i++) {
      const arg = ctx.args[i];
      if (arg === '-F') fieldSeparator = ctx.args[++i] ?? ' ';
      else if (arg.startsWith('-F')) fieldSeparator = arg.slice(2);
      else if (arg === '-v') {
        const [name, ...rest] = (ctx.args[++i] ?? '').split('=');
        assignments.push([name, rest.join('=')]);
      } else if (arg === '-f') {
        const path = ctx.args[++i] ?? '';
        try {
          source = ctx.fs.readFile(ctx.resolve(path));
        } catch {
          ctx.stderr.write(`awk: can't open file ${path}\n`);
          return 2;
        }
      } else if (source === null) source = arg;
      else if (/^[A-Za-z_]\w*=/.test(arg)) {
        const [name, ...rest] = arg.split('=');
        assignments.push([name, rest.join('=')]);
      } else files.push(arg);
    }
    if (source === null) {
      ctx.stderr.write("usage: awk [-F fs][-v var=value][prog | -f progfile][file ...]\n");
      return EXIT_USAGE;
    }

    let program: AwkProgram;
    try {
      program = new AwkProgram(source);
    } catch (error) {
      if (!(error instanceof AwkError)) throw error;
      ctx.stderr.write(`awk: ${error.message}\n awk: ${source.split('\n')[0]}\n`);
      return 2;
    }
    if (fieldSeparator !== null) program.setVar('FS', fieldSeparator === 't' ? '\t' : fieldSeparator);
    for (const [name, value] of assignments) program.setVar(name, value);

    const inputs = readInputs(ctx, files);
    if (inputs.some((i) => i.content === null)) return 2;
    try {
      return program.run(inputs as { name: string; content: string }[], {
        write: (text) => ctx.stdout.write(text),
        writeFile: (path, text, append) => ctx.fs.writeFile(ctx.resolve(path), text, append),
      });
    } catch (error) {
      if (!(error instanceof AwkError)) throw error;
      ctx.stderr.write(`awk: ${error.message}\n`);
      return 2;
    }
  },
};
