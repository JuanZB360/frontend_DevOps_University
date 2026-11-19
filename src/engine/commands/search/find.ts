/**
 * find — busca archivos recorriendo directorios y evaluando una expresión.
 *
 *   Tests:    -name -iname -path -type f|d|l -size [+-]N[ckMG] -mtime/-mmin [+-]N
 *             -user -group -perm MODO|-MODO|/MODO -empty -newer ARCHIVO
 *   Opciones: -maxdepth N -mindepth N
 *   Acciones: -print -delete -ls -exec cmd {} \;  -exec cmd {} +
 *   Lógica:   ! / -not, -a / -and (implícito), -o / -or, ( )
 */
import { isFsError } from '../../vfs/errors';
import { joinPath } from '../../vfs/path';
import { formatMode } from '../../vfs/permissions';
import { nodeSize, type FsNode } from '../../vfs/types';
import type { Command, CommandContext } from '../Command';

type Node =
  | { k: 'test'; fn: (entry: Entry) => boolean }
  | { k: 'not'; e: Node }
  | { k: 'and'; l: Node; r: Node }
  | { k: 'or'; l: Node; r: Node }
  | { k: 'action'; name: 'print' | 'delete' | 'ls' | 'exec'; argv?: string[]; batch?: boolean };

interface Entry {
  shown: string;
  abs: string;
  node: FsNode;
  depth: number;
}

class FindError extends Error {}

function globToRegExp(glob: string, ignoreCase: boolean): RegExp {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') source += '.*';
    else if (ch === '?') source += '.';
    else if (ch === '[') {
      const end = glob.indexOf(']', i + 1);
      if (end === -1) source += '\\[';
      else {
        source += '[' + glob.slice(i + 1, end).replace(/^!/, '^') + ']';
        i = end;
      }
    } else if (ch === '\\' && i + 1 < glob.length) source += '\\' + glob[++i];
    else source += ch.replace(/[.+^${}()|\\/]/g, '\\$&');
  }
  return new RegExp(`^${source}$`, ignoreCase ? 'is' : 's');
}

const UNIT: Record<string, number> = { c: 1, k: 1024, K: 1024, M: 1024 ** 2, G: 1024 ** 3, b: 512, '': 512 };

/** Compara un número con +N (más), -N (menos) o N (exacto). */
function numericTest(spec: string, value: number): boolean {
  const n = Number(spec.replace(/^[+-]/, ''));
  if (spec.startsWith('+')) return value > n;
  if (spec.startsWith('-')) return value < n;
  return value === n;
}

interface Parsed {
  expr: Node | null;
  maxDepth: number;
  minDepth: number;
  hasAction: boolean;
}

