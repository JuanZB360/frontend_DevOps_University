/**
 * Modelo del motor de Docker simulado: imágenes, contenedores, volúmenes y
 * redes, guardado dentro del estado de la máquina.
 */
import type { MachineState } from '../machine';

export interface ImageConfig {
  cmd: string[];
  entrypoint: string[];
  env: Record<string, string>;
  exposed: number[];
  workdir: string;
  user: string;
  /** Archivos propios de la imagen (los que verá `docker exec ... cat`). */
  files: Record<string, string>;
  /** Comportamiento al ejecutarse: servidor web, base de datos, script... */
  kind: ImageKind;
  healthcheck?: string;
  labels?: Record<string, string>;
}

export type ImageKind =
  | 'web' // sirve archivos (nginx, httpd)
  | 'app' // aplicación HTTP propia (node, python con servidor)
  | 'db' // base de datos (postgres, mysql)
  | 'cache' // redis
  | 'registry'
  | 'hello'
  | 'shell' // ubuntu, alpine: ejecuta su comando y termina
  | 'monitoring';

export interface Image {
  id: string;
  repository: string;
  tag: string;
  sizeMB: number;
  created: number;
  config: ImageConfig;
  /** Número de capas (para docker history / build). */
  layers: string[];
}

export interface PortMapping {
  host: number;
  container: number;
}

export interface Mount {
  type: 'volume' | 'bind';
  source: string;
  target: string;
  readOnly: boolean;
}

export interface Container {
  id: string;
  name: string;
  image: string;
  imageId: string;
  status: 'created' | 'running' | 'exited' | 'paused';
  exitCode: number;
  created: number;
  started: number;
  ports: PortMapping[];
  env: Record<string, string>;
  mounts: Mount[];
  networks: string[];
  cmd: string[];
  restart: string;
  logs: string[];
  /** Archivos escritos dentro del contenedor (se pierden al borrarlo). */
  writes: Record<string, string>;
  user: string;
  readOnly: boolean;
  memoryMB: number | null;
  compose?: { project: string; service: string };
  health?: 'starting' | 'healthy' | 'unhealthy';
}

export interface DockerState {
  installed: boolean;
  images: Image[];
  containers: Container[];
  volumes: Record<string, { created: number; driver: string; data: Record<string, string> }>;
  networks: Record<string, { driver: string; subnet: string; created: number }>;
  /** Registros en los que hay sesión iniciada. */
  logins: string[];
  /** Imágenes subidas a cada registro (repo:tag). */
  pushed: Record<string, string[]>;
  nextIp: number;
}

export function dockerState(machine: MachineState): DockerState {
  const m = machine as MachineState & { docker?: DockerState };
  m.docker ??= {
    installed: true,
    images: [],
    containers: [],
    volumes: {},
    networks: {
      bridge: { driver: 'bridge', subnet: '172.17.0.0/16', created: machine.bootTime },
      host: { driver: 'host', subnet: '', created: machine.bootTime },
      none: { driver: 'null', subnet: '', created: machine.bootTime },
    },
    logins: [],
    pushed: {},
    nextIp: 2,
  };
  return m.docker;
}

/** Identificador hexadecimal pseudoaleatorio estable a partir de un texto. */
export function hexId(seed: string, length = 64): string {
  let h1 = 0x811c9dc5;
  let out = '';
  let i = 0;
  while (out.length < length) {
    for (const ch of seed + i) h1 = Math.imul(h1 ^ ch.charCodeAt(0), 16_777_619) >>> 0;
    out += h1.toString(16).padStart(8, '0');
    i++;
  }
  return out.slice(0, length);
}

const ADJECTIVES = ['admiring', 'brave', 'clever', 'eager', 'focused', 'gifted', 'happy', 'jolly', 'keen', 'nifty', 'quirky', 'serene', 'vibrant', 'zealous'];
const SCIENTISTS = ['turing', 'hopper', 'lovelace', 'torvalds', 'ritchie', 'thompson', 'hamilton', 'curie', 'noether', 'shannon', 'babbage', 'knuth'];

