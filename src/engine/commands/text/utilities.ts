/**
 * Utilidades de uso diario:
 *   xargs  convierte la entrada en argumentos de otro comando
 *   printf imprime con formato
 *   seq    secuencias de números
 *   sleep  espera unos segundos
 *   basename / dirname   partes de una ruta
 *   env / printenv       variables de entorno
 *   diff   diferencias entre archivos
 *   less / more          paginadores (aquí muestran el texto completo)
 *   locate / updatedb    búsqueda rápida en un índice de rutas
 */
import { isFsError } from '../../vfs/errors';
import { basename, dirname, joinPath } from '../../vfs/path';
import { updateMachine } from '../../system/machine';
import type { Command, CommandContext } from '../Command';
import { EXIT_USAGE, fail, parseOrFail, readInputs } from '../helpers';
import { formatPrintf } from './awk';
import { compileRegex, splitLines } from './regex';

export const xargsCommand: Command = {
  name: 'xargs',
  category: 'texto',
  summary: 'Convierte la entrada en argumentos de otro comando',
  async execute(ctx) {
    let perCall = Infinity;
    let replace: string | null = null;
    let delimiter: string | null = null;
    let i = 0;
    for (; i < ctx.args.length; i++) {
      const arg = ctx.args[i];
      if (arg === '-n') perCall = Number(ctx.args[++i]);
      else if (/^-n\d+$/.test(arg)) perCall = Number(arg.slice(2));
      else if (arg === '-I') replace = ctx.args[++i] ?? '{}';
      else if (arg.startsWith('-I')) replace = arg.slice(2);
      else if (arg === '-d') delimiter = (ctx.args[++i] ?? '\n').replace('\\n', '\n');
      else if (arg === '-0') delimiter = '\0';
      else if (arg === '-r' || arg === '--no-run-if-empty' || arg === '-t' || arg === '-p') continue;
      else break;
    }
    const command = ctx.args.slice(i);
    if (command.length === 0) command.push('echo');
    const text = ctx.stdin ?? '';
    const items = delimiter !== null
      ? text.split(delimiter).filter((x, idx, all) => !(idx === all.length - 1 && x.trim() === ''))
      : text.split(/\s+/).filter(Boolean);
    if (items.length === 0) return 0;

    let exitCode = 0;
    if (replace !== null) {
      // -I {}: una ejecución por línea sustituyendo {}.
      const lines = delimiter !== null ? items : splitLines(text).filter((l) => l.trim() !== '');
      for (const item of lines) {
        const code = await ctx.shell.spawn(command.map((a) => a.replaceAll(replace!, item)), { stdin: null });
        if (code !== 0) exitCode = 123;
      }
      return exitCode;
    }
    const size = Number.isFinite(perCall) && perCall > 0 ? perCall : items.length;
    for (let start = 0; start < items.length; start += size) {
      const code = await ctx.shell.spawn([...command, ...items.slice(start, start + size)], { stdin: null });
      if (code !== 0) exitCode = 123;
    }
    return exitCode;
  },
};

