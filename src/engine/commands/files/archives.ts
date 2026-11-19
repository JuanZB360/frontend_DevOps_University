/**
 * Archivar y comprimir:
 *   tar   -c crear  -x extraer  -t listar  -z gzip  -v detalle  -f archivo  -C destino
 *   gzip / gunzip / zcat     zip / unzip
 *
 * Los archivos se guardan en un formato propio del simulador (JSON) con una
 * cabecera reconocible; el comportamiento y los mensajes son los reales.
 */
import { isFsError } from '../../vfs/errors';
import { dirname, joinPath } from '../../vfs/path';
import { nodeSize, type FsNode } from '../../vfs/types';
import type { Command, CommandContext } from '../Command';
import { EXIT_USAGE, fail, reportFsError } from '../helpers';

const TAR_MAGIC = 'TARSIM\n';
const GZ_MAGIC = '\x1f\x8bGZSIM\n';
const ZIP_MAGIC = 'PKSIM\n';

interface Entry {
  path: string;
  type: 'file' | 'dir' | 'symlink';
  content?: string;
  target?: string;
  mode: number;
  owner: string;
  group: string;
  size?: number;
  mtime: number;
}

function encodeArchive(magic: string, entries: Entry[]): string {
  return magic + JSON.stringify(entries);
}

function decodeArchive(magic: string, content: string): Entry[] | null {
  if (!content.startsWith(magic)) return null;
  try {
    return JSON.parse(content.slice(magic.length)) as Entry[];
  } catch {
    return null;
  }
}

/** gzip: guarda el contenido y el tamaño comprimido simulado (~25 %). */
export function gzipContent(content: string, size: number): { content: string; size: number } {
  return { content: GZ_MAGIC + JSON.stringify({ content, size }), size: Math.max(20, Math.round(size * 0.25)) };
}

export function gunzipContent(content: string): { content: string; size: number } | null {
  if (!content.startsWith(GZ_MAGIC)) return null;
  try {
    return JSON.parse(content.slice(GZ_MAGIC.length)) as { content: string; size: number };
  } catch {
    return null;
  }
}

/** Recoge recursivamente los nodos bajo `abs` como entradas de archivo. */
function collect(ctx: CommandContext, abs: string, stored: string, entries: Entry[], excludes: RegExp[], verbose: boolean): boolean {
  let node: FsNode;
  try {
    node = ctx.fs.stat(abs, false);
  } catch (error) {
    reportFsError(ctx, error, stored, 'Cannot stat');
    return false;
  }
  if (excludes.some((re) => re.test(stored) || re.test(stored.split('/').at(-1) ?? ''))) return true;
  const base = { path: stored, mode: node.mode, owner: node.owner, group: node.group, mtime: node.mtime };
  if (verbose) ctx.stdout.write(`${stored}${node.type === 'dir' ? '/' : ''}\n`);
  if (node.type === 'symlink') entries.push({ ...base, type: 'symlink', target: node.target });
  else if (node.type === 'file') {
    try {
      entries.push({ ...base, type: 'file', content: ctx.fs.readFile(abs), size: node.size });
    } catch (error) {
      reportFsError(ctx, error, stored, 'Cannot open');
      return false;
    }
  } else {
    entries.push({ ...base, type: 'dir' });
    let ok = true;
    let children: FsNode[] = [];
    try {
      children = ctx.fs.readDir(abs);
    } catch (error) {
      reportFsError(ctx, error, stored, 'Cannot open');
      return false;
    }
    for (const child of children) ok = collect(ctx, joinPath(abs, child.name), `${stored}/${child.name}`, entries, excludes, verbose) && ok;
  }
  return true;
}

/** Escribe las entradas en `dest`. */
function extract(ctx: CommandContext, entries: Entry[], dest: string, verbose: boolean, keepOwner: boolean): number {
  let exitCode = 0;
  for (const entry of entries) {
    const abs = joinPath(dest, entry.path);
    if (verbose) ctx.stdout.write(`${entry.path}${entry.type === 'dir' ? '/' : ''}\n`);
    try {
      if (entry.type === 'dir') {
        ctx.fs.mkdir(abs, true);
      } else {
        ctx.fs.mkdir(dirname(abs), true);
        if (entry.type === 'symlink') {
          if (ctx.fs.tryStat(abs, false)) ctx.fs.remove(abs);
          ctx.fs.symlink(entry.target ?? '', abs);
          continue;
        }
        ctx.fs.writeFile(abs, entry.content ?? '');
        if (entry.size !== undefined) {
          const node = ctx.fs.stat(abs);
          if (node.type === 'file') node.size = entry.size;
        }
      }
      ctx.fs.chmod(abs, entry.mode);
      if (keepOwner && ctx.session.username === 'root') ctx.fs.chown(abs, entry.owner, entry.group);
    } catch (error) {
      if (!isFsError(error)) throw error;
      ctx.stderr.write(`tar: ${entry.path}: Cannot open: ${error.reason}\n`);
      exitCode = 2;
    }
  }
  return exitCode;
}

