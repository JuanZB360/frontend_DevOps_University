/**
 * Docker Compose: lee compose.yaml / docker-compose.yml, valida la estructura
 * y levanta o baja todos los servicios del proyecto.
 */
import { parse as parseYaml } from 'yaml';
import type { VirtualFileSystem } from '../../vfs/VirtualFileSystem';
import { basename, joinPath, normalize } from '../../vfs/path';
import type { MachineState } from '../machine';
import { buildImage } from './build';
import { createContainer, DockerError, removeContainer, startContainer, stopContainer } from './engine';
import { dockerState, type Container, type Mount, type PortMapping } from './model';

const SERVICE_KEYS = new Set(['image', 'build', 'ports', 'environment', 'env_file', 'volumes', 'networks', 'depends_on', 'healthcheck', 'restart', 'command', 'container_name', 'expose', 'user', 'working_dir', 'read_only', 'deploy', 'labels', 'entrypoint', 'mem_limit', 'profiles', 'secrets', 'logging', 'hostname', 'cap_drop', 'security_opt', 'tmpfs', 'ulimits', 'init', 'stop_grace_period']);
const TOP_KEYS = new Set(['services', 'volumes', 'networks', 'version', 'name', 'secrets', 'configs', 'x-common']);

export interface ComposeService {
  name: string;
  image?: string;
  build?: { context: string; dockerfile: string; args: Record<string, string> };
  ports: PortMapping[];
  environment: Record<string, string>;
  volumes: Mount[];
  networks: string[];
  dependsOn: { name: string; condition: string }[];
  healthcheck?: string;
  restart: string;
  command: string[];
  containerName?: string;
  user?: string;
  readOnly: boolean;
  memoryMB: number | null;
}

export interface ComposeProject {
  name: string;
  dir: string;
  file: string;
  services: ComposeService[];
  volumes: string[];
  networks: string[];
}

export const COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];

function asList(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function parseEnv(value: unknown): Record<string, string> {
  if (!value) return {};
  if (Array.isArray(value)) return Object.fromEntries(value.map((v) => String(v).split('=')).map(([k, ...rest]) => [k, rest.join('=')]));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')]));
}

/** Expande ${VAR} y ${VAR:-defecto} con el archivo .env del proyecto. */
function interpolate(text: string, env: Record<string, string>): string {
  return text.replace(/\$\{(\w+)(?::?-([^}]*))?\}/g, (_m, name: string, fallback: string | undefined) => env[name] ?? fallback ?? '');
}

