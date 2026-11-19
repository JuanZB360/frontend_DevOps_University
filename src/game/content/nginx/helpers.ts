/**
 * Ayudantes para las misiones de Nginx.
 */
import { installFiles } from '../../../engine/commands/packages/apt';
import { listenPorts, testConfig } from '../../../engine/system/nginx/config';
import { applyNginxConfig } from '../../../engine/system/nginx/package';
import { findPackage } from '../../../engine/system/packages';
import { findService, startService } from '../../../engine/system/services';
import { httpRequest, type HttpResponse } from '../../../engine/system/network';
import type { MissionCheck, MissionWorld, ValidationContext } from '../../domain/curriculum';
import { aptReady, withMachine } from '../../missions/worldHelpers';

/** Instala (si hace falta) y arranca un paquete. */
export function ensurePackage(world: MissionWorld, name: string): void {
  aptReady(world);
  withMachine(world, (m) => {
    const pkg = findPackage(name)!;
    for (const dep of pkg.depends ?? []) if (m.packages[dep]?.status !== 'installed') installFiles(world.fs, m, findPackage(dep)!);
    if (m.packages[name]?.status !== 'installed') installFiles(world.fs, m, pkg);
    if (pkg.service && !m.services[pkg.service.name]?.active) {
      const info = findService(world.fs, m, pkg.service.name);
      if (info) startService(world.fs, m, info);
    }
  });
}

/** nginx instalado y en marcha con la configuración actual del disco. */
export function ensureNginx(world: MissionWorld): void {
  ensurePackage(world, 'nginx');
  reloadNginx(world);
}

/** Aplica la configuración del disco al nginx en marcha (como un reload correcto). */
export function reloadNginx(world: MissionWorld): void {
  const result = world.fs.privileged(() => testConfig(world.fs));
  if (result.ok) withMachine(world, (m) => applyNginxConfig(m, result.config.files, listenPorts(result.config)));
}

/** Escribe un sitio en sites-available y (opcionalmente) lo habilita. */
export function writeSite(world: MissionWorld, name: string, content: string, enable = true): void {
  world.fs.privileged(() => {
    world.fs.mkdir('/etc/nginx/sites-available', true);
    world.fs.writeFile(`/etc/nginx/sites-available/${name}`, content);
    const link = `/etc/nginx/sites-enabled/${name}`;
    if (enable && !world.fs.tryStat(link, false)) world.fs.symlink(`/etc/nginx/sites-available/${name}`, link);
    if (!enable && world.fs.tryStat(link, false)) world.fs.remove(link);
  });
}

/** Elimina un sitio (disponible y habilitado). */
export function removeSite(world: MissionWorld, name: string): void {
  world.fs.privileged(() => {
    for (const path of [`/etc/nginx/sites-enabled/${name}`, `/etc/nginx/sites-available/${name}`, `/etc/nginx/conf.d/${name}.conf`]) {
      if (world.fs.tryStat(path, false)) world.fs.remove(path);
    }
  });
}

/** Planta archivos como root (webs en /var/www, apps en /srv...). */
export function rootFiles(world: MissionWorld, files: Record<string, string>): void {
  world.fs.privileged(() => {
    for (const [path, content] of Object.entries(files)) {
      const dir = path.slice(0, path.lastIndexOf('/')) || '/';
      world.fs.mkdir(dir, true);
      if (!world.fs.exists(path) || world.resetting) world.fs.writeFile(path, content);
      // Permisos de una web normal (legible por el usuario de nginx).
      world.fs.chmod(dir, 0o755);
      world.fs.chmod(path, 0o644);
    }
  });
}

/** Lanza una app de Node "en segundo plano" escuchando en un puerto. */
export function ensureNodeApp(world: MissionWorld, script: string, port: number): void {
  ensurePackage(world, 'nodejs');
  rootFiles(world, { [script]: `// App de ejemplo\nconst PORT = process.env.PORT || ${port};\napp.listen(PORT);\n` });
  withMachine(world, (m) => {
    if (m.processes.some((p) => p.ports?.includes(port))) return;
    m.processes.push({ pid: m.nextPid++, ppid: 1, user: 'www-data', command: `node ${script}`, cpu: 0.4, mem: 1.2, rss: 46_000, state: 'S', nice: 0, start: world.fs.now(), tty: '?', ports: [port], persistent: true });
  });
}

/** Hace una petición HTTP desde la validación (como si fuera curl). */
export function request(ctx: ValidationContext, url: string, headers: Record<string, string> = {}): HttpResponse | null {
  const m = /^(https?):\/\/([^/:]+)(?::(\d+))?(\/.*)?$/.exec(url);
  if (!m) return null;
  const https = m[1] === 'https';
  const result = httpRequest(ctx.fs, { method: 'GET', host: m[2], port: m[3] ? Number(m[3]) : https ? 443 : 80, path: m[4] ?? '/', headers: { 'user-agent': 'validador', ...headers }, body: '', https });
  return 'error' in result ? null : result;
}

/** La URL responde y cumple la condición. */
export const responds = (url: string, predicate: (r: HttpResponse) => boolean, headers: Record<string, string> = {}): MissionCheck =>
  (ctx) => {
    const r = request(ctx, url, headers);
    return r !== null && predicate(r);
  };

/** La configuración del disco es válida (nginx -t pasaría). */
export const configValid: MissionCheck = (ctx) => ctx.fs.privileged(() => testConfig(ctx.fs).ok);