export function randomName(existing: Set<string>): string {
  for (;;) {
    const name = `${ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]}_${SCIENTISTS[Math.floor(Math.random() * SCIENTISTS.length)]}`;
    if (!existing.has(name)) return name;
  }
}

/** "nginx" → nginx:latest ; "localhost:5000/app:1.0" se respeta. */
export function parseReference(ref: string): { repository: string; tag: string } {
  const at = ref.lastIndexOf(':');
  const slash = ref.lastIndexOf('/');
  if (at > slash) return { repository: ref.slice(0, at), tag: ref.slice(at + 1) };
  return { repository: ref, tag: 'latest' };
}

// ─────────────────────────────── Docker Hub simulado ───────────────────────────────

const NGINX_INDEX = '<!DOCTYPE html>\n<html>\n<head>\n<title>Welcome to nginx!</title>\n</head>\n<body>\n<h1>Welcome to nginx!</h1>\n<p>If you see this page, the nginx web server is successfully installed and working.</p>\n</body>\n</html>\n';

interface HubImage {
  sizeMB: number;
  config: Partial<ImageConfig> & { kind: ImageKind };
  layers: number;
}

const base = (kind: ImageKind, extra: Partial<ImageConfig> = {}): Partial<ImageConfig> & { kind: ImageKind } => ({ kind, ...extra });