export const tarCommand: Command = {
  name: 'tar',
  category: 'archivos',
  summary: 'Empaqueta y desempaqueta archivos (-czvf crear, -xzvf extraer)',
  execute(ctx) {
    let mode: 'c' | 'x' | 't' | null = null;
    let gzip = false;
    let verbose = false;
    let file: string | null = null;
    let directory: string | null = null;
    const excludes: RegExp[] = [];
    const operands: string[] = [];
    const args = [...ctx.args];
    // "tar czvf x.tgz dir" (sin guion) también es válido.
    if (args[0] && !args[0].startsWith('-') && /^[cxtzvfjJpC]+$/.test(args[0])) args[0] = '-' + args[0];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg.startsWith('--exclude=')) {
        excludes.push(new RegExp('^' + arg.slice(10).replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*') + '$'));
      } else if (arg === '--exclude') {
        excludes.push(new RegExp('^' + (args[++i] ?? '').replace(/\*/g, '.*') + '$'));
      } else if (arg === '-C' || arg === '--directory') directory = args[++i] ?? null;
      else if (arg === '--create') mode = 'c';
      else if (arg === '--extract') mode = 'x';
      else if (arg === '--list') mode = 't';
      else if (arg === '--gzip') gzip = true;
      else if (arg === '--verbose') verbose = true;
      else if (arg.startsWith('--file=')) file = arg.slice(7);
      else if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
        for (let j = 1; j < arg.length; j++) {
          const letter = arg[j];
          if ('cxt'.includes(letter)) {
            if (mode && mode !== letter) return fail(ctx, "You may not specify more than one '-Acdtrux', '--delete' or  '--test-label' option", EXIT_USAGE);
            mode = letter as 'c' | 'x' | 't';
          } else if (letter === 'z' || letter === 'j' || letter === 'J') gzip = true;
          else if (letter === 'v') verbose = true;
          else if (letter === 'p') continue;
          else if (letter === 'f') {
            file = arg.slice(j + 1) || args[++i] || null;
            break;
          } else if (letter === 'C') {
            directory = arg.slice(j + 1) || args[++i] || null;
            break;
          } else return fail(ctx, `invalid option -- '${letter}'\nTry 'tar --help' or 'tar --usage' for more information.`, EXIT_USAGE);
        }
      } else operands.push(arg);
    }
    if (!mode) return fail(ctx, "You must specify one of the '-Acdtrux', '--delete' or '--test-label' options\nTry 'tar --help' or 'tar --usage' for more information.", EXIT_USAGE);
    if (!file) return fail(ctx, 'Refusing to read archive contents from terminal (missing -f option?)', EXIT_USAGE);

    if (mode === 'c') {
      if (operands.length === 0) return fail(ctx, 'Cowardly refusing to create an empty archive', EXIT_USAGE);
      const base = directory ? ctx.resolve(directory) : ctx.session.cwd;
      const entries: Entry[] = [];
      let ok = true;
      let warnedSlash = false;
      for (const operand of operands) {
        const stored = operand.replace(/^\/+/, '').replace(/\/+$/, '') || '.';
        if (operand.startsWith('/') && !warnedSlash) {
          ctx.stderr.write("tar: Removing leading `/' from member names\n");
          warnedSlash = true;
        }
        ok = collect(ctx, operand.startsWith('/') ? operand : joinPath(base, operand), stored, entries, excludes, verbose) && ok;
      }
      let content = encodeArchive(TAR_MAGIC, entries);
      const rawSize = entries.reduce((s, e) => s + (e.size ?? e.content?.length ?? 0) + 512, 10_240);
      let size = rawSize;
      if (gzip) {
        const gz = gzipContent(content, rawSize);
        content = gz.content;
        size = gz.size;
      }
      try {
        ctx.fs.writeFile(ctx.resolve(file), content);
        const node = ctx.fs.stat(ctx.resolve(file));
        if (node.type === 'file') node.size = size;
      } catch (error) {
        return reportFsError(ctx, error, file, 'Cannot open');
      }
      if (!ok) ctx.stderr.write('tar: Exiting with failure status due to previous errors\n');
      return ok ? 0 : 2;
    }

    let raw: string;
    try {
      raw = ctx.fs.readFile(ctx.resolve(file));
    } catch (error) {
      ctx.stderr.write(`tar: ${file}: Cannot open: ${isFsError(error) ? error.reason : 'error'}\ntar: Error is not recoverable: exiting now\n`);
      return 2;
    }
    // GNU tar detecta la compresión al leer aunque no se ponga -z.
    const unzipped = gunzipContent(raw);
    const entries = decodeArchive(TAR_MAGIC, unzipped ? unzipped.content : raw);
    if (!entries) {
      ctx.stderr.write('tar: This does not look like a tar archive\ntar: Exiting with failure status due to previous errors\n');
      return 2;
    }
    const filter = operands.length ? (e: Entry) => operands.some((o) => e.path === o.replace(/\/$/, '') || e.path.startsWith(o.replace(/\/$/, '') + '/')) : () => true;
    if (mode === 't') {
      for (const e of entries.filter(filter)) {
        if (verbose) ctx.stdout.write(`${e.type === 'dir' ? 'd' : e.type === 'symlink' ? 'l' : '-'}${'rwxrwxrwx'.split('').map((c, i) => (e.mode & (256 >> i) ? c : '-')).join('')} ${e.owner}/${e.group} ${String(e.size ?? e.content?.length ?? 0).padStart(8)} ${new Date(e.mtime).toISOString().slice(0, 16).replace('T', ' ')} ${e.path}${e.type === 'dir' ? '/' : ''}\n`);
        else ctx.stdout.write(`${e.path}${e.type === 'dir' ? '/' : ''}\n`);
      }
      return 0;
    }
    const dest = directory ? ctx.resolve(directory) : ctx.session.cwd;
    if (!ctx.fs.isDirectory(dest)) return fail(ctx, `${directory}: Cannot open: No such file or directory`, 2);
    return extract(ctx, entries.filter(filter), dest, verbose, true);
  },
};