export const printfCommand: Command = {
  name: 'printf',
  category: 'texto',
  summary: 'Imprime texto con formato (%s, %d, %5.2f...)',
  builtin: true,
  execute(ctx) {
    const [format, ...args] = ctx.args;
    if (format === undefined) {
      ctx.stderr.write('printf: usage: printf format [arguments]\n');
      return EXIT_USAGE;
    }
    const escaped = format.replace(/\\(.)/g, (m, c: string) => ({ n: '\n', t: '\t', r: '\r', '\\': '\\', e: '\x1b', '"': '"', "'": "'" } as Record<string, string>)[c] ?? m);
    const conversions = (escaped.match(/%[-+ 0#]*\d*(?:\.\d+)?[sdifxXocegG]/g) ?? []).length;
    // Como bash: el formato se repite hasta consumir todos los argumentos.
    if (conversions === 0 || args.length <= conversions) {
      ctx.stdout.write(formatPrintf(escaped, args));
      return 0;
    }
    for (let start = 0; start < args.length; start += conversions) {
      ctx.stdout.write(formatPrintf(escaped, args.slice(start, start + conversions)));
    }
    return 0;
  },
};

export const seqCommand: Command = {
  name: 'seq',
  category: 'texto',
  summary: 'Imprime una secuencia de números',
  execute(ctx) {
    let separator = '\n';
    let width = false;
    const numbers: number[] = [];
    for (let i = 0; i < ctx.args.length; i++) {
      const arg = ctx.args[i];
      if (arg === '-s') separator = ctx.args[++i] ?? '\n';
      else if (arg === '-w') width = true;
      else if (/^-?\d+(\.\d+)?$/.test(arg)) numbers.push(Number(arg));
      else return fail(ctx, `invalid floating point argument: '${arg}'`);
    }
    if (numbers.length === 0) return fail(ctx, 'missing operand', EXIT_USAGE);
    const [first, step, last] = numbers.length === 1 ? [1, 1, numbers[0]] : numbers.length === 2 ? [numbers[0], 1, numbers[1]] : numbers;
    if (step === 0) return fail(ctx, "invalid Zero increment value: '0'");
    const values: string[] = [];
    for (let n = first; step > 0 ? n <= last : n >= last; n += step) {
      values.push(String(Number(n.toFixed(10))));
      if (values.length > 100_000) break;
    }
    const pad = width ? Math.max(...values.map((v) => v.length)) : 0;
    if (values.length) ctx.stdout.write(values.map((v) => v.padStart(pad, '0')).join(separator) + '\n');
    return 0;
  },
};

export const sleepCommand: Command = {
  name: 'sleep',
  category: 'procesos',
  summary: 'Espera el número de segundos indicado',
  async execute(ctx) {
    const spec = ctx.args[0];
    if (!spec) return fail(ctx, 'missing operand', EXIT_USAGE);
    const m = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(spec);
    if (!m) return fail(ctx, `invalid time interval '${spec}'`);
    const seconds = Number(m[1]) * ({ '': 1, s: 1, m: 60, h: 3600, d: 86400 } as Record<string, number>)[m[2]];
    // En segundo plano no se espera: el proceso queda vivo hasta que pase el tiempo (ver `jobs`, `ps`).
    if (ctx.background) {
      const pid = ctx.backgroundPid;
      updateMachine(ctx.fs, (machine) => {
        const process = machine.processes.find((p) => p.pid === pid);
        if (process) process.endsAt = ctx.fs.now() + seconds * 1000;
      });
      return 0;
    }
    // En el simulador la espera real se limita a 2 segundos para no bloquear la terminal.
    await new Promise((r) => setTimeout(r, Math.min(seconds, 2) * 1000));
    return 0;
  },
};

export const basenameCommand: Command = {
  name: 'basename',
  category: 'texto',
  summary: 'Quita el directorio (y opcionalmente el sufijo) de una ruta',
  execute(ctx) {
    const [path, suffix] = ctx.args;
    if (path === undefined) return fail(ctx, 'missing operand', EXIT_USAGE);
    let name = path === '/' ? '/' : basename(path.startsWith('/') ? path : '/' + path);
    if (suffix && name.endsWith(suffix) && name !== suffix) name = name.slice(0, -suffix.length);
    ctx.stdout.write(name + '\n');
    return 0;
  },
};

export const dirnameCommand: Command = {
  name: 'dirname',
  category: 'texto',
  summary: 'Muestra el directorio de una ruta',
  execute(ctx) {
    const [path] = ctx.args;
    if (path === undefined) return fail(ctx, 'missing operand', EXIT_USAGE);
    if (!path.includes('/')) ctx.stdout.write('.\n');
    else {
      const dir = dirname(path.startsWith('/') ? path : '/' + path);
      ctx.stdout.write((path.startsWith('/') ? dir : dir.slice(1) || '.') + '\n');
    }
    return 0;
  },
};

export const envCommand: Command = {
  name: 'env',
  aliases: [],
  category: 'sistema',
  summary: 'Muestra las variables de entorno (o ejecuta un comando con otras)',
  async execute(ctx) {
    const assignments: [string, string][] = [];
    let i = 0;
    for (; i < ctx.args.length && /^[A-Za-z_]\w*=/.test(ctx.args[i]); i++) {
      const [name, ...rest] = ctx.args[i].split('=');
      assignments.push([name, rest.join('=')]);
    }
    const command = ctx.args.slice(i);
    if (command.length === 0) {
      const env = new Map(ctx.session.environment());
      for (const [k, v] of assignments) env.set(k, v);
      for (const [k, v] of env) ctx.stdout.write(`${k}=${v}\n`);
      return 0;
    }
    const previous = assignments.map(([k]) => [k, ctx.session.getVar(k)] as const);
    for (const [k, v] of assignments) ctx.session.setVar(k, v);
    try {
      return await ctx.shell.spawn(command);
    } finally {
      for (const [k, v] of previous) {
        if (v === undefined) ctx.session.unsetVar(k);
        else ctx.session.setVar(k, v);
      }
    }
  },
};

export const printenvCommand: Command = {
  name: 'printenv',
  category: 'sistema',
  summary: 'Muestra el valor de variables de entorno',
  execute(ctx) {
    if (ctx.args.length === 0) {
      for (const [k, v] of ctx.session.environment()) ctx.stdout.write(`${k}=${v}\n`);
      return 0;
    }
    let exitCode = 0;
    for (const name of ctx.args) {
      const value = ctx.session.isExported(name) ? ctx.session.getVar(name) : undefined;
      if (value === undefined) exitCode = 1;
      else ctx.stdout.write(value + '\n');
    }
    return exitCode;
  },
};

// ─────────────────────────────── diff ───────────────────────────────

/** Diferencias mínimas por líneas (LCS), en el formato normal o unificado de diff. */
function diffLines(a: string[], b: string[]): { op: ' ' | '-' | '+'; line: string; ai: number; bi: number }[] {
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  }
  const out: { op: ' ' | '-' | '+'; line: string; ai: number; bi: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) out.push({ op: ' ', line: a[i], ai: i++, bi: j++ });
    else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) out.push({ op: '+', line: b[j], ai: i, bi: j++ });
    else out.push({ op: '-', line: a[i], ai: i++, bi: j });
  }
  return out;
}

