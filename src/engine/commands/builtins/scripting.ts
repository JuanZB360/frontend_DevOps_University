/**
 * Builtins de bash para variables, scripts y control de flujo:
 *   true false test [ export unset alias unalias source . bash sh read
 *   break continue return shift local eval type set
 */
import { parse } from '../../shell/parser';
import { ShellSyntaxError } from '../../shell/tokenizer';
import { resolvePath } from '../../vfs/path';
import type { Command, CommandContext } from '../Command';
import { EXIT_USAGE, fail } from '../helpers';

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const trueCommand: Command = {
  name: 'true', category: 'sistema', summary: 'No hace nada y termina con éxito (código 0)', builtin: true,
  execute: () => 0,
};

export const falseCommand: Command = {
  name: 'false', category: 'sistema', summary: 'No hace nada y termina con error (código 1)', builtin: true,
  execute: () => 1,
};

// ─────────────────────────────── test / [ ───────────────────────────────

/** Evalúa una expresión de `test`. Devuelve 0 (verdadero), 1 (falso) o 2 (error). */
function evaluateTest(ctx: CommandContext, args: string[]): number {
  const truth = (value: boolean): number => (value ? 0 : 1);
  const fileTest = (op: string, path: string): boolean => {
    const abs = ctx.resolve(path);
    const node = ctx.fs.tryStat(abs);
    switch (op) {
      case '-e': return node !== null;
      case '-f': return node?.type === 'file';
      case '-d': return node?.type === 'dir';
      case '-L': case '-h': return ctx.fs.tryStat(abs, false)?.type === 'symlink';
      case '-s': return node?.type === 'file' && node.content.length > 0;
      case '-r': return ctx.fs.canAccess(abs, 'r');
      case '-w': return ctx.fs.canAccess(abs, 'w');
      case '-x': return ctx.fs.canAccess(abs, 'x');
      default: return false;
    }
  };
  const integer = (text: string): number | null => (/^-?\d+$/.test(text.trim()) ? Number(text) : null);

  const single = (a: string[]): number => {
    if (a.length === 0) return 1;
    if (a[0] === '!') return single(a.slice(1)) === 0 ? 1 : 0;
    if (a.length === 1) return truth(a[0] !== '');
    if (a.length === 2) {
      const [op, value] = a;
      if (op === '-z') return truth(value === '');
      if (op === '-n') return truth(value !== '');
      if (/^-[efdLhsrwx]$/.test(op)) return truth(fileTest(op, value));
      ctx.stderr.write(`${ctx.name}: ${op}: unary operator expected\n`);
      return 2;
    }
    if (a.length === 3) {
      const [left, op, right] = a;
      switch (op) {
        case '=': case '==': return truth(left === right);
        case '!=': return truth(left !== right);
        case '<': return truth(left < right);
        case '>': return truth(left > right);
        case '-eq': case '-ne': case '-lt': case '-le': case '-gt': case '-ge': {
          const l = integer(left);
          const r = integer(right);
          if (l === null || r === null) {
            ctx.stderr.write(`${ctx.name}: ${l === null ? left : right}: integer expression expected\n`);
            return 2;
          }
          const results: Record<string, boolean> = { '-eq': l === r, '-ne': l !== r, '-lt': l < r, '-le': l <= r, '-gt': l > r, '-ge': l >= r };
          return truth(results[op]);
        }
        default:
          ctx.stderr.write(`${ctx.name}: ${op}: binary operator expected\n`);
          return 2;
      }
    }
    ctx.stderr.write(`${ctx.name}: too many arguments\n`);
    return 2;
  };

  // -a (y) y -o (o) unen expresiones simples.
  const orParts = splitOn(args, '-o');
  if (orParts.length > 1) return truth(orParts.some((p) => andAll(p) === 0));
  return andAll(args);

  function andAll(a: string[]): number {
    const parts = splitOn(a, '-a');
    let result = 0;
    for (const part of parts) {
      const r = single(part);
      if (r === 2) return 2;
      if (r !== 0) result = 1;
    }
    return result;
  }
}

