/**
 * `docker build`: interpreta un Dockerfile con su contexto, aplica la caché de
 * capas como BuildKit y calcula el tamaño de la imagen final.
 */
import type { VirtualFileSystem } from '../../vfs/VirtualFileSystem';
import { basename, joinPath, normalize } from '../../vfs/path';
import { DockerError, pullImage } from './engine';
import { hexId, parseReference, type DockerState, type Image, type ImageConfig } from './model';

const INSTRUCTIONS = new Set(['FROM', 'RUN', 'CMD', 'LABEL', 'EXPOSE', 'ENV', 'ADD', 'COPY', 'ENTRYPOINT', 'VOLUME', 'USER', 'WORKDIR', 'ARG', 'ONBUILD', 'STOPSIGNAL', 'HEALTHCHECK', 'SHELL', 'MAINTAINER']);

interface Instruction {
  keyword: string;
  args: string;
  line: number;
}

/** Une las líneas que terminan en \ y separa instrucción y argumentos. */
export function parseDockerfile(text: string): Instruction[] {
  const instructions: Instruction[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const start = i + 1;
    if (/^\s*(#|$)/.test(line)) continue;
    while (/\\\s*$/.test(line) && i + 1 < lines.length) {
      i++;
      line = line.replace(/\\\s*$/, ' ') + lines[i].replace(/^\s*#.*$/, '');
    }
    const m = /^\s*(\S+)\s*(.*)$/.exec(line);
    if (!m) continue;
    const keyword = m[1].toUpperCase();
    if (!INSTRUCTIONS.has(keyword)) throw new DockerError(`failed to solve: dockerfile parse error on line ${start}: unknown instruction: ${m[1]}`);
    instructions.push({ keyword, args: m[2].trim(), line: start });
  }
  if (!instructions.some((i) => i.keyword === 'FROM')) throw new DockerError('failed to solve: no build stage in current context');
  if (instructions[0].keyword !== 'FROM' && instructions[0].keyword !== 'ARG') throw new DockerError(`failed to solve: dockerfile parse error on line ${instructions[0].line}: FROM requires either one or three arguments`);
  return instructions;
}

/** CMD/ENTRYPOINT en forma JSON ["a","b"] o shell. */
function parseExec(args: string): string[] {
  if (args.startsWith('[')) {
    try {
      return JSON.parse(args) as string[];
    } catch {
      throw new DockerError(`failed to solve: dockerfile parse error: invalid JSON array: ${args}`);
    }
  }
  return ['/bin/sh', '-c', args];
}

/** Lee el contexto de build respetando .dockerignore. */
function readContext(fs: VirtualFileSystem, dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  let ignore: RegExp[] = [];
  try {
    ignore = fs.readFile(joinPath(dir, '.dockerignore')).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((p) => new RegExp('^' + p.replace(/^\.\//, '').replace(/\/$/, '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '(/.*)?$'));
  } catch {
    ignore = [];
  }
  const walk = (abs: string, rel: string): void => {
    for (const node of fs.readDir(abs)) {
      const childRel = rel ? `${rel}/${node.name}` : node.name;
      if (ignore.some((re) => re.test(childRel))) continue;
      if (node.type === 'dir') walk(joinPath(abs, node.name), childRel);
      else if (node.type === 'file') files[childRel] = node.content;
    }
  };
  walk(dir, '');
  return files;
}

function sizeOf(files: Record<string, string>): number {
  return Object.values(files).reduce((s, f) => s + f.length, 0) / 1_000_000;
}

/** Tamaño que añade un RUN (MB), según lo que instala. */
function runSize(command: string): number {
  let size = 0.5;
  const apt = /apt-get install[^&;]*|apk add[^&;]*/.exec(command);
  if (apt) size += apt[0].split(/\s+/).filter((w) => !w.startsWith('-') && !['apt-get', 'install', 'apk', 'add'].includes(w)).length * 22;
  if (/apt-get update/.test(command) && !/rm -rf \/var\/lib\/apt\/lists/.test(command)) size += 45;
  if (/npm (ci|install)/.test(command)) size += /--omit=dev|--production|--only=prod/.test(command) ? 45 : 160;
  if (/pip install/.test(command)) size += /--no-cache-dir/.test(command) ? 40 : 75;
  if (/npm run build/.test(command)) size += 8;
  return size;
}

interface Stage {
  name: string | null;
  base: Image;
  config: ImageConfig;
  sizeMB: number;
  layers: string[];
  files: Record<string, string>;
}

export interface BuildResult {
  image: Image;
  output: string[];
}

export function buildImage(fs: VirtualFileSystem, state: DockerState & { buildCache?: string[] }, options: { contextDir: string; dockerfile: string; tag: string; noCache: boolean; buildArgs: Record<string, string> }, now: number): BuildResult {
  let text: string;
  try {
    text = fs.readFile(options.dockerfile);
  } catch {
    throw new DockerError(`ERROR: failed to solve: failed to read dockerfile: open ${basename(options.dockerfile)}: no such file or directory`);
  }
  const instructions = parseDockerfile(text);
  const context = readContext(fs, options.contextDir);
  state.buildCache ??= [];
  const cache = new Set(state.buildCache);
  const output: string[] = [];
  const stages: Stage[] = [];
  const args: Record<string, string> = { ...options.buildArgs };
  let current: Stage | null = null;
  let chain = 'root';
  let step = 0;
  const total = instructions.filter((i) => !['ARG', 'LABEL', 'EXPOSE', 'ENV', 'CMD', 'ENTRYPOINT', 'USER', 'HEALTHCHECK', 'MAINTAINER', 'VOLUME', 'STOPSIGNAL', 'SHELL'].includes(i.keyword)).length;
  const sub = (value: string): string => value.replace(/\$\{?(\w+)\}?/g, (m, n: string) => args[n] ?? current?.config.env[n] ?? m);

  output.push(`[+] Building ${(1.2 + total * 0.9).toFixed(1)}s (${total + 3}/${total + 3}) FINISHED`);
  output.push(' => [internal] load build definition from Dockerfile', ' => [internal] load .dockerignore', ` => [internal] load build context (${Object.keys(context).length} archivos)`);

  for (const ins of instructions) {
    const label = `${current ? `[${current.name ?? 'stage-' + (stages.length - 1)} ${step + 1}/${total}]` : ''}`;
    switch (ins.keyword) {
      case 'ARG': {
        const [k, v] = ins.args.split('=');
        args[k] ??= v ?? '';
        continue;
      }
      case 'FROM': {
        const m = /^(\S+)(?:\s+AS\s+(\S+))?$/i.exec(sub(ins.args));
        if (!m) throw new DockerError(`failed to solve: dockerfile parse error on line ${ins.line}: FROM requires either one or three arguments`);
        const fromStage = stages.find((s) => s.name === m[1]);
        let base: Image;
        if (fromStage) base = { ...fromStage.base, config: structuredClone(fromStage.config), sizeMB: fromStage.sizeMB, layers: [...fromStage.layers] };
        else {
          try {
            base = pullImage(state, m[1], now);
          } catch (error) {
            throw new DockerError(`ERROR: failed to solve: ${m[1]}: failed to resolve source metadata for docker.io/library/${m[1]}: ${(error as Error).message.replace(/^Error response from daemon: /, '')}`);
          }
        }
        current = { name: m[2] ?? null, base, config: structuredClone(base.config), sizeMB: base.sizeMB, layers: [...base.layers], files: { ...base.config.files } };
        stages.push(current);
        chain = `from:${base.id}`;
        step++;
        output.push(` => [${current.name ?? 'stage-' + (stages.length - 1)} 1/${total}] FROM docker.io/library/${m[1]}`);
        continue;
      }
      default:
        break;
    }
    if (!current) throw new DockerError('failed to solve: no build stage in current context');
    const workdir = current.config.workdir || '/';
    const resolveTarget = (target: string): string => normalize(target.startsWith('/') ? target : joinPath(workdir, target));
    let layerKey = `${chain}|${ins.keyword} ${ins.args}`;
    switch (ins.keyword) {
      case 'WORKDIR':
        current.config.workdir = resolveTarget(sub(ins.args));
        break;
      case 'ENV': {
        const parts = /^(\w+)\s+(.+)$/.exec(ins.args) && !ins.args.includes('=') ? [[ins.args.split(/\s+/)[0], ins.args.split(/\s+/).slice(1).join(' ')]] : ins.args.match(/\w+=("[^"]*"|\S+)/g)?.map((p) => p.split('=')) ?? [];
        for (const [k, ...v] of parts) current.config.env[k] = sub(v.join('=').replace(/^"|"$/g, ''));
        break;
      }
      case 'EXPOSE':
        current.config.exposed.push(...ins.args.split(/\s+/).map((p) => Number(p.split('/')[0])).filter((n) => !Number.isNaN(n)));
        break;
      case 'CMD':
        current.config.cmd = parseExec(ins.args);
        break;
      case 'ENTRYPOINT':
        current.config.entrypoint = parseExec(ins.args);
        break;
      case 'USER':
        current.config.user = ins.args.split(':')[0];
        break;
      case 'LABEL':
        current.config.labels = { ...current.config.labels, ...Object.fromEntries((ins.args.match(/[\w.-]+=("[^"]*"|\S+)/g) ?? []).map((p) => [p.split('=')[0], p.split('=').slice(1).join('=').replace(/^"|"$/g, '')])) };
        break;
      case 'HEALTHCHECK':
        current.config.healthcheck = ins.args;
        break;
      case 'COPY':
      case 'ADD': {
        const parts = ins.args.split(/\s+/);
        const fromFlag = parts.find((p) => p.startsWith('--from='));
        const operands = parts.filter((p) => !p.startsWith('--'));
        const dest = operands.pop()!;
        const sources = operands;
        if (sources.length === 0) throw new DockerError(`failed to solve: dockerfile parse error on line ${ins.line}: ${ins.keyword} requires at least two arguments`);
        const sourceFiles = fromFlag ? (stages.find((s) => s.name === fromFlag.slice(7))?.files ?? null) : null;
        if (fromFlag && !sourceFiles) throw new DockerError(`failed to solve: failed to compute cache key: "${fromFlag.slice(7)}" not found`);
        let copied: Record<string, string> = {};
        for (const source of sources) {
          const src = source.replace(/^\.\//, '').replace(/\/$/, '');
          const pool = sourceFiles ?? context;
          const pattern = new RegExp('^' + (src === '.' ? '' : src.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/^\//, '')) + (src === '.' ? '.*' : '(/.*)?') + '$');
          const matches = Object.keys(pool).filter((f) => pattern.test(sourceFiles ? f.replace(/^\//, '') : f));
          if (matches.length === 0) {
            throw new DockerError(`ERROR: failed to solve: failed to compute cache key: failed to calculate checksum of ref: "/${src}": not found`);
          }
          const fromDirectory = matches.some((f) => (sourceFiles ? f.replace(/^\//, '') : f) !== src.replace(/^\//, ''));
          const destDir = dest.endsWith('/') || dest === '.' || sources.length > 1 || matches.length > 1 || src === '.' || fromDirectory;
          for (const file of matches) {
            const rel = sourceFiles ? file.replace(/^\//, '') : file;
            const relToSrc = src === '.' ? rel : rel.slice(src.length).replace(/^\//, '') || basename('/' + rel);
            const target = destDir ? resolveTarget(joinPath(dest, relToSrc)) : resolveTarget(dest);
            copied[target] = pool[file];
          }
        }
        if (!sourceFiles) copied = Object.fromEntries(Object.entries(copied));
        Object.assign(current.files, copied);
        current.sizeMB += sizeOf(copied);
        layerKey += '|' + hexId(JSON.stringify(copied), 16);
        break;
      }
      case 'RUN': {
        const command = sub(ins.args);
        if (/npm (ci|install)/.test(command) && !Object.keys(current.files).some((f) => /package\.json$/.test(f))) {
          throw new DockerError(`ERROR: failed to solve: process "/bin/sh -c ${command}" did not complete successfully: exit code: 254\nnpm ERR! enoent Could not read package.json: Error: ENOENT: no such file or directory, open '${joinPath(workdir, 'package.json')}'`);
        }
        if (/apt-get install/.test(command) && /alpine/.test(current.base.tag + current.base.repository)) {
          throw new DockerError(`ERROR: failed to solve: process "/bin/sh -c ${command}" did not complete successfully: exit code: 127\n/bin/sh: apt-get: not found   (pista: Alpine usa "apk add", no apt-get)`);
        }
        current.sizeMB += runSize(command);
        if (/npm (ci|install)/.test(command)) current.files[joinPath(workdir, 'node_modules/.package-lock.json')] = '{}';
        if (/npm run build/.test(command)) current.files[joinPath(workdir, 'dist/index.html')] = '<!doctype html><html><body><div id="root">App compilada</div></body></html>\n';
        break;
      }
      default:
        break;
    }
    if (['COPY', 'ADD', 'RUN', 'WORKDIR'].includes(ins.keyword)) {
      step++;
      const key = hexId(layerKey, 20);
      const cached = !options.noCache && cache.has(key);
      output.push(` => ${cached ? 'CACHED ' : ''}${label} ${ins.keyword} ${ins.args}`);
      cache.add(key);
      chain = key;
      current.layers.push(hexId(key, 12));
    } else {
      chain = hexId(layerKey, 20);
    }
  }

  const final = stages.at(-1)!;
  const { repository, tag } = parseReference(options.tag || `sha256:${hexId(chain, 12)}`);
  const id = hexId(chain + options.tag, 64);
  const image: Image = {
    id,
    repository: options.tag ? repository : '<none>',
    tag: options.tag ? tag : '<none>',
    sizeMB: Math.round(final.sizeMB * 10) / 10,
    created: now,
    layers: final.layers,
    config: { ...final.config, files: final.files },
  };
  // Una etiqueta reutilizada deja la imagen anterior "colgando" (<none>).
  for (const old of state.images) {
    if (old.repository === image.repository && old.tag === image.tag && old.id !== id) {
      old.repository = '<none>';
      old.tag = '<none>';
    }
  }
  state.images = state.images.filter((i) => i.id !== id);
  state.images.push(image);
  state.buildCache = [...cache].slice(-500);
  output.push(' => exporting to image', ` => => writing image sha256:${id}`, ` => => naming to docker.io/library/${image.repository}:${image.tag}`);
  return { image, output };
}
