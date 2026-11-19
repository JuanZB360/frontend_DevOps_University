/**
 * docker — cliente de Docker (run, ps, images, build, compose, volume, network...).
 */
import '../../system/docker/package';
import { groupsOf } from '../../system/accounts';
import { buildImage } from '../../system/docker/build';
import { composeContainers, composeDown, composeUp, containerName, loadCompose } from '../../system/docker/compose';
import { containerResponse, createContainer, DockerError, pullImage, readContainerFile, removeContainer, resolveContainer, startContainer, stopContainer, writeContainerFile } from '../../system/docker/engine';
import { dockerState, findContainer, findImage, hexId, parseReference, type Container, type DockerState, type Mount, type PortMapping } from '../../system/docker/model';
import { readMachine, updateMachine, type MachineState } from '../../system/machine';
import { joinPath } from '../../vfs/path';
import type { Command, CommandContext } from '../Command';
import { fail } from '../helpers';

/** Hook para que otros módulos (bases de datos) añadan programas dentro de los contenedores. */
export type ContainerProgram = (ctx: CommandContext, state: DockerState, container: Container, argv: string[], machine: MachineState) => number | null;
const containerPrograms: ContainerProgram[] = [];
export function registerContainerProgram(program: ContainerProgram): void {
  containerPrograms.push(program);
}

