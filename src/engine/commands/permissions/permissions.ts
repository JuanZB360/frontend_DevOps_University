/**
 * Permisos y metadatos de archivos:
 *   chmod  (octal 755 o simbólico u+x,g-w,o=r, a+rX, +t, u+s; -R)
 *   chown  usuario[:grupo] (-R)      chgrp grupo (-R)
 *   umask  máscara para archivos nuevos
 *   stat   metadatos completos       ln (-s) enlaces       readlink (-f)
 *   file   tipo de archivo
 */
import { findGroup, findUser } from '../../system/accounts';
import { FsError, isFsError } from '../../vfs/errors';
import { basename, joinPath } from '../../vfs/path';
import { formatMode, formatOctal } from '../../vfs/permissions';
import { nodeSize, type FsNode } from '../../vfs/types';
import type { Command, CommandContext } from '../Command';
import { EXIT_USAGE, fail, reportFsError } from '../helpers';

/** Aplica un modo simbólico ("u+x,g-w", "a=r", "+t") a un modo actual. */
export function applySymbolicMode(current: number, spec: string, isDir: boolean, umask = 0o022): number | null {
  let mode = current;
  for (const clause of spec.split(',')) {
    const m = /^([ugoa]*)([+\-=])([rwxXst]*)$/.exec(clause);
    if (!m) return null;
    const [, whoText, op, permsText] = m;
    const who = whoText === '' ? 'a' : whoText;
    const targets = new Set(who.includes('a') ? ['u', 'g', 'o'] : [...who]);
    let bits = 0;
    for (const p of permsText) {
      const hasExec = isDir || (current & 0o111) !== 0;
      for (const t of targets) {
        const shift = t === 'u' ? 6 : t === 'g' ? 3 : 0;
        if (p === 'r') bits |= 4 << shift;
        if (p === 'w') bits |= 2 << shift;
        if (p === 'x' || (p === 'X' && hasExec)) bits |= 1 << shift;
        if (p === 's' && t === 'u') bits |= 0o4000;
        if (p === 's' && t === 'g') bits |= 0o2000;
      }
      if (p === 't') bits |= 0o1000;
    }
    // Sin "who" (+x), bash/chmod respeta la umask.
    if (whoText === '' && op !== '-') bits &= ~umask | 0o7000;
    if (op === '+') mode |= bits;
    else if (op === '-') mode &= ~bits;
    else {
      let clear = 0;
      for (const t of targets) clear |= 0o7 << (t === 'u' ? 6 : t === 'g' ? 3 : 0);
      if (targets.has('u')) clear |= 0o4000;
      if (targets.has('g')) clear |= 0o2000;
      mode = (mode & ~clear) | bits;
    }
  }
  return mode;
}

/** Recorre un árbol aplicando `fn` (para -R). */
function walk(ctx: CommandContext, path: string, shown: string, recursive: boolean, fn: (abs: string, shown: string, node: FsNode) => void): number {
  let node: FsNode;
  try {
    node = ctx.fs.stat(path);
  } catch (error) {
    return reportFsError(ctx, error, shown, 'cannot access');
  }
  let exitCode = 0;
  try {
    fn(path, shown, node);
  } catch (error) {
    if (!isFsError(error)) throw error;
    const verb = ctx.name === 'chmod' ? 'changing permissions of' : 'changing ownership of';
    ctx.stderr.write(`${ctx.name}: ${verb} '${shown}': ${error.reason}\n`);
    exitCode = 1;
  }
  if (recursive && node.type === 'dir') {
    let children: FsNode[] = [];
    try {
      children = ctx.fs.readDir(path);
    } catch (error) {
      return reportFsError(ctx, error, shown, 'cannot read directory');
    }
    for (const child of children) {
      if (child.type === 'symlink') continue;
      const code = walk(ctx, joinPath(path, child.name), `${shown}/${child.name}`, true, fn);
      if (code) exitCode = code;
    }
  }
  return exitCode;
}