const range = (start: number, count: number): string => (count === 1 ? String(start) : `${start},${start + count - 1}`);

export const diffCommand: Command = {
  name: 'diff',
  category: 'texto',
  summary: 'Muestra las diferencias entre dos archivos',
  execute(ctx) {
    const options = parseOrFail(ctx, [
      { key: 'unified', short: 'u', long: 'unified' },
      { key: 'brief', short: 'q', long: 'brief' },
      { key: 'ignoreCase', short: 'i', long: 'ignore-case' },
      { key: 'ignoreSpace', short: 'w', long: 'ignore-all-space' },
      { key: 'recursive', short: 'r', long: 'recursive' },
    ]);
    if (!options) return EXIT_USAGE;
    const [left, right] = options.operands;
    if (left === undefined || right === undefined) return fail(ctx, `missing operand after '${left ?? 'diff'}'`, EXIT_USAGE);
    const inputs = readInputs(ctx, [left, right]);
    if (inputs.some((i) => i.content === null)) return 2;
    const normalize = (line: string): string => {
      let l = line;
      if (options.flags.has('ignoreCase')) l = l.toLowerCase();
      if (options.flags.has('ignoreSpace')) l = l.replace(/\s+/g, '');
      return l;
    };
    const a = splitLines(inputs[0].content!);
    const b = splitLines(inputs[1].content!);
    const changes = diffLines(a.map(normalize), b.map(normalize)).map((c) => ({
      ...c,
      line: c.op === '+' ? b[c.bi] : a[c.ai] ?? c.line,
    }));
    if (changes.every((c) => c.op === ' ')) return 0;
    if (options.flags.has('brief')) {
      ctx.stdout.write(`Files ${left} and ${right} differ\n`);
      return 1;
    }
    if (options.flags.has('unified')) {
      ctx.stdout.write(`--- ${left}\n+++ ${right}\n`);
      ctx.stdout.write(`@@ -1,${a.length} +1,${b.length} @@\n`);
      for (const c of changes) ctx.stdout.write(`${c.op}${c.line}\n`);
      return 1;
    }
    // Formato clásico: 3c3, 5d4, 7a8
    let k = 0;
    while (k < changes.length) {
      if (changes[k].op === ' ') {
        k++;
        continue;
      }
      const removed: typeof changes = [];
      const added: typeof changes = [];
      const startA = changes[k].ai;
      const startB = changes[k].bi;
      while (k < changes.length && changes[k].op !== ' ') {
        (changes[k].op === '-' ? removed : added).push(changes[k]);
        k++;
      }
      if (removed.length && added.length) ctx.stdout.write(`${range(startA + 1, removed.length)}c${range(startB + 1, added.length)}\n`);
      else if (removed.length) ctx.stdout.write(`${range(startA + 1, removed.length)}d${startB}\n`);
      else ctx.stdout.write(`${startA}a${range(startB + 1, added.length)}\n`);
      for (const r of removed) ctx.stdout.write(`< ${r.line}\n`);
      if (removed.length && added.length) ctx.stdout.write('---\n');
      for (const ad of added) ctx.stdout.write(`> ${ad.line}\n`);
    }
    return 1;
  },
};