function createGzip(name: 'gzip' | 'gunzip' | 'zcat'): Command {
  return {
    name,
    category: 'archivos',
    summary: name === 'gzip' ? 'Comprime archivos (.gz)' : name === 'gunzip' ? 'Descomprime archivos .gz' : 'Muestra un .gz sin descomprimirlo',
    execute(ctx) {
      const decompress = name !== 'gzip' || ctx.args.includes('-d');
      const keep = ctx.args.includes('-k') || ctx.args.includes('--keep');
      const toStdout = name === 'zcat' || ctx.args.includes('-c');
      const list = ctx.args.includes('-l');
      const files = ctx.args.filter((a) => !a.startsWith('-'));
      if (files.length === 0) {
        if (ctx.stdin === null) return fail(ctx, 'compressed data not written to a terminal. Use -f to force compression.');
        ctx.stdout.write(decompress ? gunzipContent(ctx.stdin)?.content ?? '' : gzipContent(ctx.stdin, ctx.stdin.length).content);
        return 0;
      }
      let exitCode = 0;
      for (const file of files) {
        const abs = ctx.resolve(file);
        try {
          const node = ctx.fs.stat(abs);
          if (node.type === 'dir') {
            ctx.stderr.write(`${name}: ${file} is a directory -- ignored\n`);
            exitCode = 2;
            continue;
          }
          const content = ctx.fs.readFile(abs);
          if (list) {
            const g = gunzipContent(content);
            ctx.stdout.write(`         compressed        uncompressed  ratio uncompressed_name\n${String(nodeSize(node)).padStart(19)} ${String(g?.size ?? 0).padStart(19)}  75.0% ${file.replace(/\.gz$/, '')}\n`);
            continue;
          }
          if (decompress) {
            if (!file.endsWith('.gz') && !toStdout) {
              ctx.stderr.write(`${name}: ${file}: unknown suffix -- ignored\n`);
              exitCode = 2;
              continue;
            }
            const g = gunzipContent(content);
            if (!g) {
              ctx.stderr.write(`${name}: ${file}: not in gzip format\n`);
              exitCode = 1;
              continue;
            }
            if (toStdout) {
              ctx.stdout.write(g.content);
              continue;
            }
            const out = abs.replace(/\.gz$/, '');
            ctx.fs.writeFile(out, g.content);
            const outNode = ctx.fs.stat(out);
            if (outNode.type === 'file' && g.size !== g.content.length) outNode.size = g.size;
            if (!keep) ctx.fs.remove(abs);
          } else {
            if (file.endsWith('.gz')) {
              ctx.stderr.write(`gzip: ${file} already has .gz suffix -- unchanged\n`);
              continue;
            }
            const g = gzipContent(content, nodeSize(node));
            if (toStdout) {
              ctx.stdout.write(g.content);
              continue;
            }
            ctx.fs.writeFile(abs + '.gz', g.content);
            const outNode = ctx.fs.stat(abs + '.gz');
            if (outNode.type === 'file') outNode.size = g.size;
            if (!keep) ctx.fs.remove(abs);
          }
        } catch (error) {
          exitCode = reportFsError(ctx, error, file);
        }
      }
      return exitCode;
    },
  };
}