function splitRecursive(args: readonly string[]): { recursive: boolean; verbose: boolean; rest: string[] } {
  let recursive = false;
  let verbose = false;
  const rest: string[] = [];
  for (const arg of args) {
    if (arg === '-R' || arg === '-r' || arg === '--recursive') recursive = true;
    else if (arg === '-v' || arg === '--verbose' || arg === '-c') verbose = true;
    else if (/^-[Rv]+$/.test(arg)) {
      recursive ||= arg.includes('R');
      verbose ||= arg.includes('v');
    } else rest.push(arg);
  }
  return { recursive, verbose, rest };
}

export const chmodCommand: Command = {
  name: 'chmod',
  category: 'permisos',
  summary: 'Cambia los permisos (755, u+x, g-w, o=r...)',
  execute(ctx) {
    const { recursive, verbose, rest } = splitRecursive(ctx.args);
    const [spec, ...files] = rest;
    if (!spec) return fail(ctx, 'missing operand', EXIT_USAGE);
    if (files.length === 0) return fail(ctx, `missing operand after '${spec}'`, EXIT_USAGE);
    const octal = /^[0-7]{1,4}$/.test(spec);
    if (!octal && applySymbolicMode(0, spec, false) === null) return fail(ctx, `invalid mode: '${spec}'`);
    let exitCode = 0;
    for (const file of files) {
      const code = walk(ctx, ctx.resolve(file), file, recursive, (abs, shown, node) => {
        const next = octal ? parseInt(spec, 8) : applySymbolicMode(node.mode & 0o7777, spec, node.type === 'dir', ctx.session.umask)!;
        ctx.fs.chmod(abs, next);
        if (verbose) ctx.stdout.write(`mode of '${shown}' changed to ${formatOctal(next).padStart(4, '0')} (${formatMode({ ...node, mode: next }).slice(1)})\n`);
      });
      if (code) exitCode = code;
    }
    return exitCode;
  },
};

export const chownCommand: Command = {
  name: 'chown',
  category: 'permisos',
  summary: 'Cambia el propietario (y el grupo) de archivos',
  execute(ctx) {
    const { recursive, verbose, rest } = splitRecursive(ctx.args);
    const [spec, ...files] = rest;
    if (!spec) return fail(ctx, 'missing operand', EXIT_USAGE);
    if (files.length === 0) return fail(ctx, `missing operand after '${spec}'`, EXIT_USAGE);
    const [ownerPart, groupPart] = spec.split(/[:.]/);
    const owner = ownerPart || undefined;
    let group = groupPart || undefined;
    if (owner && !findUser(ctx.fs, owner)) return fail(ctx, `invalid user: '${spec}'`);
    // "chown ana:" usa el grupo principal de ana.
    if (spec.endsWith(':') && owner) group = findGroup(ctx.fs, owner) ? owner : undefined;
    if (group && !findGroup(ctx.fs, group)) return fail(ctx, `invalid group: '${spec}'`);
    let exitCode = 0;
    for (const file of files) {
      const code = walk(ctx, ctx.resolve(file), file, recursive, (abs, shown) => {
        ctx.fs.chown(abs, owner, group);
        if (verbose) ctx.stdout.write(`changed ownership of '${shown}' to ${owner ?? ''}${group ? ':' + group : ''}\n`);
      });
      if (code) exitCode = code;
    }
    return exitCode;
  },
};

export const chgrpCommand: Command = {
  name: 'chgrp',
  category: 'permisos',
  summary: 'Cambia el grupo de archivos',
  execute(ctx) {
    const { recursive, rest } = splitRecursive(ctx.args);
    const [group, ...files] = rest;
    if (!group) return fail(ctx, 'missing operand', EXIT_USAGE);
    if (!findGroup(ctx.fs, group)) return fail(ctx, `invalid group: '${group}'`);
    let exitCode = 0;
    for (const file of files) {
      const code = walk(ctx, ctx.resolve(file), file, recursive, (abs) => {
        const node = ctx.fs.stat(abs);
        // Un usuario normal solo puede cambiar al grupo si pertenece a él.
        if (ctx.session.username !== 'root' && (node.owner !== ctx.session.username || !ctx.session.userGroups.includes(group))) {
          throw new FsError('EPERM', abs);
        }
        ctx.fs.chown(abs, undefined, group);
      });
      if (code) exitCode = code;
    }
    return exitCode;
  },
};

