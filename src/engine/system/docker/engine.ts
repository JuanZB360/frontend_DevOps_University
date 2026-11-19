/**
 * Operaciones del motor de Docker: descargar imágenes, crear/arrancar/parar
 * contenedores, publicar puertos y responder a las peticiones que reciben.
 */
import type { VirtualFileSystem } from '../../vfs/VirtualFileSystem';
import { joinPath, normalize } from '../../vfs/path';
import { spawnProcess, type MachineState } from '../machine';
import { registerHttpHandler, type HttpRequest, type HttpResponse, type NetworkError } from '../network';
import { dockerState, findImage, hexId, hubImage, parseReference, randomName, type Container, type DockerState, type Image, type Mount, type PortMapping } from './model';

export class DockerError extends Error {}

/** Descarga una imagen (si no está ya). */
export function pullImage(state: DockerState, ref: string, now: number, out?: (line: string) => void): Image {
  const existing = findImage(state, ref);
  if (existing) return existing;
  const { repository, tag } = parseReference(ref);
  if (/^localhost:5000\//.test(repository)) {
    const pushedList = state.pushed['localhost:5000'] ?? [];
    if (!pushedList.includes(`${repository.replace('localhost:5000/', '')}:${tag}`)) throw new DockerError(`Error response from daemon: manifest for ${repository}:${tag} not found: manifest unknown: manifest unknown`);
  }
  const image = hubImage(repository, tag, now);
  if (!image) {
    if (!/^[a-z0-9]+([._/-][a-z0-9]+)*$/.test(repository)) throw new DockerError(`invalid reference format: repository name (${repository}) must be lowercase`);
    throw new DockerError(`Error response from daemon: pull access denied for ${repository}, repository does not exist or may require 'docker login': denied: requested access to the resource is denied`);
  }
  out?.(`${tag}: Pulling from library/${repository}`);
  for (const layer of image.layers) out?.(`${layer}: Pull complete`);
  out?.(`Digest: sha256:${hexId(ref + 'digest')}`);
  out?.(`Status: Downloaded newer image for ${repository}:${tag}`);
  out?.(`docker.io/library/${repository}:${tag}`);
  state.images.push(image);
  return image;
}

export interface RunOptions {
  image: string;
  name?: string;
  detach: boolean;
  interactive: boolean;
  ports: PortMapping[];
  env: Record<string, string>;
  mounts: Mount[];
  networks: string[];
  cmd: string[];
  restart: string;
  remove: boolean;
  user?: string;
  readOnly: boolean;
  memoryMB: number | null;
  compose?: { project: string; service: string };
  workdir?: string;
}

/** Puerto del host ocupado por un proceso o por otro contenedor. */
function hostPortBusy(machine: MachineState, port: number): boolean {
  return machine.processes.some((p) => p.ports?.includes(port));
}