function splitOn(args: string[], separator: string): string[][] {
  const parts: string[][] = [[]];
  // Un "-a" como operando de -e/-f no es separador: solo si hay algo a ambos lados.
  args.forEach((arg, i) => {
    if (arg === separator && i > 0 && i < args.length - 1) parts.push([]);
    else parts.at(-1)!.push(arg);
  });
  return parts;
}

export const testCommand: Command = {
  name: 'test',
  category: 'sistema',
  summary: 'Evalúa una condición (archivos, textos, números)',
  builtin: true,
  execute: (ctx) => evaluateTest(ctx, [...ctx.args]),
};

export const bracketCommand: Command = {
  name: '[',
  category: 'sistema',
  summary: 'Igual que test, cerrado con ]',
  builtin: true,
  execute(ctx) {
    if (ctx.args.at(-1) !== ']') {
      ctx.stderr.write("[: missing `]'\n");
      return EXIT_USAGE;
    }
    return evaluateTest(ctx, ctx.args.slice(0, -1));
  },
};

// ─────────────────────────────── Variables ───────────────────────────────

/** Separa "NOMBRE=valor" (o solo "NOMBRE"). */
function splitAssignment(arg: string): [string, string | undefined] {
  const index = arg.indexOf('=');
  return index === -1 ? [arg, undefined] : [arg.slice(0, index), arg.slice(index + 1)];
}

export const exportCommand: Command = {
  name: 'export',
  category: 'sistema',
  summary: 'Exporta variables al entorno de los procesos hijos',
  builtin: true,
  execute(ctx) {
    const args = ctx.args.filter((a) => a !== '-p');
    if (args.length === 0) {
      for (const [name, value] of ctx.session.environment()) ctx.stdout.write(`declare -x ${name}="${value}"\n`);
      return 0;
    }
    let exitCode = 0;
    for (const arg of args) {
      const [name, value] = splitAssignment(arg);
      if (!NAME.test(name)) {
        ctx.stderr.write(`bash: export: \`${arg}': not a valid identifier\n`);
        exitCode = 1;
        continue;
      }
      if (value !== undefined) ctx.session.setVar(name, value);
      ctx.session.exportVar(name);
    }
    return exitCode;
  },
};

export const unsetCommand: Command = {
  name: 'unset',
  category: 'sistema',
  summary: 'Elimina variables',
  builtin: true,
  execute(ctx) {
    for (const name of ctx.args.filter((a) => !a.startsWith('-'))) ctx.session.unsetVar(name);
    return 0;
  },
};

export const localCommand: Command = {
  name: 'local',
  category: 'sistema',
  summary: 'Declara variables locales dentro de una función',
  builtin: true,
  execute(ctx) {
    if (!ctx.shell.inFunction()) return fail(ctx, 'can only be used in a function');
    for (const arg of ctx.args) {
      const [name, value] = splitAssignment(arg);
      ctx.shell.declareLocal(name, value);
    }
    return 0;
  },
};

export const setCommand: Command = {
  name: 'set',
  category: 'sistema',
  summary: 'Muestra las variables del shell o cambia los argumentos posicionales',
  builtin: true,
  execute(ctx) {
    if (ctx.args.length === 0) {
      for (const [name, value] of ctx.session.allVars()) ctx.stdout.write(`${name}=${value}\n`);
      return 0;
    }
    // set -e, set -x... se aceptan sin efecto; "set -- a b" cambia $1 $2.
    const dashdash = ctx.args.indexOf('--');
    if (dashdash !== -1) ctx.shell.setPositional(ctx.args.slice(dashdash + 1));
    else if (!ctx.args[0].startsWith('-') && !ctx.args[0].startsWith('+')) ctx.shell.setPositional(ctx.args);
    return 0;
  },
};