export const umaskCommand: Command = {
  name: 'umask',
  category: 'permisos',
  summary: 'Muestra o cambia la máscara de permisos para archivos nuevos',
  builtin: true,
  execute(ctx) {
    const [value] = ctx.args.filter((a) => a !== '-S');
    if (value === undefined) {
      if (ctx.args.includes('-S')) {
        const allowed = 0o777 & ~ctx.session.umask;
        const part = (shift: number): string => ['r', 'w', 'x'].filter((_, i) => allowed & ((4 >> i) << shift)).join('');
        ctx.stdout.write(`u=${part(6)},g=${part(3)},o=${part(0)}\n`);
      } else ctx.stdout.write(ctx.session.umask.toString(8).padStart(4, '0') + '\n');
      return 0;
    }
    if (!/^[0-7]{1,4}$/.test(value)) return fail(ctx, `${value}: octal number out of range`);
    ctx.session.umask = parseInt(value, 8) & 0o777;
    return 0;
  },
};

const TYPE_NAMES: Record<FsNode['type'], string> = { file: 'regular file', dir: 'directory', symlink: 'symbolic link' };

export const statCommand: Command = {
  name: 'stat',
  category: 'permisos',
  summary: 'Muestra todos los metadatos de un archivo',
  execute(ctx) {
    const format = ctx.args.find((a, i) => ctx.args[i - 1] === '-c' || a.startsWith('--format='));
    const files = ctx.args.filter((a, i) => !a.startsWith('-') && ctx.args[i - 1] !== '-c');
    if (files.length === 0) return fail(ctx, 'missing operand', EXIT_USAGE);
    let exitCode = 0;
    for (const file of files) {
      let node: FsNode;
      try {
        node = ctx.fs.stat(ctx.resolve(file), false);
      } catch (error) {
        exitCode = reportFsError(ctx, error, file, 'cannot statx');
        continue;
      }
      const uid = findUser(ctx.fs, node.owner)?.uid ?? 0;
      const gid = findGroup(ctx.fs, node.group)?.gid ?? 0;
      const date = new Date(node.mtime).toISOString().replace('T', ' ').replace('Z', '000000 +0000');
      if (format) {
        const fmt = format.replace(/^--format=/, '');
        ctx.stdout.write(fmt
          .replace(/%a/g, formatOctal(node.mode & 0o7777))
          .replace(/%A/g, formatMode(node))
          .replace(/%U/g, node.owner)
          .replace(/%G/g, node.group)
          .replace(/%s/g, String(nodeSize(node)))
          .replace(/%n/g, file)
          .replace(/%F/g, TYPE_NAMES[node.type]) + '\n');
        continue;
      }
      ctx.stdout.write(
        `  File: ${file}${node.type === 'symlink' ? ` -> ${node.target}` : ''}\n` +
        `  Size: ${String(nodeSize(node)).padEnd(15)} Blocks: ${Math.ceil(nodeSize(node) / 512)}          IO Block: 4096   ${TYPE_NAMES[node.type]}\n` +
        `Access: (${formatOctal(node.mode & 0o7777).padStart(4, '0')}/${formatMode(node)})  Uid: (${String(uid).padStart(5)}/${node.owner.padStart(8)})   Gid: (${String(gid).padStart(5)}/${node.group.padStart(8)})\n` +
        `Modify: ${date}\n`,
      );
    }
    return exitCode;
  },
};