function ago(ms: number, now: number): string {
  const s = Math.max(1, Math.round((now - ms) / 1000));
  if (s < 60) return `${s} seconds ago`;
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} hours ago`;
  return `${Math.round(s / 86_400)} days ago`;
}

function uptime(ms: number, now: number): string {
  const s = Math.max(1, Math.round((now - ms) / 1000));
  if (s < 60) return `${s} seconds`;
  if (s < 3600) return `${Math.round(s / 60)} minutes`;
  return `${Math.round(s / 3600)} hours`;
}

function size(mb: number): string {
  if (mb < 1) return `${Math.round(mb * 1000)}kB`;
  if (mb >= 1000) return `${(mb / 1000).toFixed(2)}GB`;
  return `${Math.round(mb * 10) / 10}MB`;
}

function table(ctx: CommandContext, header: string[], rows: string[][]): void {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)) + 3);
  ctx.stdout.write(header.map((h, i) => (i === header.length - 1 ? h : h.padEnd(widths[i]))).join('') + '\n');
  for (const row of rows) ctx.stdout.write(row.map((c, i) => (i === row.length - 1 ? c : c.padEnd(widths[i]))).join('') + '\n');
}

function statusText(c: Container, now: number): string {
  if (c.status === 'running') return `Up ${uptime(c.started, now)}${c.health ? ` (${c.health})` : ''}`;
  if (c.status === 'created') return 'Created';
  if (c.status === 'paused') return `Up ${uptime(c.started, now)} (Paused)`;
  return `Exited (${c.exitCode}) ${ago(c.started || c.created, now)}`;
}

function portsText(c: Container): string {
  return c.ports.map((p) => `0.0.0.0:${p.host}->${p.container}/tcp`).join(', ');
}

/** Valor de una plantilla Go sencilla: {{.State.Status}}, {{json .Mounts}}... */
function goTemplate(template: string, data: unknown): string {
  return template.replace(/\{\{\s*(json\s+)?\.([\w.]+)\s*\}\}/g, (_m, json: string | undefined, path: string) => {
    let value: unknown = data;
    for (const key of path.split('.')) value = (value as Record<string, unknown> | undefined)?.[key];
    if (json) return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.join(' ')}]`;
    if (value && typeof value === 'object') return `map[${Object.entries(value).map(([k, v]) => `${k}:${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' ')}]`;
    return String(value ?? '<no value>');
  }).replace(/\\n/g, '\n');
}

function inspectContainer(c: Container): Record<string, unknown> {
  return {
    Id: c.id,
    Created: new Date(c.created).toISOString(),
    Name: `/${c.name}`,
    Image: c.image,
    State: { Status: c.status, Running: c.status === 'running', ExitCode: c.exitCode, Health: c.health ? { Status: c.health } : undefined },
    Config: { Env: Object.entries(c.env).map(([k, v]) => `${k}=${v}`), Cmd: c.cmd, User: c.user },
    HostConfig: { RestartPolicy: { Name: c.restart }, ReadonlyRootfs: c.readOnly, Memory: (c.memoryMB ?? 0) * 1024 * 1024, PortBindings: Object.fromEntries(c.ports.map((p) => [`${p.container}/tcp`, [{ HostIp: '', HostPort: String(p.host) }]])) },
    Mounts: c.mounts.map((m) => ({ Type: m.type, Source: m.type === 'volume' ? `/var/lib/docker/volumes/${m.source}/_data` : m.source, Name: m.type === 'volume' ? m.source : undefined, Destination: m.target, RW: !m.readOnly })),
    NetworkSettings: { IPAddress: c.networks.includes('bridge') ? `172.17.0.${2 + (parseInt(c.id.slice(0, 2), 16) % 200)}` : '', Networks: Object.fromEntries(c.networks.map((n) => [n, { IPAddress: `172.18.0.${2 + (parseInt(c.id.slice(2, 4), 16) % 200)}` }])) },
  };
}

interface Parsed {
  flags: Map<string, string[]>;
  positional: string[];
}

/** Parser de opciones de docker: las que llevan valor se indican en `withValue`. */
function parseArgs(args: string[], withValue: string[], stopAtFirstPositional = false): Parsed {
  const flags = new Map<string, string[]>();
  const positional: string[] = [];
  const add = (k: string, v: string): void => {
    flags.set(k, [...(flags.get(k) ?? []), v]);
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (stopAtFirstPositional && positional.length > 0) {
      positional.push(arg);
      continue;
    }
    if (arg.startsWith('--')) {
      const [name, value] = arg.slice(2).split(/=(.*)/s);
      if (value !== undefined) add(name, value);
      else if (withValue.includes(name)) add(name, args[++i] ?? '');
      else add(name, 'true');
    } else if (arg.startsWith('-') && arg.length > 1) {
      const letters = arg.slice(1);
      for (let j = 0; j < letters.length; j++) {
        const l = letters[j];
        if (withValue.includes(l)) {
          add(l, letters.slice(j + 1) || args[++i] || '');
          break;
        }
        add(l, 'true');
      }
    } else positional.push(arg);
  }
  return { flags, positional };
}

const DAEMON_DOWN = 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?\n';

function checkAccess(ctx: CommandContext, machine: MachineState): string | null {
  if (!machine.services.docker?.active) return DAEMON_DOWN;
  const user = ctx.session.username;
  if (user !== 'root' && !ctx.session.userGroups.includes('docker') && !groupsOf(ctx.fs, user).includes('docker')) {
    return 'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock: Get "http://%2Fvar%2Frun%2Fdocker.sock/v1.47/containers/json": dial unix /var/run/docker.sock: connect: permission denied\n';
  }
  if (user !== 'root' && !ctx.session.userGroups.includes('docker')) {
    return 'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock\n\x1b[2m(ya estás en el grupo docker, pero tu sesión no lo sabe: ejecuta newgrp docker o vuelve a iniciar sesión)\x1b[0m\n';
  }
  return null;
}

function parseMounts(ctx: CommandContext, values: string[]): Mount[] {
  return values.map((v) => {
    const [source, target, mode] = v.split(':');
    if (!target) throw new DockerError(`docker: invalid volume specification: '${v}'`);
    const bind = source.startsWith('/') || source.startsWith('.') || source.startsWith('~');
    return { type: bind ? 'bind' : 'volume', source: bind ? ctx.resolve(source) : source, target, readOnly: mode === 'ro' };
  });
}

function parsePorts(values: string[]): PortMapping[] {
  return values.map((v) => {
    const m = /^(?:[\d.]+:)?(\d+):(\d+)(?:\/\w+)?$/.exec(v);
    if (!m) throw new DockerError(`docker: invalid publish opts format (should be name=value but got '${v}')`);
    return { host: Number(m[1]), container: Number(m[2]) };
  });
}

/** Ejecuta un comando dentro de un contenedor (docker exec). */
function execInContainer(ctx: CommandContext, machine: MachineState, container: Container, argv: string[]): number {
  const state = dockerState(machine);
  if (container.status !== 'running') {
    ctx.stderr.write(`Error response from daemon: container ${container.id} is not running\n`);
    return 1;
  }
  for (const program of containerPrograms) {
    const code = program(ctx, state, container, argv, machine);
    if (code !== null) return code;
  }
  let [program, ...args] = argv;
  if ((program === 'sh' || program === 'bash' || program === '/bin/sh' || program === '/bin/bash') && args[0] === '-c') {
    const script = args.slice(1).join(' ');
    let code = 0;
    for (const part of script.split(/\s*(?:&&|;)\s*/)) code = execInContainer(ctx, machine, container, part.match(/"[^"]*"|'[^']*'|\S+/g)?.map((t) => t.replace(/^["']|["']$/g, '')) ?? []);
    return code;
  }
  if (program === 'sh' || program === 'bash' || program === '/bin/sh' || program === '/bin/bash') {
    ctx.stdout.write(`\x1b[2m(shell interactiva dentro de ${container.name}: en el simulador ejecuta cada comando con docker exec ${container.name} COMANDO)\x1b[0m\n`);
    return 0;
  }
  const redirect = args.indexOf('>');
  if (redirect !== -1 && program === 'echo') {
    const error = writeContainerFile(ctx.fs, state, container, args[redirect + 1], args.slice(0, redirect).join(' ') + '\n');
    if (error) ctx.stderr.write(`sh: ${error}\n`);
    return error ? 1 : 0;
  }
  switch (program) {
    case 'echo': ctx.stdout.write(args.join(' ') + '\n'); return 0;
    case 'hostname': ctx.stdout.write(container.id.slice(0, 12) + '\n'); return 0;
    case 'whoami': ctx.stdout.write((container.user || 'root') + '\n'); return 0;
    case 'id': ctx.stdout.write(container.user && container.user !== 'root' ? `uid=1000(${container.user}) gid=1000(${container.user}) groups=1000(${container.user})\n` : 'uid=0(root) gid=0(root) groups=0(root)\n'); return 0;
    case 'env': case 'printenv':
      for (const [k, v] of Object.entries(container.env)) if (!args[0] || args[0] === k) ctx.stdout.write(args[0] ? `${v}\n` : `${k}=${v}\n`);
      return 0;
    case 'cat': {
      let code = 0;
      for (const file of args) {
        const content = readContainerFile(ctx.fs, state, container, file);
        if (content === null) {
          ctx.stderr.write(`cat: ${file}: No such file or directory\n`);
          code = 1;
        } else ctx.stdout.write(content);
      }
      return code;
    }
    case 'ls': {
      const dir = (args.find((a) => !a.startsWith('-')) ?? container.env.PWD ?? '/').replace(/\/$/, '') || '/';
      const image = state.images.find((i) => i.id === container.imageId);
      const all = { ...(image?.config.files ?? {}), ...container.writes };
      for (const m of container.mounts) {
        if (m.type === 'volume') for (const f of Object.keys(state.volumes[m.source]?.data ?? {})) all[joinPath(m.target, f)] = '';
        else if (ctx.fs.isDirectory(m.source)) for (const n of ctx.fs.readDir(m.source)) all[joinPath(m.target, n.name)] = '';
      }
      const names = new Set(Object.keys(all).filter((f) => f.startsWith(dir === '/' ? '/' : dir + '/')).map((f) => f.slice(dir === '/' ? 1 : dir.length + 1).split('/')[0]));
      if (dir === '/') for (const d of ['bin', 'etc', 'home', 'lib', 'proc', 'root', 'tmp', 'usr', 'var']) names.add(d);
      ctx.stdout.write([...names].sort().join('\n') + (names.size ? '\n' : ''));
      return 0;
    }
    case 'touch': {
      for (const file of args) {
        const error = writeContainerFile(ctx.fs, state, container, file, readContainerFile(ctx.fs, state, container, file) ?? '');
        if (error) {
          ctx.stderr.write(`touch: ${error}\n`);
          return 1;
        }
      }
      return 0;
    }
    case 'ps': ctx.stdout.write(`PID   USER     TIME  COMMAND\n    1 ${(container.user || 'root').padEnd(8)}  0:00 ${container.cmd.join(' ')}\n   42 ${(container.user || 'root').padEnd(8)}  0:00 ${argv.join(' ')}\n`); return 0;
    case 'curl': case 'wget': {
      const url = args.find((a) => !a.startsWith('-') && (/^https?:\/\//.test(a) || /^[\w.-]+(:\d+)?(\/|$)/.test(a))) ?? '';
      const m = /^(?:https?:\/\/)?([^/:]+)(?::(\d+))?(\/.*)?$/.exec(url);
      if (!m) return fail(ctx, 'no URL specified', 2);
      const target = m[1] === 'localhost' ? container : resolveContainer(state, container, m[1]);
      if (!target) {
        ctx.stderr.write(`${program}: (6) Could not resolve host: ${m[1]}\n\x1b[2m(los contenedores solo se encuentran por nombre dentro de una red creada por ti o por compose)\x1b[0m\n`);
        return 6;
      }
      const response = containerResponse(ctx.fs, machine, target, { method: 'GET', host: m[1], port: Number(m[2] ?? 80), path: m[3] ?? '/', headers: {}, body: '', https: false }, Number(m[2] ?? 80));
      if ('error' in response) {
        ctx.stderr.write(`curl: (7) ${response.message}\n`);
        return 7;
      }
      ctx.stdout.write(response.body);
      return 0;
    }
    case 'nginx': {
      if (args.includes('-t')) {
        ctx.stderr.write('nginx: the configuration file /etc/nginx/nginx.conf syntax is ok\nnginx: configuration file /etc/nginx/nginx.conf test is successful\n');
        return 0;
      }
      if (args.includes('-s')) return 0;
      break;
    }
    case 'apt-get': case 'apt': case 'apk':
      ctx.stdout.write(`\x1b[2m(instalar software dentro de un contenedor en marcha funciona, pero se pierde al recrearlo: hazlo en el Dockerfile)\x1b[0m\n`);
      return 0;
    case 'exit': return Number(args[0] ?? 0);
    default:
      break;
  }
  ctx.stderr.write(`OCI runtime exec failed: exec failed: unable to start container process: exec: "${program}": executable file not found in $PATH: unknown\n`);
  return 127;
}

export const dockerCommand: Command = {
  name: 'docker',
  category: 'devops',
  summary: 'Gestiona contenedores, imágenes, volúmenes, redes y proyectos compose',
  package: 'docker.io',
  execute(ctx) {
    const [sub, ...rest] = ctx.args;
    if (!sub || sub === '--help' || sub === 'help') {
      ctx.stdout.write('Usage:  docker [OPTIONS] COMMAND\n\nCommon Commands:\n  run         Create and run a new container from an image\n  exec        Execute a command in a running container\n  ps          List containers\n  build       Build an image from a Dockerfile\n  pull        Download an image from a registry\n  push        Upload an image to a registry\n  images      List images\n  login       Log in to a registry\n  compose     Docker Compose\n\nManagement Commands:\n  container, image, network, volume, system\n');
      return 0;
    }
    if (sub === '--version' || sub === '-v') {
      ctx.stdout.write('Docker version 27.3.1, build ce12230\n');
      return 0;
    }
    const machineNow = readMachine(ctx.fs);
    const denied = checkAccess(ctx, machineNow);
    if (denied) {
      ctx.stderr.write(denied);
      return 1;
    }
    let exitCode = 0;
    const out = (line: string): void => ctx.stdout.write(line + '\n');
    const err = (line: string): void => ctx.stderr.write(line + '\n');
    try {
      updateMachine(ctx.fs, (machine) => {
        exitCode = dispatch(ctx, machine, sub, rest, out, err);
      });
    } catch (error) {
      if (!(error instanceof DockerError)) throw error;
      ctx.stderr.write(error.message + '\n');
      return error.message.startsWith('docker: ') ? 125 : 1;
    }
    return exitCode;
  },
};

function dispatch(ctx: CommandContext, machine: MachineState, sub: string, rest: string[], out: (l: string) => void, err: (l: string) => void): number {
  const state = dockerState(machine);
  const now = ctx.fs.now();
  // Comandos de gestión: docker container ls, docker image rm...
  if (sub === 'container' || sub === 'image') {
    const [action, ...more] = rest;
    const map: Record<string, string> = { ls: sub === 'container' ? 'ps' : 'images', list: sub === 'container' ? 'ps' : 'images', rm: sub === 'container' ? 'rm' : 'rmi', prune: `${sub}-prune`, inspect: 'inspect', history: 'history', build: 'build', pull: 'pull', push: 'push', tag: 'tag', start: 'start', stop: 'stop', restart: 'restart', logs: 'logs', exec: 'exec', run: 'run' };
    if (!action || !map[action]) {
      err(`docker: '${sub} ${action ?? ''}' is not a docker command.`);
      return 1;
    }
    return dispatch(ctx, machine, map[action], more, out, err);
  }
  switch (sub) {
    case 'version':
      out('Client: Docker Engine - Community\n Version:           27.3.1\n API version:       1.47\n Go version:        go1.22.7\n\nServer: Docker Engine - Community\n Engine:\n  Version:          27.3.1\n  API version:      1.47 (minimum version 1.24)\n containerd:\n  Version:          1.7.22');
      return 0;
    case 'info': {
      const running = state.containers.filter((c) => c.status === 'running').length;
      out(`Containers: ${state.containers.length}\n Running: ${running}\n Paused: 0\n Stopped: ${state.containers.length - running}\nImages: ${state.images.length}\nServer Version: 27.3.1\nStorage Driver: overlay2\nLogging Driver: json-file\nCgroup Driver: systemd\nKernel Version: 6.8.0-devops\nOperating System: Ubuntu 24.04 LTS\nCPUs: 2\nTotal Memory: 3.824GiB\nDocker Root Dir: /var/lib/docker`);
      return 0;
    }
    case 'pull': {
      const ref = rest.find((a) => !a.startsWith('-'));
      if (!ref) {
        err('"docker pull" requires exactly 1 argument.');
        return 1;
      }
      if (findImage(state, ref)) {
        const { repository, tag } = parseReference(ref);
        out(`${tag}: Pulling from library/${repository}\nDigest: sha256:${hexId(ref + 'digest')}\nStatus: Image is up to date for ${repository}:${tag}\ndocker.io/library/${repository}:${tag}`);
        return 0;
      }
      pullImage(state, ref, now, out);
      return 0;
    }
    case 'images': {
      const p = parseArgs(rest, ['filter', 'format']);
      const quiet = p.flags.has('q');
      const dangling = p.flags.get('filter')?.includes('dangling=true');
      let images = state.images;
      if (dangling) images = images.filter((i) => i.repository === '<none>');
      if (p.positional[0]) images = images.filter((i) => i.repository === p.positional[0]);
      if (quiet) {
        for (const i of images) out(i.id.slice(0, 12));
        return 0;
      }
      table(ctx, ['REPOSITORY', 'TAG', 'IMAGE ID', 'CREATED', 'SIZE'], images.map((i) => [i.repository, i.tag, i.id.slice(0, 12), ago(i.created, now), size(i.sizeMB)]));
      return 0;
    }
    case 'history': {
      const image = findImage(state, rest[0] ?? '');
      if (!image) {
        err(`Error response from daemon: No such image: ${rest[0] ?? ''}`);
        return 1;
      }
      table(ctx, ['IMAGE', 'CREATED', 'CREATED BY', 'SIZE'], image.layers.map((l, i) => [i === image.layers.length - 1 ? image.id.slice(0, 12) : '<missing>', ago(image.created, now), `/bin/sh -c #(nop) capa ${l}`, size(image.sizeMB / image.layers.length)]).reverse());
      return 0;
    }
    case 'run':
      return runCommand(ctx, machine, state, rest, out, err);
    case 'create': {
      const result = runCommand(ctx, machine, state, ['--__create', ...rest], out, err);
      return result;
    }
    case 'ps': {
      const p = parseArgs(rest, ['filter', 'format', 'f']);
      const all = p.flags.has('a') || p.flags.has('all');
      const list = state.containers.filter((c) => all || c.status === 'running' || c.status === 'paused');
      if (p.flags.has('q')) {
        for (const c of list) out(c.id.slice(0, 12));
        return 0;
      }
      const format = p.flags.get('format')?.[0];
      if (format) {
        for (const c of list) out(goTemplate(format.replace(/\.Names/g, '.Name').replace(/\.ID/g, '.Id').replace(/\.Status/g, '.StatusText'), { ...inspectContainer(c), Name: c.name, Id: c.id.slice(0, 12), StatusText: statusText(c, now), Image: c.image, Ports: portsText(c) }));
        return 0;
      }
      table(ctx, ['CONTAINER ID', 'IMAGE', 'COMMAND', 'CREATED', 'STATUS', 'PORTS', 'NAMES'], list.map((c) => [c.id.slice(0, 12), c.image, `"${c.cmd.join(' ').slice(0, 20)}${c.cmd.join(' ').length > 20 ? '…' : ''}"`, ago(c.created, now), statusText(c, now), portsText(c), c.name]));
      return 0;
    }
    case 'start': case 'stop': case 'restart': case 'kill': case 'pause': case 'unpause': {
      const names = rest.filter((a) => !a.startsWith('-') && !/^\d+$/.test(a));
      if (names.length === 0) {
        err(`"docker ${sub}" requires at least 1 argument.`);
        return 1;
      }
      let code = 0;
      for (const name of names) {
        const c = findContainer(state, name);
        if (!c) {
          err(`Error response from daemon: No such container: ${name}`);
          code = 1;
          continue;
        }
        if (sub === 'stop' || sub === 'kill') stopContainer(machine, c, sub === 'kill' ? 137 : 0);
        else if (sub === 'pause') c.status = 'paused';
        else if (sub === 'unpause') c.status = 'running';
        else {
          if (sub === 'restart') stopContainer(machine, c);
          if (c.status !== 'running') startContainer(ctx.fs, machine, c);
        }
        out(name);
      }
      return code;
    }
    case 'rm': {
      const p = parseArgs(rest, []);
      const force = p.flags.has('f') || p.flags.has('force');
      let code = 0;
      for (const name of p.positional) {
        const c = findContainer(state, name);
        if (!c) {
          err(`Error response from daemon: No such container: ${name}`);
          code = 1;
          continue;
        }
        if (c.status === 'running' && !force) {
          err(`Error response from daemon: cannot remove container "/${c.name}": container is running: stop the container before removing or force remove`);
          code = 1;
          continue;
        }
        removeContainer(machine, c, p.flags.has('v'));
        out(name);
      }
      return code;
    }
    case 'rmi': {
      const p = parseArgs(rest, []);
      let code = 0;
      for (const ref of p.positional) {
        const image = findImage(state, ref);
        if (!image) {
          err(`Error response from daemon: No such image: ${ref}`);
          code = 1;
          continue;
        }
        const user = state.containers.find((c) => c.imageId === image.id);
        if (user && !p.flags.has('f')) {
          err(`Error response from daemon: conflict: unable to remove repository reference "${ref}" (must force) - container ${user.id.slice(0, 12)} is using its referenced image ${image.id.slice(0, 12)}`);
          code = 1;
          continue;
        }
        state.images = state.images.filter((i) => i !== image);
        out(`Untagged: ${image.repository}:${image.tag}\nDeleted: sha256:${image.id}`);
      }
      return code;
    }
    case 'logs': {
      const p = parseArgs(rest, ['tail', 'n', 'since']);
      const c = findContainer(state, p.positional[0] ?? '');
      if (!c) {
        err(`Error response from daemon: No such container: ${p.positional[0] ?? ''}`);
        return 1;
      }
      const tail = Number(p.flags.get('tail')?.[0] ?? p.flags.get('n')?.[0] ?? Infinity);
      const lines = c.logs.flatMap((l) => l.split('\n'));
      ctx.stdout.write(lines.slice(Number.isFinite(tail) ? -tail : 0).join('\n') + (lines.length ? '\n' : ''));
      if (p.flags.has('f') && ctx.stdout.isTTY) err('\x1b[2m(-f sigue los logs en directo; en el simulador se muestran los actuales)\x1b[0m');
      return 0;
    }
    case 'exec': {
      const p = parseArgs(rest, ['u', 'user', 'w', 'workdir', 'e', 'env'], true);
      const [name, ...argv] = p.positional;
      const c = findContainer(state, name ?? '');
      if (!c) {
        err(`Error response from daemon: No such container: ${name ?? ''}`);
        return 1;
      }
      if (argv.length === 0) {
        err('"docker exec" requires at least 2 arguments.');
        return 1;
      }
      return execInContainer(ctx, machine, c, argv);
    }
    case 'inspect': {
      const p = parseArgs(rest, ['format', 'f', 'type']);
      const format = p.flags.get('format')?.[0] ?? p.flags.get('f')?.[0];
      const results: unknown[] = [];
      for (const ref of p.positional) {
        const c = findContainer(state, ref);
        const image = c ? undefined : findImage(state, ref);
        const volume = state.volumes[ref];
        const network = state.networks[ref];
        const data = c ? inspectContainer(c) : image ? { Id: `sha256:${image.id}`, RepoTags: [`${image.repository}:${image.tag}`], Size: Math.round(image.sizeMB * 1_000_000), Config: { Cmd: image.config.cmd, Entrypoint: image.config.entrypoint, Env: Object.entries(image.config.env).map(([k, v]) => `${k}=${v}`), ExposedPorts: Object.fromEntries(image.config.exposed.map((p2) => [`${p2}/tcp`, {}])), User: image.config.user, WorkingDir: image.config.workdir }, RootFS: { Layers: image.layers } }
          : volume ? { Name: ref, Driver: volume.driver, Mountpoint: `/var/lib/docker/volumes/${ref}/_data`, CreatedAt: new Date(volume.created).toISOString() }
          : network ? { Name: ref, Driver: network.driver, IPAM: { Config: [{ Subnet: network.subnet }] }, Containers: Object.fromEntries(state.containers.filter((x) => x.networks.includes(ref)).map((x) => [x.id, { Name: x.name }])) } : null;
        if (!data) {
          err(`Error: No such object: ${ref}`);
          return 1;
        }
        results.push(data);
      }
      if (format) for (const r of results) out(goTemplate(format, r));
      else out(JSON.stringify(results, null, 4));
      return 0;
    }
    case 'port': {
      const c = findContainer(state, rest[0] ?? '');
      if (!c) {
        err(`Error: No such container: ${rest[0] ?? ''}`);
        return 1;
      }
      for (const p of c.ports) out(`${p.container}/tcp -> 0.0.0.0:${p.host}`);
      return 0;
    }
    case 'stats': {
      table(ctx, ['CONTAINER ID', 'NAME', 'CPU %', 'MEM USAGE / LIMIT', 'MEM %', 'NET I/O', 'BLOCK I/O', 'PIDS'], state.containers.filter((c) => c.status === 'running').map((c) => {
        const image = state.images.find((i) => i.id === c.imageId);
        const used = Math.round((image?.sizeMB ?? 50) * 0.08 + 6);
        const limit = c.memoryMB ?? 3916;
        return [c.id.slice(0, 12), c.name, `${(Math.random() * 2).toFixed(2)}%`, `${used}MiB / ${limit >= 1024 ? (limit / 1024).toFixed(2) + 'GiB' : limit + 'MiB'}`, `${((used / limit) * 100).toFixed(2)}%`, '1.2kB / 0B', '0B / 0B', '3'];
      }));
      return 0;
    }
    case 'top': {
      const c = findContainer(state, rest[0] ?? '');
      if (!c || c.status !== 'running') {
        err(`Error response from daemon: container ${rest[0] ?? ''} is not running`);
        return 1;
      }
      table(ctx, ['UID', 'PID', 'PPID', 'C', 'STIME', 'TTY', 'TIME', 'CMD'], [[c.user || 'root', String(40_000 + parseInt(c.id.slice(0, 3), 16)), '39900', '0', '09:14', '?', '00:00:00', c.cmd.join(' ')]]);
      return 0;
    }
    case 'cp': {
      const [src, dest] = rest;
      if (!src || !dest) {
        err('"docker cp" requires exactly 2 arguments.');
        return 1;
      }
      if (src.includes(':')) {
        const [name, path] = src.split(':');
        const c = findContainer(state, name);
        const content = c ? readContainerFile(ctx.fs, state, c, path) : null;
        if (content === null) {
          err(`Error response from daemon: Could not find the file ${path} in container ${name}`);
          return 1;
        }
        const target = ctx.fs.isDirectory(ctx.resolve(dest)) ? joinPath(ctx.resolve(dest), path.split('/').at(-1)!) : ctx.resolve(dest);
        ctx.fs.writeFile(target, content);
        out(`Successfully copied ${content.length}B to ${dest}`);
        return 0;
      }
      const [name, path] = dest.split(':');
      const c = findContainer(state, name);
      if (!c) {
        err(`Error response from daemon: No such container: ${name}`);
        return 1;
      }
      const content = ctx.fs.readFile(ctx.resolve(src));
      const target = path.endsWith('/') ? path + src.split('/').at(-1) : path;
      const error = writeContainerFile(ctx.fs, state, c, target, content);
      if (error) {
        err(`Error response from daemon: ${error}`);
        return 1;
      }
      out(`Successfully copied ${content.length}B to ${name}:${target}`);
      return 0;
    }
    case 'volume': return volumeCommand(ctx, machine, state, rest, out, err);
    case 'network': return networkCommand(ctx, state, rest, out, err);
    case 'build': return buildCommand(ctx, state, rest, out, err);
    case 'tag': {
      const [source, target] = rest;
      const image = findImage(state, source ?? '');
      if (!image || !target) {
        err(`Error response from daemon: No such image: ${source ?? ''}`);
        return 1;
      }
      const { repository, tag } = parseReference(target);
      state.images.push({ ...image, repository, tag });
      return 0;
    }
    case 'login': {
      const p = parseArgs(rest, ['u', 'username', 'p', 'password']);
      const registry = p.positional[0] ?? 'docker.io';
      const user = p.flags.get('u')?.[0] ?? p.flags.get('username')?.[0];
      const password = p.flags.get('p')?.[0] ?? p.flags.get('password')?.[0] ?? (p.flags.has('password-stdin') ? (ctx.stdin ?? '').trim() : undefined);
      if (registry !== 'localhost:5000' && (!user || !password)) {
        err('Error: Cannot perform an interactive login from a non TTY device\n\x1b[2m(usa: echo "$TOKEN" | docker login -u usuario --password-stdin)\x1b[0m');
        return 1;
      }
      if (!state.logins.includes(registry)) state.logins.push(registry);
      if (p.flags.has('p')) err('WARNING! Using --password via the CLI is insecure. Use --password-stdin.');
      out('Login Succeeded');
      return 0;
    }
    case 'logout': {
      const registry = rest[0] ?? 'docker.io';
      state.logins = state.logins.filter((l) => l !== registry);
      out(`Removing login credentials for ${registry === 'docker.io' ? 'https://index.docker.io/v1/' : registry}`);
      return 0;
    }
    case 'push': {
      const ref = rest.find((a) => !a.startsWith('-')) ?? '';
      const image = findImage(state, ref);
      if (!image) {
        err(`An image does not exist locally with the tag: ${ref}`);
        return 1;
      }
      const registry = /^([\w.-]+(:\d+)?)\//.exec(image.repository)?.[1]?.includes('.') || /^localhost/.test(image.repository) ? image.repository.split('/')[0] : 'docker.io';
      if (registry === 'localhost:5000') {
        const registryUp = state.containers.some((c) => c.status === 'running' && c.ports.some((p) => p.host === 5000) && state.images.find((i) => i.id === c.imageId)?.config.kind === 'registry');
        if (!registryUp) {
          err(`The push refers to repository [${image.repository}]\nGet "http://localhost:5000/v2/": dial tcp 127.0.0.1:5000: connect: connection refused`);
          return 1;
        }
      } else if (!state.logins.includes('docker.io')) {
        err(`The push refers to repository [docker.io/${image.repository}]\npush access denied, repository does not exist or may require authorization: server message: insufficient_scope: authorization failed`);
        return 1;
      }
      out(`The push refers to repository [${registry === 'docker.io' ? 'docker.io/' : ''}${image.repository}]`);
      for (const l of image.layers.slice(-4)) out(`${l}: Pushed`);
      out(`${image.tag}: digest: sha256:${hexId(image.id + 'push')} size: 1786`);
      const short = image.repository.replace(/^localhost:5000\//, '');
      state.pushed[registry] = [...new Set([...(state.pushed[registry] ?? []), `${short}:${image.tag}`])];
      return 0;
    }
    case 'system': {
      const [action] = rest;
      if (action === 'df') {
        const running = new Set(state.containers.map((c) => c.imageId));
        const total = state.images.reduce((s, i) => s + i.sizeMB, 0);
        const reclaim = state.images.filter((i) => !running.has(i.id)).reduce((s, i) => s + i.sizeMB, 0);
        table(ctx, ['TYPE', 'TOTAL', 'ACTIVE', 'SIZE', 'RECLAIMABLE'], [
          ['Images', String(state.images.length), String(running.size), size(total), `${size(reclaim)} (${total ? Math.round((reclaim / total) * 100) : 0}%)`],
          ['Containers', String(state.containers.length), String(state.containers.filter((c) => c.status === 'running').length), '0B', '0B'],
          ['Local Volumes', String(Object.keys(state.volumes).length), String(Object.keys(state.volumes).filter((v) => state.containers.some((c) => c.mounts.some((m) => m.source === v))).length), '64MB', '0B'],
          ['Build Cache', '12', '0', '45MB', '45MB'],
        ]);
        return 0;
      }
      if (action === 'prune') {
        const p = parseArgs(rest.slice(1), []);
        const stopped = state.containers.filter((c) => c.status !== 'running');
        for (const c of stopped) removeContainer(machine, c);
        const used = new Set(state.containers.map((c) => c.imageId));
        const removable = state.images.filter((i) => (p.flags.has('a') || p.flags.has('all') ? !used.has(i.id) : i.repository === '<none>'));
        state.images = state.images.filter((i) => !removable.includes(i));
        if (p.flags.has('volumes')) {
          for (const v of Object.keys(state.volumes)) if (!state.containers.some((c) => c.mounts.some((m) => m.source === v))) delete state.volumes[v];
        }
        out(`Deleted Containers:\n${stopped.map((c) => c.id).join('\n')}\n\nDeleted Images:\n${removable.map((i) => `deleted: sha256:${i.id}`).join('\n')}\n\nTotal reclaimed space: ${size(removable.reduce((s, i) => s + i.sizeMB, 0))}`);
        return 0;
      }
      err(`docker: 'system ${action ?? ''}' is not a docker command.`);
      return 1;
    }
    case 'container-prune': {
      const stopped = state.containers.filter((c) => c.status !== 'running');
      for (const c of stopped) removeContainer(machine, c);
      out(`Deleted Containers:\n${stopped.map((c) => c.id).join('\n')}\n\nTotal reclaimed space: 0B`);
      return 0;
    }
    case 'image-prune': {
      const p = parseArgs(rest, []);
      const used = new Set(state.containers.map((c) => c.imageId));
      const removable = state.images.filter((i) => (p.flags.has('a') || p.flags.has('all') ? !used.has(i.id) : i.repository === '<none>'));
      state.images = state.images.filter((i) => !removable.includes(i));
      out(`Deleted Images:\n${removable.map((i) => `deleted: sha256:${i.id}`).join('\n')}\n\nTotal reclaimed space: ${size(removable.reduce((s, i) => s + i.sizeMB, 0))}`);
      return 0;
    }
    case 'compose': return composeCommand(ctx, machine, state, rest, out, err);
    default:
      err(`docker: '${sub}' is not a docker command.\nSee 'docker --help'`);
      return 1;
  }
}

function runCommand(ctx: CommandContext, machine: MachineState, _state: DockerState, args: string[], out: (l: string) => void, err: (l: string) => void): number {
  const createOnly = args[0] === '--__create';
  const p = parseArgs(createOnly ? args.slice(1) : args, ['p', 'publish', 'e', 'env', 'v', 'volume', 'name', 'network', 'net', 'restart', 'u', 'user', 'm', 'memory', 'w', 'workdir', 'env-file', 'entrypoint', 'mount', 'cpus', 'cap-drop', 'cap-add', 'h', 'hostname', 'label', 'l'], true);
  const [image, ...cmd] = p.positional;
  if (!image) {
    err('"docker run" requires at least 1 argument.\nSee \'docker run --help\'.');
    return 125;
  }
  const env: Record<string, string> = {};
  for (const file of p.flags.get('env-file') ?? []) {
    for (const line of ctx.fs.readFile(ctx.resolve(file)).split('\n')) {
      const m = /^\s*([A-Za-z_]\w*)=(.*)$/.exec(line);
      if (m) env[m[1]] = m[2];
    }
  }
  for (const e of [...(p.flags.get('e') ?? []), ...(p.flags.get('env') ?? [])]) {
    const [k, ...v] = e.split('=');
    env[k] = v.length ? v.join('=') : ctx.session.getVar(k) ?? '';
  }
  const memory = p.flags.get('m')?.[0] ?? p.flags.get('memory')?.[0];
  const container = createContainer(ctx.fs, machine, {
    image,
    name: p.flags.get('name')?.[0],
    detach: p.flags.has('d') || p.flags.has('detach'),
    interactive: p.flags.has('i') || p.flags.has('t'),
    ports: parsePorts([...(p.flags.get('p') ?? []), ...(p.flags.get('publish') ?? [])]),
    env,
    mounts: parseMounts(ctx, [...(p.flags.get('v') ?? []), ...(p.flags.get('volume') ?? [])]),
    networks: [...(p.flags.get('network') ?? []), ...(p.flags.get('net') ?? [])],
    cmd,
    restart: p.flags.get('restart')?.[0] ?? 'no',
    remove: p.flags.has('rm'),
    user: p.flags.get('u')?.[0] ?? p.flags.get('user')?.[0],
    readOnly: p.flags.has('read-only'),
    memoryMB: memory ? Number(/(\d+)/.exec(memory)?.[1] ?? 0) * (/g/i.test(memory) ? 1024 : 1) : null,
  }, (l) => err(l));
  if (createOnly) {
    out(container.id);
    return 0;
  }
  startContainer(ctx.fs, machine, container);
  const detached = p.flags.has('d') || p.flags.has('detach');
  if (detached) out(container.id);
  else {
    for (const line of container.logs) out(line);
    if (container.status === 'running') {
      const interactiveShell = (p.flags.has('i') || p.flags.has('t')) && /sh$/.test(container.cmd.join(' '));
      if (interactiveShell) {
        err(`\x1b[2m(shell interactiva no disponible en el simulador: el contenedor sigue en marcha; usa docker exec ${container.name} COMANDO)\x1b[0m`);
      } else {
        err(`\x1b[2m(sin -d la terminal se quedaría "enganchada" a los logs; en el simulador el contenedor sigue en segundo plano)\x1b[0m`);
      }
    }
  }
  if (p.flags.has('rm') && container.status === 'exited') removeContainer(machine, container);
  return container.status === 'exited' ? container.exitCode : 0;
}

function volumeCommand(ctx: CommandContext, machine: MachineState, state: DockerState, rest: string[], out: (l: string) => void, err: (l: string) => void): number {
  const [action, ...args] = rest;
  const now = ctx.fs.now();
  switch (action) {
    case 'create': {
      const name = args.find((a) => !a.startsWith('-')) ?? hexId(String(now));
      state.volumes[name] ??= { created: now, driver: 'local', data: {} };
      out(name);
      return 0;
    }
    case 'ls': case 'list':
      table(ctx, ['DRIVER', 'VOLUME NAME'], Object.entries(state.volumes).map(([n, v]) => [v.driver, n]));
      return 0;
    case 'inspect':
      return dispatch(ctx, machine, 'inspect', args, out, err);
    case 'rm': {
      let code = 0;
      for (const name of args.filter((a) => !a.startsWith('-'))) {
        if (!state.volumes[name]) {
          err(`Error response from daemon: get ${name}: no such volume`);
          code = 1;
          continue;
        }
        const user = state.containers.find((c) => c.mounts.some((m) => m.source === name));
        if (user) {
          err(`Error response from daemon: remove ${name}: volume is in use - [${user.id}]`);
          code = 1;
          continue;
        }
        delete state.volumes[name];
        out(name);
      }
      return code;
    }
    case 'prune': {
      const removed = Object.keys(state.volumes).filter((v) => !state.containers.some((c) => c.mounts.some((m) => m.source === v)) && (args.includes('-a') || args.includes('--all') || /^[0-9a-f]{64}$/.test(v)));
      for (const v of removed) delete state.volumes[v];
      out(`Deleted Volumes:\n${removed.join('\n')}\n\nTotal reclaimed space: 0B`);
      return 0;
    }
    default:
      err(`docker: 'volume ${action ?? ''}' is not a docker command.`);
      return 1;
  }
}

function networkCommand(ctx: CommandContext, state: DockerState, rest: string[], out: (l: string) => void, err: (l: string) => void): number {
  const [action, ...args] = rest;
  const p = parseArgs(args, ['d', 'driver', 'subnet']);
  switch (action) {
    case 'create': {
      const name = p.positional[0];
      if (!name) {
        err('"docker network create" requires exactly 1 argument.');
        return 1;
      }
      if (state.networks[name]) {
        err(`Error response from daemon: network with name ${name} already exists`);
        return 1;
      }
      state.networks[name] = { driver: p.flags.get('d')?.[0] ?? p.flags.get('driver')?.[0] ?? 'bridge', subnet: p.flags.get('subnet')?.[0] ?? `172.${18 + Object.keys(state.networks).length}.0.0/16`, created: ctx.fs.now() };
      out(hexId(name));
      return 0;
    }
    case 'ls': case 'list':
      table(ctx, ['NETWORK ID', 'NAME', 'DRIVER', 'SCOPE'], Object.entries(state.networks).map(([n, v]) => [hexId(n, 12), n, v.driver, 'local']));
      return 0;
    case 'inspect': {
      const n = state.networks[p.positional[0] ?? ''];
      if (!n) {
        err(`Error response from daemon: network ${p.positional[0] ?? ''} not found`);
        return 1;
      }
      out(JSON.stringify([{ Name: p.positional[0], Driver: n.driver, IPAM: { Config: [{ Subnet: n.subnet }] }, Containers: Object.fromEntries(state.containers.filter((c) => c.networks.includes(p.positional[0])).map((c) => [c.id, { Name: c.name }])) }], null, 4));
      return 0;
    }
    case 'connect': case 'disconnect': {
      const [network, name] = p.positional;
      const c = findContainer(state, name ?? '');
      if (!state.networks[network ?? ''] || !c) {
        err(`Error response from daemon: No such ${!c ? 'container' : 'network'}: ${!c ? name : network}`);
        return 1;
      }
      c.networks = action === 'connect' ? [...new Set([...c.networks, network])] : c.networks.filter((x) => x !== network);
      return 0;
    }
    case 'rm': {
      for (const name of p.positional) {
        if (['bridge', 'host', 'none'].includes(name)) {
          err(`Error response from daemon: ${name} is a pre-defined network and cannot be removed`);
          return 1;
        }
        if (state.containers.some((c) => c.networks.includes(name) && c.status === 'running')) {
          err(`Error response from daemon: error while removing network: network ${name} has active endpoints`);
          return 1;
        }
        delete state.networks[name];
        out(name);
      }
      return 0;
    }
    default:
      err(`docker: 'network ${action ?? ''}' is not a docker command.`);
      return 1;
  }
}

function buildCommand(ctx: CommandContext, state: DockerState, args: string[], out: (l: string) => void, err: (l: string) => void): number {
  const p = parseArgs(args, ['t', 'tag', 'f', 'file', 'build-arg', 'target']);
  const contextArg = p.positional[0];
  if (!contextArg) {
    err('ERROR: "docker buildx build" requires exactly 1 argument.\nSee \'docker buildx build --help\'.');
    return 1;
  }
  const contextDir = ctx.resolve(contextArg);
  const file = p.flags.get('f')?.[0] ?? p.flags.get('file')?.[0];
  const buildArgs = Object.fromEntries((p.flags.get('build-arg') ?? []).map((a) => a.split('=')).map(([k, ...v]) => [k, v.join('=')]));
  const tags = [...(p.flags.get('t') ?? []), ...(p.flags.get('tag') ?? [])];
  const result = buildImage(ctx.fs, state, { contextDir, dockerfile: file ? ctx.resolve(file) : joinPath(contextDir, 'Dockerfile'), tag: tags[0] ?? '', noCache: p.flags.has('no-cache'), buildArgs }, ctx.fs.now());
  for (const line of result.output) err(line);
  for (const extra of tags.slice(1)) {
    const { repository, tag } = parseReference(extra);
    state.images.push({ ...result.image, repository, tag });
  }
  void out;
  return 0;
}

function composeCommand(ctx: CommandContext, machine: MachineState, state: DockerState, args: string[], out: (l: string) => void, err: (l: string) => void): number {
  if (machine.packages['docker-compose-v2']?.status !== 'installed' && machine.packages['docker-compose-plugin']?.status !== 'installed') {
    err("docker: 'compose' is not a docker command.\nSee 'docker --help'\n\x1b[2m(instala el plugin: sudo apt install docker-compose-v2)\x1b[0m");
    return 1;
  }
  const p = parseArgs(args, ['f', 'file', 'p', 'project-name', 'tail', 'n'], true);
  const [action, ...rest] = p.positional;
  const fileFlag = p.flags.get('f')?.[0] ?? p.flags.get('file')?.[0];
  const project = loadCompose(ctx.fs, ctx.session.cwd, fileFlag);
  const restFlags = parseArgs(rest, ['tail', 'n', 'u', 'user', 'scale']);
  switch (action) {
    case 'config': case 'convert':
      if (restFlags.flags.has('quiet') || restFlags.flags.has('q')) return 0;
      out(ctx.fs.readFile(project.file).trimEnd());
      return 0;
    case 'up': {
      composeUp(ctx.fs, machine, project, { build: restFlags.flags.has('build'), only: restFlags.positional }, err);
      if (!restFlags.flags.has('d') && !restFlags.flags.has('detach')) {
        for (const c of composeContainers(machine, project)) for (const l of c.logs) out(`${c.compose!.service.padEnd(10)} | ${l.split('\n')[0]}`);
        err('\x1b[2m(sin -d compose se queda mostrando los logs; en el simulador los servicios siguen en segundo plano)\x1b[0m');
      }
      return 0;
    }
    case 'down':
      composeDown(machine, project, restFlags.flags.has('v') || restFlags.flags.has('volumes'), err);
      return 0;
    case 'ps': {
      const containers = composeContainers(machine, project).filter((c) => restFlags.flags.has('a') || c.status === 'running');
      table(ctx, ['NAME', 'IMAGE', 'COMMAND', 'SERVICE', 'CREATED', 'STATUS', 'PORTS'], containers.map((c) => [c.name, c.image, `"${c.cmd.join(' ').slice(0, 18)}"`, c.compose!.service, ago(c.created, ctx.fs.now()), statusText(c, ctx.fs.now()), portsText(c)]));
      return 0;
    }
    case 'logs': {
      const tail = Number(restFlags.flags.get('tail')?.[0] ?? restFlags.flags.get('n')?.[0] ?? Infinity);
      for (const c of composeContainers(machine, project)) {
        if (restFlags.positional.length && !restFlags.positional.includes(c.compose!.service)) continue;
        const lines = c.logs.flatMap((l) => l.split('\n'));
        for (const l of lines.slice(Number.isFinite(tail) ? -tail : 0)) out(`${c.name.padEnd(18)} | ${l}`);
      }
      return 0;
    }
    case 'stop': case 'start': case 'restart': {
      for (const c of composeContainers(machine, project)) {
        if (restFlags.positional.length && !restFlags.positional.includes(c.compose!.service)) continue;
        if (action !== 'start') stopContainer(machine, c);
        if (action !== 'stop') startContainer(ctx.fs, machine, c);
        err(` ✔ Container ${c.name}  ${action === 'stop' ? 'Stopped' : 'Started'}`);
      }
      return 0;
    }
    case 'build': {
      for (const service of project.services.filter((s) => s.build && (!restFlags.positional.length || restFlags.positional.includes(s.name)))) {
        const result = buildImage(ctx.fs, state, { contextDir: service.build!.context, dockerfile: joinPath(service.build!.context, service.build!.dockerfile), tag: service.image ?? `${project.name}-${service.name}`, noCache: restFlags.flags.has('no-cache'), buildArgs: service.build!.args }, ctx.fs.now());
        for (const line of result.output) err(line);
      }
      return 0;
    }
    case 'pull': {
      for (const service of project.services.filter((s) => s.image && !s.build)) {
        pullImage(state, service.image!, ctx.fs.now());
        err(` ✔ ${service.name} Pulled`);
      }
      return 0;
    }
    case 'exec': {
      const [serviceName, ...argv] = restFlags.positional;
      const service = project.services.find((s) => s.name === serviceName);
      if (!service) {
        err(`service "${serviceName ?? ''}" is not running`);
        return 1;
      }
      const c = state.containers.find((x) => x.name === containerName(project, service));
      if (!c || c.status !== 'running') {
        err(`service "${serviceName}" is not running`);
        return 1;
      }
      return execInContainer(ctx, machine, c, argv);
    }
    default:
      err(`unknown docker command: "compose ${action ?? ''}"`);
      return 1;
  }
}