function pager(name: 'less' | 'more'): Command {
  return {
    name,
    category: 'lectura',
    summary: name === 'less' ? 'Muestra un archivo para leerlo con calma' : 'Muestra un archivo página a página',
    execute(ctx: CommandContext) {
      const files = ctx.args.filter((a) => !a.startsWith('-') && !a.startsWith('+'));
      const numbered = ctx.args.includes('-N');
      let exitCode = 0;
      for (const input of readInputs(ctx, files)) {
        if (input.content === null) {
          exitCode = 1;
          continue;
        }
        const lines = splitLines(input.content);
        ctx.stdout.write(lines.map((l, i) => (numbered ? `${String(i + 1).padStart(6)} ${l}` : l)).join('\n') + (lines.length ? '\n' : ''));
      }
      if (ctx.stdout.isTTY) {
        ctx.stderr.write(`\x1b[7m(END)\x1b[0m \x1b[2m— en un servidor real, ${name} muestra el texto por páginas: ↑↓ para moverte, /texto para buscar, q para salir\x1b[0m\n`);
      }
      return exitCode;
    },
  };
}

export const lessCommand = pager('less');
export const moreCommand = pager('more');

// ─────────────────────────────── locate ───────────────────────────────

const LOCATE_DB = '/var/lib/mlocate/mlocate.db';

/** Recorre todo el sistema de archivos (como root) y guarda las rutas. */
function buildIndex(ctx: CommandContext): string[] {
  const paths: string[] = [];
  const walk = (path: string): void => {
    let children;
    try {
      children = ctx.fs.readDir(path);
    } catch (error) {
      if (isFsError(error)) return;
      throw error;
    }
    for (const child of children) {
      const childPath = joinPath(path, child.name);
      if (childPath.startsWith('/proc')) continue;
      paths.push(childPath);
      if (child.type === 'dir') walk(childPath);
    }
  };
  walk('/');
  return paths;
}