export function loadCompose(fs: VirtualFileSystem, dir: string, fileOverride?: string): ComposeProject {
  const file = fileOverride ? normalize(fileOverride.startsWith('/') ? fileOverride : joinPath(dir, fileOverride)) : COMPOSE_FILES.map((f) => joinPath(dir, f)).find((p) => fs.isFile(p));
  if (!file || !fs.isFile(file)) throw new DockerError('no configuration file provided: not found');
  const dotenv: Record<string, string> = {};
  const envPath = joinPath(dir, '.env');
  if (fs.isFile(envPath)) {
    for (const line of fs.readFile(envPath).split('\n')) {
      const m = /^\s*([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(line);
      if (m) dotenv[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  let doc: Record<string, unknown>;
  try {
    doc = parseYaml(interpolate(fs.readFile(file), dotenv)) as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : 'invalid';
    throw new DockerError(`yaml: ${message.replace(/^\w+Error: /, '').replace(/ at line (\d+), column \d+/, ' line $1')}`);
  }
  if (!doc || typeof doc !== 'object') throw new DockerError('empty compose file');
  for (const key of Object.keys(doc)) if (!TOP_KEYS.has(key) && !key.startsWith('x-')) throw new DockerError(`validating ${basename(file)}: additional properties '${key}' not allowed`);
  const servicesRaw = doc.services as Record<string, Record<string, unknown>> | undefined;
  if (!servicesRaw || typeof servicesRaw !== 'object') throw new DockerError(`validating ${basename(file)}: services must be a mapping`);
  const project = (typeof doc.name === 'string' ? doc.name : basename(dir)).toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const declaredVolumes = Object.keys((doc.volumes as Record<string, unknown>) ?? {});
  const declaredNetworks = Object.keys((doc.networks as Record<string, unknown>) ?? {});

  const services: ComposeService[] = Object.entries(servicesRaw).map(([name, raw]) => {
    if (!raw || typeof raw !== 'object') throw new DockerError(`validating ${basename(file)}: services.${name} must be a mapping`);
    for (const key of Object.keys(raw)) {
      if (!SERVICE_KEYS.has(key)) throw new DockerError(`validating ${basename(file)}: services.${name} additional properties '${key}' not allowed`);
    }
    if (!raw.image && !raw.build) throw new DockerError(`service "${name}" has neither an image nor a build context specified: invalid compose project`);
    const ports = asList(raw.ports).map((p) => {
      const text = String(p).replace(/^["']|["']$/g, '');
      const m = /^(?:[\d.]+:)?(\d+):(\d+)(?:\/\w+)?$/.exec(text);
      if (!m) throw new DockerError(`invalid port "${text}" for service "${name}" (formato: "HOST:CONTENEDOR")`);
      return { host: Number(m[1]), container: Number(m[2]) };
    });
    const volumes: Mount[] = asList(raw.volumes).map((v) => {
      const [source, target, mode] = String(v).split(':');
      if (!target) throw new DockerError(`service "${name}" refers to an invalid volume "${String(v)}"`);
      const isBind = source.startsWith('.') || source.startsWith('/') || source.startsWith('~');
      if (!isBind && !declaredVolumes.includes(source)) throw new DockerError(`service "${name}" refers to undefined volume ${source}: invalid compose project`);
      return { type: isBind ? 'bind' : 'volume', source: isBind ? normalize(joinPath(dir, source)) : `${project}_${source}`, target, readOnly: mode === 'ro' };
    });
    const networks = (Array.isArray(raw.networks) ? raw.networks : Object.keys((raw.networks as Record<string, unknown>) ?? {})).map(String);
    for (const n of networks) if (!declaredNetworks.includes(n)) throw new DockerError(`service "${name}" refers to undefined network ${n}: invalid compose project`);
    const depends = Array.isArray(raw.depends_on)
      ? raw.depends_on.map((d) => ({ name: String(d), condition: 'service_started' }))
      : Object.entries((raw.depends_on as Record<string, { condition?: string }>) ?? {}).map(([n, v]) => ({ name: n, condition: v?.condition ?? 'service_started' }));
    for (const d of depends) if (!servicesRaw[d.name]) throw new DockerError(`service "${name}" depends on undefined service "${d.name}": invalid compose project`);
    const env = { ...parseEnv(raw.environment) };
    for (const envFile of asList(raw.env_file)) {
      const path = joinPath(dir, String(envFile));
      if (!fs.isFile(path)) throw new DockerError(`env file ${path} not found: stat ${path}: no such file or directory`);
      for (const line of fs.readFile(path).split('\n')) {
        const m = /^\s*([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(line);
        if (m) env[m[1]] ??= m[2];
      }
    }
    const build = raw.build === undefined ? undefined : typeof raw.build === 'string'
      ? { context: normalize(joinPath(dir, raw.build)), dockerfile: 'Dockerfile', args: {} }
      : { context: normalize(joinPath(dir, String((raw.build as Record<string, unknown>).context ?? '.'))), dockerfile: String((raw.build as Record<string, unknown>).dockerfile ?? 'Dockerfile'), args: parseEnv((raw.build as Record<string, unknown>).args) };
    const health = raw.healthcheck as { test?: unknown } | undefined;
    const memory = String((raw.deploy as { resources?: { limits?: { memory?: string } } })?.resources?.limits?.memory ?? raw.mem_limit ?? '');
    return {
      name,
      image: raw.image ? String(raw.image) : undefined,
      build,
      ports,
      environment: env,
      volumes,
      networks,
      dependsOn: depends,
      healthcheck: health?.test ? asList(health.test).join(' ') : undefined,
      restart: String(raw.restart ?? 'no'),
      command: raw.command ? (Array.isArray(raw.command) ? raw.command.map(String) : String(raw.command).split(/\s+/)) : [],
      containerName: raw.container_name ? String(raw.container_name) : undefined,
      user: raw.user ? String(raw.user) : undefined,
      readOnly: raw.read_only === true,
      memoryMB: memory ? Number(/(\d+)/.exec(memory)?.[1] ?? 0) * (/g/i.test(memory) ? 1024 : 1) : null,
    };
  });
  return { name: project, dir, file, services, volumes: declaredVolumes, networks: declaredNetworks };
}

/** Orden de arranque respetando depends_on. */
function startOrder(project: ComposeProject): ComposeService[] {
  const ordered: ComposeService[] = [];
  const visit = (service: ComposeService, stack: Set<string>): void => {
    if (ordered.includes(service)) return;
    if (stack.has(service.name)) throw new DockerError(`dependency cycle detected: ${[...stack, service.name].join(' -> ')}`);
    stack.add(service.name);
    for (const dep of service.dependsOn) visit(project.services.find((s) => s.name === dep.name)!, stack);
    stack.delete(service.name);
    ordered.push(service);
  };
  for (const s of project.services) visit(s, new Set());
  return ordered;
}

export function containerName(project: ComposeProject, service: ComposeService): string {
  return service.containerName ?? `${project.name}-${service.name}-1`;
}

export function composeUp(fs: VirtualFileSystem, machine: MachineState, project: ComposeProject, options: { build: boolean; only?: string[] }, out: (line: string) => void): void {
  const state = dockerState(machine);
  const now = fs.now();
  const defaultNetwork = `${project.name}_default`;
  const usesDefault = project.services.some((s) => s.networks.length === 0);
  if (usesDefault && !state.networks[defaultNetwork]) {
    state.networks[defaultNetwork] = { driver: 'bridge', subnet: `172.${18 + Object.keys(state.networks).length}.0.0/16`, created: now };
    out(` ✔ Network ${defaultNetwork}  Created`);
  }
  for (const n of project.networks) {
    const full = `${project.name}_${n}`;
    if (!state.networks[full]) {
      state.networks[full] = { driver: 'bridge', subnet: `172.${18 + Object.keys(state.networks).length}.0.0/16`, created: now };
      out(` ✔ Network ${full}  Created`);
    }
  }
  for (const v of project.volumes) {
    const full = `${project.name}_${v}`;
    if (!state.volumes[full]) {
      state.volumes[full] = { created: now, driver: 'local', data: {} };
      out(` ✔ Volume "${full}"  Created`);
    }
  }
  for (const service of startOrder(project)) {
    if (options.only && options.only.length && !options.only.includes(service.name) && !project.services.some((s) => options.only!.includes(s.name) && s.dependsOn.some((d) => d.name === service.name))) continue;
    for (const dep of service.dependsOn) {
      if (dep.condition !== 'service_healthy') continue;
      const depContainer = state.containers.find((c) => c.name === containerName(project, project.services.find((s) => s.name === dep.name)!));
      if (depContainer?.health !== 'healthy') {
        throw new DockerError(`dependency failed to start: container ${depContainer?.name ?? dep.name} is unhealthy`);
      }
    }
    let imageRef = service.image ?? `${project.name}-${service.name}`;
    const name = containerName(project, service);
    const existing = state.containers.find((c) => c.name === name);
    if (service.build && (options.build || !state.images.some((i) => `${i.repository}:${i.tag}` === (imageRef.includes(':') ? imageRef : `${imageRef}:latest`)))) {
      const result = buildImage(fs, state, { contextDir: service.build.context, dockerfile: joinPath(service.build.context, service.build.dockerfile), tag: imageRef, noCache: false, buildArgs: service.build.args }, now);
      imageRef = `${result.image.repository}:${result.image.tag}`;
      out(` ✔ ${service.name}  Built`);
    }
    // Si la configuración no cambió y está en marcha, se deja como está.
    if (existing && existing.status === 'running' && !options.build) {
      out(` ✔ Container ${name}  Running`);
      continue;
    }
    if (existing) removeContainer(machine, existing);
    const container: Container = createContainer(fs, machine, {
      image: imageRef,
      name,
      detach: true,
      interactive: false,
      ports: service.ports,
      env: service.environment,
      mounts: service.volumes,
      networks: service.networks.length ? service.networks.map((n) => `${project.name}_${n}`) : [defaultNetwork],
      cmd: service.command,
      restart: service.restart,
      remove: false,
      user: service.user,
      readOnly: service.readOnly,
      memoryMB: service.memoryMB,
      compose: { project: project.name, service: service.name },
    }, out);
    startContainer(fs, machine, container);
    if (service.healthcheck && container.status === 'running') container.health = 'healthy';
    out(` ✔ Container ${name}  ${container.status === 'running' ? 'Started' : 'Exited'}`);
  }
}

export function composeDown(machine: MachineState, project: ComposeProject, removeVolumes: boolean, out: (line: string) => void): void {
  const state = dockerState(machine);
  for (const c of [...state.containers].filter((x) => x.compose?.project === project.name).reverse()) {
    removeContainer(machine, c);
    out(` ✔ Container ${c.name}  Removed`);
  }
  for (const n of [`${project.name}_default`, ...project.networks.map((x) => `${project.name}_${x}`)]) {
    if (state.networks[n]) {
      delete state.networks[n];
      out(` ✔ Network ${n}  Removed`);
    }
  }
  if (removeVolumes) {
    for (const v of project.volumes) {
      const full = `${project.name}_${v}`;
      if (state.volumes[full]) {
        delete state.volumes[full];
        out(` ✔ Volume ${full}  Removed`);
      }
    }
  }
}

export function composeContainers(machine: MachineState, project: ComposeProject): Container[] {
  return dockerState(machine).containers.filter((c) => c.compose?.project === project.name);
}

export { stopContainer };