export const lnCommand: Command = {
  name: 'ln',
  category: 'archivos',
  summary: 'Crea enlaces (-s simbólicos, como accesos directos)',
  execute(ctx) {
    const symbolic = ctx.args.some((a) => /^-[a-z]*s/.test(a) || a === '--symbolic');
    const force = ctx.args.some((a) => /^-[a-z]*f/.test(a) || a === '--force');
    const operands = ctx.args.filter((a) => !a.startsWith('-'));
    if (operands.length < 1) return fail(ctx, 'missing file operand', EXIT_USAGE);
    const [target, linkArg] = operands;
    let link = ctx.resolve(linkArg ?? basename(target));
    if (ctx.fs.isDirectory(link) && !ctx.fs.tryStat(link, false)?.type.startsWith('sym')) link = joinPath(link, basename(target));
    try {
      if (force && ctx.fs.tryStat(link, false)) ctx.fs.remove(link);
      if (symbolic) ctx.fs.symlink(target, link);
      else {
        // Enlace duro: en el simulador se crea como copia que comparte contenido.
        ctx.fs.copy(ctx.resolve(target), link);
      }
    } catch (error) {
      return reportFsError(ctx, error, linkArg ?? target, `failed to create ${symbolic ? 'symbolic ' : 'hard '}link`);
    }
    return 0;
  },
};

export const readlinkCommand: Command = {
  name: 'readlink',
  category: 'archivos',
  summary: 'Muestra a dónde apunta un enlace (-f ruta real)',
  execute(ctx) {
    const canonical = ctx.args.includes('-f') || ctx.args.includes('-e');
    const files = ctx.args.filter((a) => !a.startsWith('-'));
    let exitCode = 0;
    for (const file of files) {
      const abs = ctx.resolve(file);
      if (canonical) {
        try {
          ctx.stdout.write(ctx.fs.realPath(abs) + '\n');
        } catch {
          exitCode = 1;
        }
        continue;
      }
      const node = ctx.fs.tryStat(abs, false);
      if (node?.type === 'symlink') ctx.stdout.write(node.target + '\n');
      else exitCode = 1;
    }
    return exitCode;
  },
};

export const fileCommand: Command = {
  name: 'file',
  category: 'lectura',
  summary: 'Indica qué tipo de contenido tiene un archivo',
  execute(ctx) {
    let exitCode = 0;
    for (const file of ctx.args.filter((a) => !a.startsWith('-'))) {
      const node = ctx.fs.tryStat(ctx.resolve(file), false);
      if (!node) {
        ctx.stdout.write(`${file}: cannot open \`${file}' (No such file or directory)\n`);
        exitCode = 1;
        continue;
      }
      let description: string;
      if (node.type === 'dir') description = 'directory';
      else if (node.type === 'symlink') description = `symbolic link to ${node.target}`;
      else if (node.content.startsWith('#!ELF')) description = 'ELF 64-bit LSB pie executable, x86-64, dynamically linked';
      else if (node.content.startsWith('#!/bin/bash') || node.content.startsWith('#!/usr/bin/env bash')) description = 'Bourne-Again shell script, ASCII text executable';
      else if (node.content.startsWith('#!/bin/sh')) description = 'POSIX shell script, ASCII text executable';
      else if (node.content.startsWith('\x1f\x8b') || file.endsWith('.gz')) description = 'gzip compressed data';
      else if (node.content.startsWith('TARSIM')) description = 'POSIX tar archive (GNU)';
      else if (node.content.startsWith('PKSIM') || file.endsWith('.zip')) description = 'Zip archive data, at least v2.0 to extract';
      else if (nodeSize(node) === 0) description = 'empty';
      else if (/^\s*[{[]/.test(node.content)) description = 'JSON text data';
      else if (/^[\x09\x0a\x0d\x20-\x7e]*$/.test(node.content)) description = 'ASCII text';
      else description = 'Unicode text, UTF-8 text';
      ctx.stdout.write(`${file}: ${description}\n`);
    }
    return exitCode;
  },
};