export function createContainer(fs: VirtualFileSystem, machine: MachineState, options: RunOptions, out: (line: string) => void): Container {
  const state = dockerState(machine);
  const now = fs.now();
  const image = findImage(state, options.image) ?? pullImage(state, options.image, now, (l) => {
    if (l.startsWith('Status:') || l.includes('Pulling')) out(l);
  });
  if (options.name && state.containers.some((c) => c.name === options.name)) {
    const other = state.containers.find((c) => c.name === options.name)!;
    throw new DockerError(`docker: Error response from daemon: Conflict. The container name "/${options.name}" is already in use by container "${other.id}". You have to remove (or rename) that container to be able to reuse that name.`);
  }
  for (const network of options.networks) {
    if (!state.networks[network]) throw new DockerError(`docker: Error response from daemon: network ${network} not found.`);
  }
  for (const mount of options.mounts) {
    if (mount.type === 'volume' && !state.volumes[mount.source]) state.volumes[mount.source] = { created: now, driver: 'local', data: {} };
  }
  const id = hexId(`${options.name ?? ''}${now}${Math.random()}`);
  const container: Container = {
    id,
    name: options.name ?? randomName(new Set(state.containers.map((c) => c.name))),
    image: options.image,
    imageId: image.id,
    status: 'created',
    exitCode: 0,
    created: now,
    started: 0,
    ports: options.ports,
    env: { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', ...image.config.env, ...options.env, HOSTNAME: id.slice(0, 12) },
    mounts: options.mounts,
    networks: options.networks.length ? options.networks : ['bridge'],
    cmd: options.cmd.length ? options.cmd : [...image.config.entrypoint, ...image.config.cmd],
    restart: options.restart,
    logs: [],
    writes: {},
    user: options.user ?? image.config.user,
    readOnly: options.readOnly,
    memoryMB: options.memoryMB,
    compose: options.compose,
  };
  state.containers.push(container);
  return container;
}

/** Arranca el contenedor: según el tipo de imagen se queda en marcha o termina. */
export function startContainer(fs: VirtualFileSystem, machine: MachineState, container: Container): void {
  const state = dockerState(machine);
  const image = state.images.find((i) => i.id === container.imageId);
  if (!image) throw new DockerError(`Error response from daemon: No such image: ${container.image}`);
  for (const p of container.ports) {
    if (hostPortBusy(machine, p.host)) {
      throw new DockerError(`docker: Error response from daemon: driver failed programming external connectivity on endpoint ${container.name} (${container.id.slice(0, 12)}): Bind for 0.0.0.0:${p.host} failed: port is already allocated.`);
    }
  }
  const now = fs.now();
  container.started = now;
  const kind = image.config.kind;
  const log = (line: string): void => {
    container.logs.push(line);
  };

  // Imágenes que ejecutan algo y terminan.
  if (kind === 'hello') {
    log('\nHello from Docker!\nThis message shows that your installation appears to be working correctly.\n\nTo generate this message, Docker took the following steps:\n 1. The Docker client contacted the Docker daemon.\n 2. The Docker daemon pulled the "hello-world" image from the Docker Hub.\n 3. The Docker daemon created a new container from that image which runs the\n    executable that produces the output you are currently reading.\n 4. The Docker daemon streamed that output to the Docker client, which sent it\n    to your terminal.\n');
    container.status = 'exited';
    container.exitCode = 0;
    return;
  }
  if (kind === 'shell' || (kind === 'app' && !runsServer(container, image))) {
    const output = runShellCommand(container, image, fs, state);
    if (output.text) log(output.text);
    container.status = output.keepRunning ? 'running' : 'exited';
    container.exitCode = output.code;
    if (!output.keepRunning) return;
  } else if (kind === 'db') {
    const isPostgres = /postgres/.test(image.repository);
    const passwordVar = isPostgres ? 'POSTGRES_PASSWORD' : 'MYSQL_ROOT_PASSWORD';
    if (!container.env[passwordVar] && container.env[isPostgres ? 'POSTGRES_HOST_AUTH_METHOD' : 'MYSQL_ALLOW_EMPTY_PASSWORD'] === undefined) {
      log(isPostgres
        ? 'Error: Database is uninitialized and superuser password is not specified.\n       You must specify POSTGRES_PASSWORD to a non-empty value for the\n       superuser. For example, "-e POSTGRES_PASSWORD=password" on "docker run".'
        : '[ERROR] [Entrypoint]: Database is uninitialized and password option is not specified\n    You need to specify one of the following as an environment variable:\n    - MYSQL_ROOT_PASSWORD\n    - MYSQL_ALLOW_EMPTY_PASSWORD\n    - MYSQL_RANDOM_ROOT_PASSWORD');
      container.status = 'exited';
      container.exitCode = 1;
      return;
    }
    const persisted = container.mounts.some((m) => /\/var\/lib\/(postgresql|mysql)/.test(m.target) && m.type === 'volume' && Object.keys(state.volumes[m.source]?.data ?? {}).length > 0);
    log(isPostgres
      ? (persisted ? 'PostgreSQL Database directory appears to contain a database; Skipping initialization\n' : 'The files belonging to this database system will be owned by user "postgres".\nPostgreSQL init process complete; ready for start up.\n') + `LOG:  database system is ready to accept connections`
      : '[Server] /usr/sbin/mysqld: ready for connections. Version: \'8.4.3\'  socket: \'/var/run/mysqld/mysqld.sock\'  port: 3306');
    for (const m of container.mounts) {
      if (m.type === 'volume' && /\/var\/lib\/(postgresql|mysql)/.test(m.target)) state.volumes[m.source].data['PG_VERSION'] = '16';
    }
    container.health = 'healthy';
  } else if (kind === 'cache') {
    log(`1:M ${new Date(now).toUTCString()} * Ready to accept connections tcp`);
    container.health = 'healthy';
  } else if (kind === 'web') {
    log('/docker-entrypoint.sh: Configuration complete; ready for start up');
  } else if (kind === 'registry') {
    log('level=info msg="listening on [::]:5000" go.version=go1.20.8');
  } else if (kind === 'monitoring') {
    log(/prometheus/.test(image.repository) ? 'ts=2024-11-16T09:14:22Z caller=main.go msg="Server is ready to receive web requests."' : 'logger=http.server msg="HTTP Server Listen" address=[::]:3000 protocol=http');
  } else {
    log(appStartupLog(container, image));
  }
  container.status = 'running';
  container.exitCode = 0;
  container.health ??= image.config.healthcheck ? 'healthy' : undefined;
  // El proceso del contenedor y el reenvío de puertos (docker-proxy) en el host.
  spawnProcess(machine, now, { user: container.user === 'root' || !container.user ? 'root' : container.user, command: container.cmd.join(' ') || image.repository, cpu: 0.3, mem: 1.4, rss: Math.round(image.sizeMB * 60) + 8_000, container: container.name });
  for (const p of container.ports) {
    spawnProcess(machine, now, { user: 'root', command: `/usr/bin/docker-proxy -proto tcp -host-ip 0.0.0.0 -host-port ${p.host} -container-port ${p.container}`, cpu: 0, mem: 0.1, rss: 4_000, ports: [p.host], container: container.name });
  }
}

function runsServer(container: Container, image: Image): boolean {
  const cmd = container.cmd.join(' ');
  return /node\s+\S+\.js|npm (start|run)|python3? -m http\.server|gunicorn|uvicorn|flask run|python3? \S+\.py/.test(cmd) && (image.config.exposed.length > 0 || Object.keys(image.config.files).length > 0);
}

function appStartupLog(container: Container, image: Image): string {
  const port = image.config.exposed[0] ?? 3000;
  const custom = Object.values(image.config.files).map((f) => /\/\/ LOG: (.+)/.exec(f)?.[1]).find(Boolean);
  return custom ?? `Servidor escuchando en http://0.0.0.0:${port} (NODE_ENV=${container.env.NODE_ENV ?? 'development'})`;
}

/** Ejecuta el comando de un contenedor de tipo "shell" y devuelve su salida. */
function runShellCommand(container: Container, image: Image, fs: VirtualFileSystem, state: DockerState): { text: string; code: number; keepRunning: boolean } {
  const cmd = container.cmd;
  const line = cmd.join(' ');
  if (cmd.length === 0 || /^(\/bin\/)?(ba)?sh$/.test(line)) return { text: '', code: 0, keepRunning: false };
  const inner = /^(?:\/bin\/)?(?:ba)?sh -c (.+)$/.exec(line)?.[1]?.replace(/^["']|["']$/g, '') ?? line;
  if (/^sleep (infinity|\d+)/.test(inner) || /tail -f \/dev\/null/.test(inner) || /while true/.test(inner)) return { text: '', code: 0, keepRunning: true };
  const outputs: string[] = [];
  for (const part of inner.split(/\s*(?:&&|;)\s*/)) {
    const [program, ...args] = part.split(/\s+/);
    if (program === 'echo') outputs.push(args.join(' ').replace(/^["']|["']$/g, ''));
    else if (program === 'cat' && args[0]) outputs.push((image.config.files[args[0]] ?? container.writes[args[0]] ?? `cat: ${args[0]}: No such file or directory`).replace(/\n$/, ''));
    else if (program === 'uname') outputs.push(args.includes('-a') ? `Linux ${container.id.slice(0, 12)} 6.8.0-devops #1 SMP x86_64 GNU/Linux` : 'Linux');
    else if (program === 'hostname') outputs.push(container.id.slice(0, 12));
    else if (program === 'whoami') outputs.push(container.user || 'root');
    else if (program === 'date') outputs.push(new Date().toUTCString());
    else if (program === 'node' && args[0] === '-v') outputs.push(`v${container.env.NODE_VERSION ?? '20.18.0'}`);
    else if (program === 'python3' && args[0] === '--version') outputs.push(`Python ${container.env.PYTHON_VERSION ?? '3.12.7'}`);
    else if (program === 'env') outputs.push(Object.entries(container.env).map(([k, v]) => `${k}=${v}`).join('\n'));
    else if (program === 'ls') outputs.push('bin\nboot\ndev\netc\nhome\nlib\nmedia\nmnt\nopt\nproc\nroot\nrun\nsbin\nsrv\nsys\ntmp\nusr\nvar');
    else if (program === 'exit') return { text: outputs.join('\n'), code: Number(args[0] ?? 0), keepRunning: false };
    else if (program === 'tar' && /c/.test(args[0] ?? '') && args[1]) {
      // Copia de seguridad de un volumen: tar czf /backup/x.tar.gz /datos
      const [archive, ...sources] = args.slice(1);
      const files: Record<string, string> = {};
      for (const source of sources) {
        for (const m of container.mounts) {
          if (!source.startsWith(m.target)) continue;
          if (m.type === 'volume') for (const [k, v] of Object.entries(state.volumes[m.source]?.data ?? {})) files[`${m.target.replace(/^\//, '')}/${k}`] = v;
        }
      }
      const entries = Object.entries(files).map(([path, content]) => ({ path, type: 'file', content, mode: 0o644, owner: 'root', group: 'root', mtime: 0 }));
      const error = writeContainerFile(fs, state, container, archive, '\x1f\x8bGZSIM\n' + JSON.stringify({ content: 'TARSIM\n' + JSON.stringify(entries), size: 4096 }));
      if (error) outputs.push(`tar: ${error}`);
    }
    else if (program) outputs.push(`/bin/sh: 1: ${program}: not found`);
  }
  return { text: outputs.join('\n'), code: 0, keepRunning: false };
}

export function stopContainer(machine: MachineState, container: Container, code = 0): void {
  container.status = 'exited';
  container.exitCode = code;
  container.health = undefined;
  machine.processes = machine.processes.filter((p) => p.container !== container.name);
}

export function removeContainer(machine: MachineState, container: Container, removeVolumes = false): void {
  const state = dockerState(machine);
  stopContainer(machine, container);
  state.containers = state.containers.filter((c) => c.id !== container.id);
  if (removeVolumes) {
    // Solo los volúmenes anónimos (los con nombre sobreviven, como en Docker).
  }
}

// ─────────────────────────────── Archivos del contenedor ───────────────────────────────

/** Lee un archivo tal como lo ve el contenedor (montajes > escrituras > imagen). */
export function readContainerFile(fs: VirtualFileSystem, state: DockerState, container: Container, path: string): string | null {
  const abs = normalize(path);
  const mounts = [...container.mounts].sort((a, b) => b.target.length - a.target.length);
  for (const mount of mounts) {
    if (abs !== mount.target && !abs.startsWith(mount.target + '/')) continue;
    const rel = abs.slice(mount.target.length);
    if (mount.type === 'bind') {
      const host = joinPath(mount.source, rel);
      return fs.privileged(() => (fs.isFile(host) ? fs.readFile(host) : fs.isDirectory(host) ? null : null));
    }
    const volume = state.volumes[mount.source];
    const value = volume?.data[rel.replace(/^\//, '')] ?? volume?.data[abs];
    if (value !== undefined) return value;
  }
  if (container.writes[abs] !== undefined) return container.writes[abs];
  const image = state.images.find((i) => i.id === container.imageId);
  return image?.config.files[abs] ?? null;
}

/** Escribe un archivo dentro del contenedor (en el volumen si la ruta está montada). */
export function writeContainerFile(fs: VirtualFileSystem, state: DockerState, container: Container, path: string, content: string): string | null {
  const abs = normalize(path);
  if (container.readOnly && !container.mounts.some((m) => abs.startsWith(m.target))) return `${path}: Read-only file system`;
  const mounts = [...container.mounts].sort((a, b) => b.target.length - a.target.length);
  for (const mount of mounts) {
    if (abs !== mount.target && !abs.startsWith(mount.target + '/')) continue;
    if (mount.readOnly) return `${path}: Read-only file system`;
    const rel = abs.slice(mount.target.length).replace(/^\//, '');
    if (mount.type === 'bind') {
      fs.privileged(() => fs.writeFile(joinPath(mount.source, rel), content));
      return null;
    }
    state.volumes[mount.source].data[rel] = content;
    return null;
  }
  container.writes[abs] = content;
  return null;
}

/** Carpeta web del contenedor según la imagen. */
function webRoot(image: Image): string {
  return image.repository === 'httpd' ? '/usr/local/apache2/htdocs' : '/usr/share/nginx/html';
}

/** Respuesta HTTP de un contenedor (lo que hay detrás de docker-proxy). */
export function containerResponse(fs: VirtualFileSystem, machine: MachineState, container: Container, request: HttpRequest, containerPort: number): HttpResponse | NetworkError {
  const state = dockerState(machine);
  const image = state.images.find((i) => i.id === container.imageId);
  if (!image || container.status !== 'running') return { error: 'refused', message: `Failed to connect to ${request.host} port ${request.port}: Connection refused` };
  const server = (status: number, body: string, type = 'text/html'): HttpResponse => ({ status, headers: { 'content-type': type, server: image.config.kind === 'web' ? 'nginx/1.27.2' : 'docker-app' }, body });
  switch (image.config.kind) {
    case 'web': {
      // Si se montó una configuración propia de nginx con proxy_pass, se respeta lo básico.
      const conf = readContainerFile(fs, state, container, '/etc/nginx/conf.d/default.conf') ?? '';
      const proxy = /location\s+(\S+)\s*\{[^}]*proxy_pass\s+http:\/\/([^/:;]+)(?::(\d+))?/.exec(conf);
      const path = request.path.split('?')[0];
      if (proxy && path.startsWith(proxy[1])) {
        const target = resolveContainer(state, container, proxy[2]);
        if (!target) return server(502, '<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center></body></html>\n');
        const response = containerResponse(fs, machine, target, request, Number(proxy[3] ?? 80));
        return 'error' in response ? server(502, '<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center></body></html>\n') : response;
      }
      const root = webRoot(image);
      const file = path.endsWith('/') ? `${root}${path}index.html` : `${root}${path}`;
      const content = readContainerFile(fs, state, container, file) ?? (/\.[a-z0-9]+$/.test(path) ? null : readContainerFile(fs, state, container, `${root}/index.html`));
      if (content === null) return server(404, '<html>\r\n<head><title>404 Not Found</title></head>\r\n<body>\r\n<center><h1>404 Not Found</h1></center>\r\n<hr><center>nginx/1.27.2</center>\r\n</body>\r\n</html>\r\n');
      return server(200, content, file.endsWith('.json') ? 'application/json' : file.endsWith('.css') ? 'text/css' : 'text/html');
    }
    case 'registry': {
      if (request.path.startsWith('/v2/_catalog')) {
        const repos = [...new Set((state.pushed['localhost:5000'] ?? []).map((r) => r.split(':')[0]))];
        return server(200, JSON.stringify({ repositories: repos }) + '\n', 'application/json');
      }
      return server(200, '{}\n', 'application/json');
    }
    case 'monitoring':
      return /prometheus/.test(image.repository)
        ? server(200, '<html><head><title>Prometheus Time Series Collection and Processing Server</title></head><body>Prometheus</body></html>\n')
        : server(200, '<!DOCTYPE html><html><head><title>Grafana</title></head><body>Grafana login</body></html>\n');
    case 'db':
    case 'cache':
      return { error: 'refused', message: `Received HTTP/0.9 when not allowed (el puerto ${containerPort} no habla HTTP: es una base de datos)` };
    default: {
      const custom = Object.values(image.config.files).map((f) => /\/\/ RESPUESTA: (.+)/.exec(f)?.[1]).find(Boolean);
      if (request.path.startsWith('/health')) return server(200, '{"estado":"ok"}\n', 'application/json');
      const body = custom ? custom.replace(/\$\{(\w+)\}/g, (_m, v: string) => container.env[v] ?? '') : JSON.stringify({ app: image.repository, version: image.tag, contenedor: container.id.slice(0, 12), entorno: container.env.NODE_ENV ?? container.env.APP_ENV ?? 'development', ruta: request.path });
      return server(200, body + '\n', custom ? 'text/plain' : 'application/json');
    }
  }
}

/** Otro contenedor alcanzable por nombre (misma red de usuario o enlace de compose). */
export function resolveContainer(state: DockerState, from: Container, name: string): Container | undefined {
  return state.containers.find((c) => c.status === 'running' && (c.name === name || c.compose?.service === name) && c.networks.some((n) => from.networks.includes(n) && n !== 'bridge'));
}

registerHttpHandler('docker-proxy', (fs, request, process, machine) => {
  const state = dockerState(machine);
  const container = state.containers.find((c) => c.name === process.container);
  if (!container) return { error: 'refused', message: 'Connection refused' };
  const mapping = container.ports.find((p) => p.host === request.port);
  return containerResponse(fs, machine, container, request, mapping?.container ?? 80);
});

/** Volver a arrancar los contenedores con restart=always/unless-stopped (tras reiniciar Docker). */
export function restartPolicyStart(fs: VirtualFileSystem, machine: MachineState): void {
  for (const c of dockerState(machine).containers) {
    if (c.status !== 'running' && (c.restart === 'always' || c.restart === 'unless-stopped')) {
      try {
        startContainer(fs, machine, c);
      } catch {
        // Puerto ocupado: se queda parado, como en Docker.
      }
    }
  }
}