export const aliasCommand: Command = {
  name: 'alias',
  category: 'sistema',
  summary: 'Crea atajos para comandos',
  builtin: true,
  execute(ctx) {
    if (ctx.args.length === 0) {
      for (const [name, value] of ctx.session.allAliases()) ctx.stdout.write(`alias ${name}='${value}'\n`);
      return 0;
    }
    let exitCode = 0;
    for (const arg of ctx.args) {
      const [name, value] = splitAssignment(arg);
      if (value === undefined) {
        const existing = ctx.session.getAlias(name);
        if (existing === undefined) {
          ctx.stderr.write(`bash: alias: ${name}: not found\n`);
          exitCode = 1;
        } else {
          ctx.stdout.write(`alias ${name}='${existing}'\n`);
        }
        continue;
      }
      ctx.session.setAlias(name, value);
    }
    return exitCode;
  },
};

export const unaliasCommand: Command = {
  name: 'unalias',
  category: 'sistema',
  summary: 'Elimina un alias',
  builtin: true,
  execute(ctx) {
    if (ctx.args[0] === '-a') {
      for (const [name] of ctx.session.allAliases()) ctx.session.removeAlias(name);
      return 0;
    }
    let exitCode = 0;
    for (const name of ctx.args) {
      if (!ctx.session.removeAlias(name)) {
        ctx.stderr.write(`bash: unalias: ${name}: not found\n`);
        exitCode = 1;
      }
    }
    return exitCode;
  },
};

// ─────────────────────────────── Scripts ───────────────────────────────

/** Lee un script; imprime el error como bash si no se puede. */
function readScript(ctx: CommandContext, path: string, prefix: string): string | null {
  const abs = resolvePath(ctx.session.cwd, path);
  try {
    if (ctx.fs.isDirectory(abs)) {
      ctx.stderr.write(`${prefix}: ${path}: Is a directory\n`);
      return null;
    }
    return ctx.fs.readFile(abs);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'error';
    ctx.stderr.write(`${prefix}: ${path}: ${reason}\n`);
    return null;
  }
}

export const sourceCommand: Command = {
  name: 'source',
  aliases: ['.'],
  category: 'sistema',
  summary: 'Ejecuta un archivo en el shell actual (aplica sus variables y alias)',
  builtin: true,
  async execute(ctx) {
    const [path, ...args] = ctx.args;
    if (!path) {
      ctx.stderr.write(`bash: ${ctx.name}: filename argument required\n`);
      return EXIT_USAGE;
    }
    const text = readScript(ctx, path, `bash: ${ctx.name}`);
    if (text === null) return 1;
    return ctx.shell.runScript(text, { name: path, args: args.length ? args : undefined, newProcess: false });
  },
};

export const bashCommand: Command = {
  name: 'bash',
  aliases: ['sh'],
  category: 'sistema',
  summary: 'Ejecuta un script (o un comando con -c) en un proceso nuevo',
  async execute(ctx) {
    const args = ctx.args.filter((a) => a !== '-x' && a !== '-e' && a !== '-n');
    const syntaxOnly = ctx.args.includes('-n');
    if (args[0] === '-c') {
      if (args[1] === undefined) return fail(ctx, '-c: option requires an argument', EXIT_USAGE);
      return ctx.shell.runScript(args[1], { name: args[2] ?? ctx.name, args: args.slice(3), newProcess: true });
    }
    if (args.length === 0) {
      // Sin script: lee los comandos de la entrada estándar (echo "ls" | bash).
      if (ctx.stdin === null) {
        ctx.stderr.write('bash: ya estás en bash. Para ejecutar un script: bash script.sh\n');
        return 0;
      }
      return ctx.shell.runScript(ctx.stdin, { name: ctx.name, newProcess: true });
    }
    const [path, ...scriptArgs] = args;
    const text = readScript(ctx, path, ctx.name);
    if (text === null) return 127;
    if (syntaxOnly) {
      // bash -n: solo comprueba la sintaxis, sin ejecutar nada.
      try {
        parse(text);
        return 0;
      } catch (error) {
        if (!(error instanceof ShellSyntaxError)) throw error;
        ctx.stderr.write(`${path}: ${error.message}\n`);
        return 2;
      }
    }
    return ctx.shell.runScript(text, { name: path, args: scriptArgs, newProcess: true });
  },
};