function parseExpression(ctx: CommandContext, args: string[], now: number): Parsed {
  let pos = 0;
  let maxDepth = Infinity;
  let minDepth = 0;
  let hasAction = false;
  const need = (flag: string): string => {
    const value = args[pos++];
    if (value === undefined) throw new FindError(`missing argument to \`${flag}'`);
    return value;
  };

  const primary = (): Node | null => {
    const token = args[pos++];
    switch (token) {
      case '(': {
        const e = or();
        if (args[pos++] !== ')') throw new FindError("invalid expression; I was expecting to find a ')' somewhere but did not see one.");
        return e;
      }
      case '!': case '-not': {
        const e = primary();
        return e ? { k: 'not', e } : null;
      }
      case '-name': case '-iname': {
        const re = globToRegExp(need(token), token === '-iname');
        return { k: 'test', fn: (e) => re.test(e.shown === '/' ? '/' : e.shown.split('/').filter(Boolean).at(-1) ?? e.shown) };
      }
      case '-path': case '-wholename': {
        const re = globToRegExp(need(token), false);
        return { k: 'test', fn: (e) => re.test(e.shown) };
      }
      case '-type': {
        const type = need(token);
        const map: Record<string, FsNode['type']> = { f: 'file', d: 'dir', l: 'symlink' };
        if (!map[type]) throw new FindError(`Unknown argument to -type: ${type}`);
        return { k: 'test', fn: (e) => e.node.type === map[type] };
      }
      case '-size': {
        const spec = need(token);
        const m = /^([+-]?)(\d+)([ckMGb]?)$/.exec(spec);
        if (!m) throw new FindError(`invalid -size type in ${spec}`);
        const unit = UNIT[m[3]];
        return { k: 'test', fn: (e) => numericTest(m[1] + m[2], Math.ceil(nodeSize(e.node) / unit)) };
      }
      case '-mtime': case '-mmin': {
        const spec = need(token);
        const period = token === '-mtime' ? 86_400_000 : 60_000;
        return { k: 'test', fn: (e) => numericTest(spec, Math.floor((now - e.node.mtime) / period)) };
      }
      case '-newer': {
        const reference = ctx.fs.tryStat(ctx.resolve(need(token)));
        if (!reference) throw new FindError(`'${args[pos - 1]}': No such file or directory`);
        return { k: 'test', fn: (e) => e.node.mtime > reference.mtime };
      }
      case '-user': {
        const user = need(token);
        return { k: 'test', fn: (e) => e.node.owner === user };
      }
      case '-group': {
        const group = need(token);
        return { k: 'test', fn: (e) => e.node.group === group };
      }
      case '-perm': {
        const spec = need(token);
        const mode = parseInt(spec.replace(/^[-/]/, ''), 8);
        if (Number.isNaN(mode)) throw new FindError(`invalid mode '${spec}'`);
        if (spec.startsWith('-')) return { k: 'test', fn: (e) => (e.node.mode & mode) === mode };
        if (spec.startsWith('/')) return { k: 'test', fn: (e) => (e.node.mode & mode) !== 0 };
        return { k: 'test', fn: (e) => (e.node.mode & 0o7777) === mode };
      }
      case '-empty':
        return { k: 'test', fn: (e) => (e.node.type === 'dir' ? Object.keys(e.node.children).length === 0 : e.node.type === 'file' && nodeSize(e.node) === 0) };
      case '-maxdepth':
        maxDepth = Number(need(token));
        return null;
      case '-mindepth':
        minDepth = Number(need(token));
        return null;
      case '-print': case '-print0':
        hasAction = true;
        return { k: 'action', name: 'print' };
      case '-delete':
        hasAction = true;
        return { k: 'action', name: 'delete' };
      case '-ls':
        hasAction = true;
        return { k: 'action', name: 'ls' };
      case '-exec': case '-ok': {
        const argv: string[] = [];
        let batch = false;
        for (;;) {
          const arg = args[pos++];
          if (arg === undefined) throw new FindError(`missing argument to \`${token}'`);
          if (arg === ';') break;
          if (arg === '+' && argv.at(-1) === '{}') {
            batch = true;
            break;
          }
          argv.push(arg);
        }
        hasAction = true;
        return { k: 'action', name: 'exec', argv, batch };
      }
      case undefined:
        throw new FindError('expected an expression');
      default:
        throw new FindError(`unknown predicate \`${token}'`);
    }
  };

  const and = (): Node | null => {
    let left = primary();
    while (pos < args.length && args[pos] !== '-o' && args[pos] !== '-or' && args[pos] !== ')') {
      if (args[pos] === '-a' || args[pos] === '-and') pos++;
      const right = primary();
      if (!right) continue;
      left = left ? { k: 'and', l: left, r: right } : right;
    }
    return left;
  };

  const or = (): Node | null => {
    let left = and();
    while (args[pos] === '-o' || args[pos] === '-or') {
      pos++;
      const right = and();
      if (left && right) left = { k: 'or', l: left, r: right };
      else left = left ?? right;
    }
    return left;
  };

  const expr = args.length ? or() : null;
  if (pos < args.length) throw new FindError(`paths must precede expression: \`${args[pos]}'`);
  return { expr, maxDepth, minDepth, hasAction };
}

