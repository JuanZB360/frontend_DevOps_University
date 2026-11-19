/**
 * Red simulada: interfaces, DNS, hosts remotos y peticiones HTTP.
 *
 * Los servicios locales responden por el puerto en el que escuchan. Cada
 * módulo (Nginx, Docker, bases de datos...) registra cómo responde su servicio
 * con `registerHttpHandler`.
 */
import type { VirtualFileSystem } from '../vfs/VirtualFileSystem';
import { updateMachine, type MachineState, type Process } from './machine';

export const LOCAL_IP = '10.0.0.10';
export const GATEWAY = '10.0.0.1';
export const PUBLIC_IP = '203.0.113.42';

export interface HttpRequest {
  method: string;
  host: string;
  port: number;
  path: string;
  headers: Record<string, string>;
  body: string;
  https: boolean;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export type NetworkError = { error: 'resolve' | 'refused' | 'timeout' | 'ssl'; message: string };

/** Hosts "de Internet" y de la red interna. */
const DNS: Record<string, string> = {
  localhost: '127.0.0.1',
  'devops-u': LOCAL_IP,
  'example.com': '93.184.215.14',
  'www.example.com': '93.184.215.14',
  'google.com': '142.250.184.14',
  'www.google.com': '142.250.184.4',
  'github.com': '140.82.121.4',
  'api.github.com': '140.82.121.6',
  'archive.ubuntu.com': '91.189.91.81',
  'security.ubuntu.com': '91.189.91.83',
  'ifconfig.me': '34.160.111.145',
  'httpbin.org': '54.243.106.191',
  'cloudflare.com': '104.16.132.229',
  'one.one.one.one': '1.1.1.1',
  'download.docker.com': '18.155.68.79',
  'registry-1.docker.io': '3.216.34.172',
  'hub.docker.com': '3.216.34.172',
  'deb.nodesource.com': '104.21.1.31',
  'releases.hashicorp.com': '151.101.1.183',
  'github-releases.githubusercontent.com': '185.199.110.133',
  'web01': '10.0.0.11',
  'web02': '10.0.0.12',
  'db01': '10.0.0.20',
  'backup01': '10.0.0.30',
  'monitor': '10.0.0.40',
  // Dominios del jugador: apuntan a la IP pública de este servidor.
  'devops-u.com': PUBLIC_IP,
  'www.devops-u.com': PUBLIC_IP,
  'tienda.devops-u.com': PUBLIC_IP,
  'www.tienda.devops-u.com': PUBLIC_IP,
  'api.devops-u.com': PUBLIC_IP,
  'blog.devops-u.com': PUBLIC_IP,
  'admin.devops-u.com': PUBLIC_IP,
  'grafana.devops-u.com': PUBLIC_IP,
};

/** Hosts que no responden (para practicar diagnósticos). */
const UNREACHABLE = new Set(['10.0.0.99', '192.168.1.200']);

export function resolveHost(fs: VirtualFileSystem, name: string): string | null {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) return name;
  // /etc/hosts tiene prioridad sobre el DNS, como en Linux.
  const hosts = fs.privileged(() => (fs.exists('/etc/hosts') ? fs.readFile('/etc/hosts') : ''));
  for (const line of hosts.split('\n')) {
    const [ip, ...names] = line.replace(/#.*/, '').trim().split(/\s+/);
    if (ip && names.includes(name)) return ip;
  }
  return DNS[name.toLowerCase()] ?? null;
}

export function reverseLookup(ip: string): string | null {
  return Object.entries(DNS).find(([, v]) => v === ip)?.[0] ?? null;
}

export function isLocal(ip: string): boolean {
  return ip.startsWith('127.') || ip === LOCAL_IP || ip === '0.0.0.0' || ip === PUBLIC_IP;
}

export function isReachable(ip: string): boolean {
  return !UNREACHABLE.has(ip);
}

export function knownHosts(): Record<string, string> {
  return { ...DNS };
}

// ─────────────────────────────── HTTP ───────────────────────────────

export type HttpHandler = (fs: VirtualFileSystem, request: HttpRequest, process: Process, machine: MachineState) => HttpResponse | NetworkError;

const handlers = new Map<string, HttpHandler>();

/** Registra cómo responde un servicio (por nombre de servicio o de programa). */
export function registerHttpHandler(service: string, handler: HttpHandler): void {
  handlers.set(service, handler);
}

/** Sitios remotos simulados. */
const remoteSites: { match: (host: string, path: string) => boolean; respond: (req: HttpRequest) => HttpResponse }[] = [];

export function registerRemoteSite(match: (host: string, path: string) => boolean, respond: (req: HttpRequest) => HttpResponse): void {
  remoteSites.push({ match, respond });
}

function html(title: string, body: string): string {
  return `<!doctype html>\n<html>\n<head>\n    <title>${title}</title>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

registerRemoteSite((h) => h === 'example.com' || h === 'www.example.com', () => ({
  status: 200,
  headers: { 'content-type': 'text/html; charset=UTF-8', server: 'ECAcc (nyd/D184)' },
  body: html('Example Domain', '<div>\n    <h1>Example Domain</h1>\n    <p>This domain is for use in illustrative examples in documents.</p>\n</div>'),
}));
registerRemoteSite((h) => h === 'ifconfig.me', () => ({ status: 200, headers: { 'content-type': 'text/plain' }, body: PUBLIC_IP }));
registerRemoteSite((h) => h === 'api.github.com', (req) => ({
  status: 200,
  headers: { 'content-type': 'application/json; charset=utf-8', server: 'github.com' },
  body: req.path.startsWith('/users/')
    ? JSON.stringify({ login: req.path.split('/')[2], type: 'User', public_repos: 42 }, null, 2) + '\n'
    : JSON.stringify({ current_user_url: 'https://api.github.com/user', rate_limit_url: 'https://api.github.com/rate_limit' }, null, 2) + '\n',
}));
registerRemoteSite((h) => h === 'httpbin.org', (req) => ({
  status: req.path.startsWith('/status/') ? Number(req.path.split('/')[2]) || 200 : 200,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ args: {}, headers: { Host: 'httpbin.org', 'User-Agent': req.headers['user-agent'] ?? 'curl/8.5.0' }, origin: PUBLIC_IP, url: `https://httpbin.org${req.path}`, method: req.method, data: req.body }, null, 2) + '\n',
}));
registerRemoteSite((h) => h === 'google.com' || h === 'www.google.com', (req): HttpResponse => (req.host === 'google.com'
  ? { status: 301, headers: { location: 'https://www.google.com/', 'content-type': 'text/html; charset=UTF-8' }, body: '<HTML><HEAD><TITLE>301 Moved</TITLE></HEAD><BODY>The document has moved <A HREF="https://www.google.com/">here</A>.</BODY></HTML>\n' }
  : { status: 200, headers: { 'content-type': 'text/html; charset=ISO-8859-1', server: 'gws' }, body: html('Google', '<p>Buscar</p>') }));