export const colonCommand: Command = {
  name: ':', category: 'sistema', summary: 'No hace nada (siempre éxito)', builtin: true, execute: () => 0,
};

export const evalCommand: Command = {
  name: 'eval',
  category: 'sistema',
  summary: 'Ejecuta sus argumentos como un comando',
  builtin: true,
  execute: (ctx) => ctx.shell.runScript(ctx.args.join(' '), { newProcess: false }),
};

export const readCommand: Command = {
  name: 'read',
  category: 'sistema',
  summary: 'Lee una línea de la entrada y la guarda en variables',
  builtin: true,
  execute(ctx) {
    const names: string[] = [];
    let raw = false;
    for (let i = 0; i < ctx.args.length; i++) {
      const arg = ctx.args[i];
      if (arg === '-r') raw = true;
      else if (arg === '-p') ctx.stderr.write(ctx.args[++i] ?? '');
      else if (arg === '-s') continue;
      else names.push(arg);
    }
    if (ctx.input.isTerminal) {
      ctx.stderr.write('read: en el simulador, read lee de una tubería o archivo (ej. echo hola | read x, o while read l; do ...; done < archivo)\n');
      return 1;
    }
    const line = ctx.input.readLine();
    if (line === null) return 1;
    const text = raw ? line : line.replace(/\\(.)/g, '$1');
    const targets = names.length ? names : ['REPLY'];
    const words = text.trim() === '' ? [] : text.trim().split(/[ \t]+/);
    targets.forEach((name, i) => {
      const value = i === targets.length - 1 ? words.slice(i).join(' ') : words[i] ?? '';
      ctx.session.setVar(name, value);
    });
    return 0;
  },
};

function loopSignal(kind: 'break' | 'continue'): Command {
  return {
    name: kind,
    category: 'sistema',
    summary: kind === 'break' ? 'Sale de un bucle' : 'Salta a la siguiente vuelta del bucle',
    builtin: true,
    execute(ctx) {
      const n = Number(ctx.args[0] ?? 1);
      return ctx.shell.signal(kind, Number.isInteger(n) && n > 0 ? n : 1);
    },
  };
}

export const breakCommand = loopSignal('break');
export const continueCommand = loopSignal('continue');

export const returnCommand: Command = {
  name: 'return',
  category: 'sistema',
  summary: 'Sale de una función con un código',
  builtin: true,
  execute(ctx) {
    if (!ctx.shell.inScript()) return fail(ctx, 'can only `return\' from a function or sourced script');
    return ctx.shell.signal('return', Number(ctx.args[0] ?? ctx.session.lastExitCode) & 255);
  },
};

export const shiftCommand: Command = {
  name: 'shift',
  category: 'sistema',
  summary: 'Desplaza los argumentos posicionales ($2 pasa a ser $1)',
  builtin: true,
  execute(ctx) {
    const n = Number(ctx.args[0] ?? 1);
    const args = ctx.shell.positional();
    if (n > args.length) return 1;
    ctx.shell.setPositional(args.slice(n));
    return 0;
  },
};

export const typeCommand: Command = {
  name: 'type',
  category: 'sistema',
  summary: 'Indica qué es un nombre: alias, función, builtin o programa',
  builtin: true,
  execute(ctx) {
    let exitCode = 0;
    for (const name of ctx.args.filter((a) => !a.startsWith('-'))) {
      const alias = ctx.session.getAlias(name);
      const command = ctx.commands.get(name);
      if (alias !== undefined) ctx.stdout.write(`${name} is aliased to \`${alias}'\n`);
      else if (ctx.shell.hasFunction(name)) ctx.stdout.write(`${name} is a function\n`);
      else if (command?.builtin) ctx.stdout.write(`${name} is a shell builtin\n`);
      else if (command) ctx.stdout.write(`${name} is /usr/bin/${command.name}\n`);
      else {
        ctx.stderr.write(`bash: type: ${name}: not found\n`);
        exitCode = 1;
      }
    }
    return exitCode;
  },
};