/** Imágenes disponibles en el "Docker Hub" del simulador (repositorio → etiquetas). */
export const HUB: Record<string, Record<string, HubImage>> = {
  'hello-world': { latest: { sizeMB: 0.013, layers: 1, config: base('hello', { cmd: ['/hello'] }) } },
  nginx: {
    latest: { sizeMB: 188, layers: 7, config: base('web', { cmd: ['nginx', '-g', 'daemon off;'], exposed: [80], files: { '/usr/share/nginx/html/index.html': NGINX_INDEX, '/etc/nginx/conf.d/default.conf': 'server {\n    listen 80;\n    root /usr/share/nginx/html;\n}\n' } }) },
    alpine: { sizeMB: 43, layers: 8, config: base('web', { cmd: ['nginx', '-g', 'daemon off;'], exposed: [80], files: { '/usr/share/nginx/html/index.html': NGINX_INDEX } }) },
    '1.27': { sizeMB: 188, layers: 7, config: base('web', { cmd: ['nginx', '-g', 'daemon off;'], exposed: [80], files: { '/usr/share/nginx/html/index.html': NGINX_INDEX } }) },
  },
  httpd: { latest: { sizeMB: 148, layers: 6, config: base('web', { cmd: ['httpd-foreground'], exposed: [80], files: { '/usr/local/apache2/htdocs/index.html': '<html><body><h1>It works!</h1></body></html>\n' } }) } },
  ubuntu: {
    latest: { sizeMB: 78, layers: 1, config: base('shell', { cmd: ['/bin/bash'], files: { '/etc/os-release': 'PRETTY_NAME="Ubuntu 24.04.1 LTS"\n' } }) },
    '24.04': { sizeMB: 78, layers: 1, config: base('shell', { cmd: ['/bin/bash'], files: { '/etc/os-release': 'PRETTY_NAME="Ubuntu 24.04.1 LTS"\n' } }) },
    '22.04': { sizeMB: 77, layers: 1, config: base('shell', { cmd: ['/bin/bash'], files: { '/etc/os-release': 'PRETTY_NAME="Ubuntu 22.04.4 LTS"\n' } }) },
  },
  alpine: {
    latest: { sizeMB: 7.8, layers: 1, config: base('shell', { cmd: ['/bin/sh'], files: { '/etc/os-release': 'NAME="Alpine Linux"\nVERSION_ID=3.20.3\n' } }) },
    '3.20': { sizeMB: 7.8, layers: 1, config: base('shell', { cmd: ['/bin/sh'], files: { '/etc/os-release': 'NAME="Alpine Linux"\nVERSION_ID=3.20.3\n' } }) },
  },
  busybox: { latest: { sizeMB: 4.3, layers: 1, config: base('shell', { cmd: ['sh'] }) } },
  node: {
    '20': { sizeMB: 1100, layers: 9, config: base('app', { cmd: ['node'], workdir: '/', env: { NODE_VERSION: '20.18.0' } }) },
    '20-alpine': { sizeMB: 135, layers: 6, config: base('app', { cmd: ['node'], workdir: '/', env: { NODE_VERSION: '20.18.0' } }) },
    '20-slim': { sizeMB: 210, layers: 6, config: base('app', { cmd: ['node'], workdir: '/', env: { NODE_VERSION: '20.18.0' } }) },
  },
  python: {
    '3.12': { sizeMB: 1020, layers: 9, config: base('app', { cmd: ['python3'], env: { PYTHON_VERSION: '3.12.7' } }) },
    '3.12-slim': { sizeMB: 155, layers: 5, config: base('app', { cmd: ['python3'], env: { PYTHON_VERSION: '3.12.7' } }) },
  },
  postgres: {
    '16': { sizeMB: 432, layers: 14, config: base('db', { cmd: ['postgres'], exposed: [5432], env: { PGDATA: '/var/lib/postgresql/data' }, healthcheck: 'pg_isready' }) },
    '16-alpine': { sizeMB: 245, layers: 11, config: base('db', { cmd: ['postgres'], exposed: [5432], env: { PGDATA: '/var/lib/postgresql/data' } }) },
  },
  mysql: { '8.4': { sizeMB: 586, layers: 11, config: base('db', { cmd: ['mysqld'], exposed: [3306] }) } },
  redis: {
    '7': { sizeMB: 117, layers: 8, config: base('cache', { cmd: ['redis-server'], exposed: [6379] }) },
    '7-alpine': { sizeMB: 41, layers: 7, config: base('cache', { cmd: ['redis-server'], exposed: [6379] }) },
  },
  registry: { '2': { sizeMB: 25, layers: 5, config: base('registry', { cmd: ['/etc/docker/registry/config.yml'], exposed: [5000] }) } },
  'prom/prometheus': { latest: { sizeMB: 295, layers: 10, config: base('monitoring', { cmd: ['--config.file=/etc/prometheus/prometheus.yml'], exposed: [9090] }) } },
  'grafana/grafana': { latest: { sizeMB: 480, layers: 11, config: base('monitoring', { cmd: [], exposed: [3000] }) } },
};

export function hubImage(repository: string, tag: string, now: number): Image | null {
  const name = repository.replace(/^docker\.io\/(library\/)?/, '');
  const entry = HUB[name]?.[tag];
  if (!entry) return null;
  const id = hexId(`${name}:${tag}`);
  return {
    id,
    repository: name,
    tag,
    sizeMB: entry.sizeMB,
    created: now - 12 * 86_400_000,
    layers: Array.from({ length: entry.layers }, (_, i) => hexId(`${name}:${tag}:layer${i}`, 12)),
    config: {
      cmd: [], entrypoint: [], env: {}, exposed: [], workdir: '/', user: 'root', files: {},
      ...entry.config,
      kind: entry.config.kind,
    },
  };
}

export function findImage(state: DockerState, ref: string): Image | undefined {
  if (/^[0-9a-f]{4,64}$/.test(ref)) {
    const byId = state.images.find((i) => i.id.startsWith(ref));
    if (byId) return byId;
  }
  const { repository, tag } = parseReference(ref);
  return state.images.find((i) => i.repository === repository && i.tag === tag);
}

export function findContainer(state: DockerState, ref: string): Container | undefined {
  return state.containers.find((c) => c.name === ref) ?? state.containers.find((c) => ref.length >= 3 && c.id.startsWith(ref));
}