export const updatedbCommand: Command = {
  name: 'updatedb',
  category: 'archivos',
  summary: 'Actualiza el índice de archivos que usa locate (requiere root)',
  execute(ctx) {
    if (ctx.session.username !== 'root') return fail(ctx, `can not open a temporary file for \`${LOCATE_DB}'`);
    const index = buildIndex(ctx);
    ctx.fs.mkdir(dirname(LOCATE_DB), true);
    ctx.fs.writeFile(LOCATE_DB, index.join('\n') + '\n');
    return 0;
  },
};

export const locateCommand: Command = {
  name: 'locate',
  category: 'archivos',
  summary: 'Busca archivos por nombre en un índice (rapidísimo)',
  execute(ctx) {
    const options = parseOrFail(ctx, [
      { key: 'ignoreCase', short: 'i', long: 'ignore-case' },
      { key: 'count', short: 'c', long: 'count' },
      { key: 'basename', short: 'b', long: 'basename' },
    ]);
    if (!options) return EXIT_USAGE;
    if (options.operands.length === 0) return fail(ctx, 'no pattern to search for specified');
    let index: string[];
    try {
      index = splitLines(ctx.fs.readFile(LOCATE_DB));
    } catch {
      // Ubuntu lo genera cada noche con cron; si no existe, se crea ahora.
      index = buildIndex(ctx);
    }
    const tests = options.operands.map((p) => {
      const glob = /[*?[]/.test(p);
      const re = glob
        ? new RegExp('^' + p.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', options.flags.has('ignoreCase') ? 'i' : '')
        : compileRegex(p, { fixed: true, ignoreCase: options.flags.has('ignoreCase') });
      return (path: string): boolean => re.test(options.flags.has('basename') || glob ? basename(path) : path);
    });
    const found = index.filter((path) => path && tests.some((t) => t(path)) && ctx.fs.exists(path));
    if (options.flags.has('count')) ctx.stdout.write(`${found.length}\n`);
    else for (const path of found) ctx.stdout.write(path + '\n');
    return found.length ? 0 : 1;
  },
};

export const truncateCommand: Command = {
  name: 'truncate',
  category: 'archivos',
  summary: 'Cambia el tamaño de un archivo (truncate -s 0 vacía un log sin borrarlo)',
  execute(ctx) {
    const sIndex = ctx.args.indexOf('-s');
    const spec = sIndex !== -1 ? ctx.args[sIndex + 1] : ctx.args.find((a) => a.startsWith('--size='))?.slice(7);
    if (spec === undefined) return fail(ctx, "you must specify either '--size' or '--reference'", EXIT_USAGE);
    const files = ctx.args.filter((a, i) => !a.startsWith('-') && i !== sIndex + 1);
    if (spec !== '0') return fail(ctx, 'en el simulador solo se admite -s 0 (vaciar el archivo)');
    let exitCode = 0;
    for (const file of files) {
      try {
        ctx.fs.writeFile(ctx.resolve(file), '');
      } catch (error) {
        if (!isFsError(error)) throw error;
        ctx.stderr.write(`truncate: cannot open '${file}' for writing: ${error.reason}\n`);
        exitCode = 1;
      }
    }
    return exitCode;
  },
};

export const getentCommand: Command = {
  name: 'getent',
  category: 'usuarios',
  summary: 'Consulta las bases de datos del sistema (passwd, group, hosts)',
  execute(ctx) {
    const [database, key] = ctx.args;
    const files: Record<string, string> = { passwd: '/etc/passwd', group: '/etc/group', hosts: '/etc/hosts' };
    const path = files[database ?? ''];
    if (!path) return fail(ctx, `Unknown database: ${database ?? ''}`, 1);
    const lines = ctx.fs.readFile(path).split('\n').filter(Boolean);
    const found = key === undefined ? lines : lines.filter((l) => (database === 'hosts' ? l.split(/\s+/).includes(key) : l.split(':')[0] === key));
    for (const line of found) ctx.stdout.write(line + '\n');
    return found.length ? 0 : 2;
  },
};