export const findCommand: Command = {
  name: 'find',
  category: 'archivos',
  summary: 'Busca archivos por nombre, tipo, tamaño, fecha, dueño...',
  async execute(ctx) {
    const paths: string[] = [];
    let i = 0;
    while (i < ctx.args.length && !ctx.args[i].startsWith('-') && ctx.args[i] !== '(' && ctx.args[i] !== '!') paths.push(ctx.args[i++]);
    if (paths.length === 0) paths.push('.');

    let parsed: Parsed;
    try {
      parsed = parseExpression(ctx, ctx.args.slice(i), Date.now());
    } catch (error) {
      if (!(error instanceof FindError)) throw error;
      ctx.stderr.write(`find: ${error.message}\n`);
      return 1;
    }

    let exitCode = 0;
    const batches = new Map<Node, string[]>();
    const toDelete: Entry[] = [];

    const evaluate = async (node: Node, entry: Entry): Promise<boolean> => {
      switch (node.k) {
        case 'test': return node.fn(entry);
        case 'not': return !(await evaluate(node.e, entry));
        case 'and': return (await evaluate(node.l, entry)) && evaluate(node.r, entry);
        case 'or': return (await evaluate(node.l, entry)) || evaluate(node.r, entry);
        case 'action':
          if (node.name === 'print') ctx.stdout.write(entry.shown + '\n');
          else if (node.name === 'ls') ctx.stdout.write(`${formatMode(entry.node)} ${entry.node.owner} ${entry.node.group} ${String(nodeSize(entry.node)).padStart(8)} ${entry.shown}\n`);
          else if (node.name === 'delete') toDelete.push(entry);
          else if (node.batch) {
            const list = batches.get(node) ?? [];
            list.push(entry.shown);
            batches.set(node, list);
          } else {
            const argv = node.argv!.map((a) => a.replaceAll('{}', entry.shown));
            return (await ctx.shell.spawn(argv)) === 0;
          }
          return true;
      }
    };

    const visit = async (entry: Entry): Promise<void> => {
      if (entry.depth >= parsed.minDepth && entry.depth <= parsed.maxDepth) {
        const matched = parsed.expr ? await evaluate(parsed.expr, entry) : true;
        if (matched && !parsed.hasAction) ctx.stdout.write(entry.shown + '\n');
      }
      if (entry.node.type !== 'dir' || entry.depth >= parsed.maxDepth) return;
      let children: FsNode[];
      try {
        children = ctx.fs.readDir(entry.abs);
      } catch (error) {
        if (!isFsError(error)) throw error;
        ctx.stderr.write(`find: '${entry.shown}': ${error.reason}\n`);
        exitCode = 1;
        return;
      }
      for (const child of children) {
        const shown = entry.shown.endsWith('/') ? entry.shown + child.name : `${entry.shown}/${child.name}`;
        await visit({ shown, abs: joinPath(entry.abs, child.name), node: child, depth: entry.depth + 1 });
      }
    };

    for (const path of paths) {
      const abs = ctx.resolve(path);
      const node = ctx.fs.tryStat(abs);
      if (!node) {
        ctx.stderr.write(`find: '${path}': No such file or directory\n`);
        exitCode = 1;
        continue;
      }
      await visit({ shown: path, abs, node, depth: 0 });
    }

    for (const [node, list] of batches) {
      if (node.k !== 'action' || !node.argv) continue;
      const argv = node.argv.flatMap((a) => (a === '{}' ? list : [a]));
      if ((await ctx.shell.spawn(argv)) !== 0) exitCode = 1;
    }
    // -delete borra de lo más profundo a lo más superficial.
    for (const entry of toDelete.sort((a, b) => b.depth - a.depth)) {
      try {
        if (entry.node.type === 'dir') ctx.fs.rmdir(entry.abs);
        else ctx.fs.remove(entry.abs);
      } catch (error) {
        if (!isFsError(error)) throw error;
        ctx.stderr.write(`find: cannot delete '${entry.shown}': ${error.reason}\n`);
        exitCode = 1;
      }
    }
    return exitCode;
  },
};

