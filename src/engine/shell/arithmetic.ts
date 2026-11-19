/**
 * Aritmética entera del shell: $(( expresión )).
 *
 * Soporta: + - * / % ** , comparaciones (< <= > >= == !=), lógicos (&& || !),
 * paréntesis, números y variables por nombre (con o sin $). Como en bash,
 * una variable vacía o no numérica vale 0.
 */
export class ArithmeticError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArithmeticError';
  }
}

type Lookup = (name: string) => string | undefined;

const TOKEN = /\s*(\d+|[A-Za-z_][A-Za-z0-9_]*|\*\*|<=|>=|==|!=|&&|\|\||[-+*/%()<>!])/y;

export function evaluateArithmetic(expression: string, lookup: Lookup): number {
  const source = expression.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, '$1').trim();
  if (source === '') return 0;
  const tokens: string[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < source.length) {
    const start = TOKEN.lastIndex;
    const match = TOKEN.exec(source);
    if (!match) {
      if (/^\s*$/.test(source.slice(start))) break;
      throw new ArithmeticError(`${source}: syntax error: invalid arithmetic operator (error token is "${source.slice(start).trim()}")`);
    }
    tokens.push(match[1]);
  }

  let pos = 0;
  const peek = (): string | undefined => tokens[pos];
  const take = (): string | undefined => tokens[pos++];

  const value = (name: string): number => {
    const raw = lookup(name)?.trim() ?? '';
    const n = Number.parseInt(raw, 10);
    return Number.isNaN(n) ? 0 : n;
  };

  const primary = (): number => {
    const token = take();
    if (token === undefined) throw new ArithmeticError(`${source}: syntax error: operand expected`);
    if (token === '(') {
      const v = or();
      if (take() !== ')') throw new ArithmeticError(`${source}: syntax error: missing ')'`);
      return v;
    }
    if (token === '-') return -unary();
    if (token === '+') return unary();
    if (token === '!') return unary() === 0 ? 1 : 0;
    if (/^\d+$/.test(token)) return Number(token);
    if (/^[A-Za-z_]/.test(token)) return value(token);
    throw new ArithmeticError(`${source}: syntax error: operand expected (error token is "${token}")`);
  };
  const unary = (): number => primary();
  const power = (): number => {
    const base = unary();
    if (peek() === '**') {
      take();
      return base ** power();
    }
    return base;
  };
  const product = (): number => {
    let v = power();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = take();
      const r = power();
      if ((op === '/' || op === '%') && r === 0) throw new ArithmeticError('division by 0 (error token is "0")');
      v = op === '*' ? v * r : op === '/' ? Math.trunc(v / r) : v % r;
    }
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (peek() === '+' || peek() === '-') v = take() === '+' ? v + product() : v - product();
    return v;
  };
  const compare = (): number => {
    let v = sum();
    for (;;) {
      const op = peek();
      if (op !== '<' && op !== '<=' && op !== '>' && op !== '>=') return v;
      take();
      const r = sum();
      v = Number(op === '<' ? v < r : op === '<=' ? v <= r : op === '>' ? v > r : v >= r);
    }
  };
  const equality = (): number => {
    let v = compare();
    while (peek() === '==' || peek() === '!=') {
      const op = take();
      const r = compare();
      v = Number(op === '==' ? v === r : v !== r);
    }
    return v;
  };
  const and = (): number => {
    let v = equality();
    while (peek() === '&&') {
      take();
      const r = equality();
      v = Number(v !== 0 && r !== 0);
    }
    return v;
  };
  const or = (): number => {
    let v = and();
    while (peek() === '||') {
      take();
      const r = and();
      v = Number(v !== 0 || r !== 0);
    }
    return v;
  };

  const result = or();
  if (pos < tokens.length) throw new ArithmeticError(`${source}: syntax error in expression (error token is "${tokens[pos]}")`);
  return result;
}