registerRemoteSite((h) => h === 'github.com', () => ({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8', server: 'GitHub.com' }, body: html('GitHub', '<h1>Let’s build from here</h1>') }));

/** Realiza una petición HTTP dentro del mundo simulado. */
export function httpRequest(fs: VirtualFileSystem, request: HttpRequest): HttpResponse | NetworkError {
  const ip = resolveHost(fs, request.host);
  if (!ip) return { error: 'resolve', message: `Could not resolve host: ${request.host}` };
  if (!isReachable(ip)) return { error: 'timeout', message: `Failed to connect to ${request.host} port ${request.port} after 10002 ms: Timeout was reached` };
  if (isLocal(ip)) {
    // Los servicios pueden guardar estado (turno del balanceo, límites de peticiones...).
    return updateMachine(fs, (machine) => {
      const process = machine.processes.find((p) => p.ports?.includes(request.port));
      if (!process) return { error: 'refused', message: `Failed to connect to ${request.host} port ${request.port} after 0 ms: Couldn't connect to server` } as NetworkError;
      const handler = handlers.get(process.service ?? '') ?? handlers.get(process.command.split(' ')[0].split('/').at(-1) ?? '') ?? defaultHandler;
      return handler(fs, request, process, machine);
    });
  }
  const site = remoteSites.find((s) => s.match(request.host, request.path));
  if (site) return site.respond(request);
  if (/^10\.0\.0\./.test(ip)) return { error: 'refused', message: `Failed to connect to ${request.host} port ${request.port} after 2 ms: Couldn't connect to server` };
  return { status: 200, headers: { 'content-type': 'text/html' }, body: html(request.host, `<h1>${request.host}</h1>`) };
}

/** Respuesta de un servicio sin manejador propio (una app que solo dice "OK"). */
const defaultHandler: HttpHandler = (_fs, request, process): HttpResponse => {
  if (process.service === 'ssh') return { status: 0, headers: {}, body: 'SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13\r\n' };
  return { status: 200, headers: { 'content-type': 'text/plain' }, body: `OK from ${process.command.split(' ')[0]} on port ${request.port}\n` };
};

export const STATUS_TEXT: Record<number, string> = {
  200: 'OK', 201: 'Created', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Not Allowed', 429: 'Too Many Requests',
  500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Time-out',
};