export const gzipCommand = createGzip('gzip');
export const gunzipCommand = createGzip('gunzip');
export const zcatCommand = createGzip('zcat');

export const zipCommand: Command = {
  name: 'zip',
  category: 'archivos',
  summary: 'Crea archivos .zip (-r para directorios)',
  package: 'zip',
  execute(ctx) {
    const recursive = ctx.args.includes('-r');
    const [archive, ...paths] = ctx.args.filter((a) => !a.startsWith('-'));
    if (!archive || paths.length === 0) return fail(ctx, 'zip error: Nothing to do!', 12);
    const entries: Entry[] = [];
    for (const p of paths) {
      const abs = ctx.resolve(p);
      if (ctx.fs.isDirectory(abs) && !recursive) {
        entries.push({ path: p, type: 'dir', mode: 0o755, owner: ctx.session.username, group: ctx.session.username, mtime: ctx.fs.now() });
        ctx.stdout.write(`  adding: ${p}/ (stored 0%)\n`);
        continue;
      }
      const before = entries.length;
      collect(ctx, abs, p.replace(/\/$/, ''), entries, [], false);
      for (const e of entries.slice(before)) ctx.stdout.write(`  adding: ${e.path}${e.type === 'dir' ? '/ (stored 0%)' : ' (deflated 62%)'}\n`);
    }
    const name = archive.endsWith('.zip') ? archive : archive + '.zip';
    ctx.fs.writeFile(ctx.resolve(name), encodeArchive(ZIP_MAGIC, entries));
    return 0;
  },
};

export const unzipCommand: Command = {
  name: 'unzip',
  category: 'archivos',
  summary: 'Extrae archivos .zip (-l lista, -d destino)',
  package: 'unzip',
  execute(ctx) {
    const list = ctx.args.includes('-l');
    const dIndex = ctx.args.indexOf('-d');
    const archive = ctx.args.find((a, i) => !a.startsWith('-') && (dIndex === -1 || i !== dIndex + 1));
    if (!archive) return fail(ctx, 'Usage: unzip [-Z] [-opts[modifiers]] file[.zip] [list] [-x xlist] [-d exdir]', 10);
    let entries: Entry[] | null;
    try {
      entries = decodeArchive(ZIP_MAGIC, ctx.fs.readFile(ctx.resolve(archive)));
    } catch {
      ctx.stderr.write(`unzip:  cannot find or open ${archive}, ${archive}.zip or ${archive}.ZIP.\n`);
      return 9;
    }
    if (!entries) {
      ctx.stderr.write(`  End-of-central-directory signature not found.  Either this file is not\n  a zipfile, or it constitutes one disk of a multi-part archive.\n`);
      return 9;
    }
    ctx.stdout.write(`Archive:  ${archive}\n`);
    if (list) {
      ctx.stdout.write('  Length      Date    Time    Name\n---------  ---------- -----   ----\n');
      for (const e of entries) ctx.stdout.write(`${String(e.content?.length ?? 0).padStart(9)}  2024-11-16 09:14   ${e.path}${e.type === 'dir' ? '/' : ''}\n`);
      return 0;
    }
    const dest = dIndex !== -1 ? ctx.resolve(ctx.args[dIndex + 1]) : ctx.session.cwd;
    ctx.fs.mkdir(dest, true);
    for (const e of entries) ctx.stdout.write(`  ${e.type === 'dir' ? ' creating' : 'inflating'}: ${e.path}${e.type === 'dir' ? '/' : ''}\n`);
    return extract(ctx, entries, dest, false, false);
  },
};
