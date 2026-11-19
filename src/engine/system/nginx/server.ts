/**
 * nginx atendiendo peticiones: elige el bloque server y la location, y aplica
 * return, rewrite, allow/deny, limit_req, proxy_pass (con upstream y
 * balanceo), root/alias/try_files/index, error_page, gzip, expires y
 * add_header. Escribe access.log y error.log como el real.
 *
 * Usa la configuración CARGADA (la del último arranque o reload), no la del
 * disco: si editas y no recargas, nginx sigue con la anterior.
 */
import type { VirtualFileSystem } from '../../vfs/VirtualFileSystem';
import { joinPath, normalize } from '../../vfs/path';
import { hasAccess } from '../../vfs/permissions';
import type { FsNode } from '../../vfs/types';
import { groupsOf } from '../accounts';
import type { MachineState, Process } from '../machine';
import { httpRequest, STATUS_TEXT, type HttpRequest, type HttpResponse, type NetworkError } from '../network';
import { children, first, loadConfig, parseListen, type Directive, type LoadedConfig } from './config';

export const NGINX_VERSION = '1.24.0';

const MIME: Record<string, string> = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'application/javascript', json: 'application/json', png: 'image/png',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', ico: 'image/x-icon', txt: 'text/plain', xml: 'text/xml', woff2: 'font/woff2',
};

interface Runtime {
  roundRobin: Record<string, number>;
  rate: Record<string, { second: number; count: number }>;
}

function runtime(machine: MachineState): Runtime {
  const m = machine as MachineState & { nginxRuntime?: Runtime };
  m.nginxRuntime ??= { roundRobin: {}, rate: {} };
  return m.nginxRuntime;
}

/** Configuración que tiene cargada el nginx en marcha. */
export function activeConfig(fs: VirtualFileSystem, machine: MachineState): LoadedConfig | null {
  const files = machine.nginxFiles;
  if (!files) return null;
  try {
    return loadConfig(fs, files);
  } catch {
    return null;
  }
}

function nginxUser(config: LoadedConfig): string {
  return first(config.root, 'user')?.args[0] ?? 'www-data';
}

/** ¿Puede el usuario de nginx leer la ruta? (x en cada directorio + r en el archivo) */
function readableBy(fs: VirtualFileSystem, user: string, path: string): { node: FsNode | null; denied: boolean } {
  const identity = { user, groups: groupsOf(fs, user) };
  return fs.privileged(() => {
    const parts = normalize(path).split('/').filter(Boolean);
    let current = '/';
    for (const part of parts.slice(0, -1)) {
      current = joinPath(current, part);
      const dir = fs.tryStat(current);
      if (!dir) return { node: null, denied: false };
      if (!hasAccess(dir, identity, 'x')) return { node: null, denied: true };
    }
    const node = fs.tryStat(path);
    if (!node) return { node: null, denied: false };
    if (!hasAccess(node, identity, 'r')) return { node, denied: true };
    return { node, denied: false };
  });
}

function logLine(fs: VirtualFileSystem, path: string, line: string): void {
  if (path === 'off') return;
  fs.privileged(() => {
    try {
      fs.writeFile(path, line + '\n', true);
    } catch {
      // Si el directorio del log no existe, nginx no puede escribir: se ignora.
    }
  });
}

function nginxDate(ms: number): string {
  const d = new Date(ms);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}/${months[d.getUTCMonth()]}/${d.getUTCFullYear()}:${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;
}

function errorLogPath(server: Directive, http: Directive | undefined): string {
  return (first(server.block, 'error_log') ?? first(http?.block ?? null, 'error_log'))?.args[0] ?? '/var/log/nginx/error.log';
}

function errorLog(fs: VirtualFileSystem, server: Directive, http: Directive | undefined, level: string, message: string, request: HttpRequest): void {
  const d = new Date(fs.now());
  const stamp = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')} ${d.toISOString().slice(11, 19)}`;
  logLine(fs, errorLogPath(server, http), `${stamp} [${level}] 2481#2481: *17 ${message}, client: 127.0.0.1, server: ${first(server.block, 'server_name')?.args[0] ?? '_'}, request: "${request.method} ${request.path} HTTP/1.1", host: "${request.host}"`);
}

/** Elige el bloque server según el puerto y la cabecera Host. */
function selectServer(http: Directive, port: number, host: string): Directive | undefined {
  const servers = children(http.block, 'server').filter((s) => {
    const listens = children(s.block, 'listen');
    return listens.length === 0 ? port === 80 : listens.some((l) => parseListen(l.args).port === port);
  });
  const name = host.split(':')[0].toLowerCase();
  const exact = servers.find((s) => first(s.block, 'server_name')?.args.some((n) => n.toLowerCase() === name));
  if (exact) return exact;
  const wildcard = servers.find((s) => first(s.block, 'server_name')?.args.some((n) => n.startsWith('*.') && name.endsWith(n.slice(1))));
  if (wildcard) return wildcard;
  const regex = servers.find((s) => first(s.block, 'server_name')?.args.some((n) => n.startsWith('~') && new RegExp(n.slice(1)).test(name)));
  if (regex) return regex;
  return servers.find((s) => children(s.block, 'listen').some((l) => parseListen(l.args).port === port && parseListen(l.args).defaultServer)) ?? servers[0];
}

/** Algoritmo de selección de location de nginx. */
function selectLocation(server: Directive, path: string): { location: Directive | null; captures: string[] } {
  const locations = children(server.block, 'location');
  for (const loc of locations) if (loc.args[0] === '=' && loc.args[1] === path) return { location: loc, captures: [] };
  let best: Directive | null = null;
  let bestLength = -1;
  for (const loc of locations) {
    const [modifier, value] = loc.args.length === 2 ? loc.args : ['', loc.args[0]];
    if (modifier !== '' && modifier !== '^~') continue;
    if (path.startsWith(value) && value.length > bestLength) {
      best = loc;
      bestLength = value.length;
    }
  }
  if (best && best.args[0] === '^~') return { location: best, captures: [] };
  for (const loc of locations) {
    if (loc.args[0] !== '~' && loc.args[0] !== '~*') continue;
    try {
      const m = new RegExp(loc.args[1], loc.args[0] === '~*' ? 'i' : '').exec(path);
      if (m) return { location: loc, captures: m.slice(1) };
    } catch {
      continue;
    }
  }
  return { location: best, captures: [] };
}

/** Busca una directiva en la location, después en el server y después en http (herencia). */
function inherited(name: string, location: Directive | null, server: Directive, http: Directive | undefined): Directive[] {
  for (const scope of [location?.block ?? null, server.block, http?.block ?? null]) {
    const found = children(scope, name);
    if (found.length) return found;
  }
  return [];
}

function substitute(text: string, request: HttpRequest, uri: string, captures: string[]): string {
  return text
    .replace(/\$host/g, request.host.split(':')[0])
    .replace(/\$request_uri/g, request.path)
    .replace(/\$uri/g, uri)
    .replace(/\$scheme/g, request.https ? 'https' : 'http')
    .replace(/\$remote_addr/g, '127.0.0.1')
    .replace(/\$server_name/g, request.host.split(':')[0])
    .replace(/\$args/g, request.path.split('?')[1] ?? '')
    .replace(/\$(\d)/g, (_m, n: string) => captures[Number(n) - 1] ?? '');
}

/** ¿La IP pertenece a la red CIDR? */
function inCidr(ip: string, cidr: string): boolean {
  if (cidr === 'all') return true;
  const [net, bitsText] = cidr.split('/');
  const bits = bitsText === undefined ? 32 : Number(bitsText);
  const toInt = (x: string): number => x.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (toInt(ip) & mask) === (toInt(net) & mask);
}

function errorBody(status: number, serverTokens: boolean): string {
  const title = `${status} ${STATUS_TEXT[status] ?? ''}`.trim();
  return `<html>\r\n<head><title>${title}</title></head>\r\n<body>\r\n<center><h1>${title}</h1></center>\r\n<hr><center>${serverTokens ? `nginx/${NGINX_VERSION} (Ubuntu)` : 'nginx'}</center>\r\n</body>\r\n</html>\r\n`;
}

const MAX_INTERNAL_REDIRECTS = 5;

/** Atiende una petición. */
export function handleNginx(fs: VirtualFileSystem, incoming: HttpRequest, process: Process, machine: MachineState): HttpResponse | NetworkError {
  // El bloque server se elige por la cabecera Host (curl -H "Host: ..." la cambia).
  const request: HttpRequest = { ...incoming, host: incoming.headers.host ?? incoming.host };
  const config = activeConfig(fs, machine);
  if (!config) return { status: 500, headers: {}, body: 'nginx sin configuración cargada\n' };
  const http = first(config.root, 'http');
  if (!http) return { error: 'refused', message: `Failed to connect to ${request.host} port ${request.port}: Connection refused` };
  const server = selectServer(http, request.port, request.host);
  if (!server) return { error: 'refused', message: `Failed to connect to ${request.host} port ${request.port}: Connection refused` };

  const listenSsl = children(server.block, 'listen').some((l) => parseListen(l.args).port === request.port && parseListen(l.args).ssl);
  if (request.https && !listenSsl) return { error: 'ssl', message: `OpenSSL/3.0.13: error:0A00010B:SSL routines::wrong version number` };
  const tokensOff = inherited('server_tokens', null, server, http)[0]?.args[0] === 'off';
  if (!request.https && listenSsl) {
    return finish(fs, config, server, http, request, request.path, { status: 400, headers: { 'content-type': 'text/html' }, body: errorBody(400, !tokensOff).replace('400 Bad Request</h1>', '400 Bad Request</h1></center>\r\n<center>The plain HTTP request was sent to HTTPS port') }, null);
  }

  let path = request.path.split('?')[0];
  for (let hop = 0; hop < MAX_INTERNAL_REDIRECTS; hop++) {
    const result = processLocation(fs, config, server, http, request, path, machine, process);
    if ('internalRedirect' in result) {
      path = result.internalRedirect;
      continue;
    }
    return result;
  }
  return finish(fs, config, server, http, request, path, { status: 500, headers: { 'content-type': 'text/html' }, body: errorBody(500, !tokensOff) }, null);
}

type Outcome = HttpResponse | NetworkError | { internalRedirect: string };

function processLocation(fs: VirtualFileSystem, config: LoadedConfig, server: Directive, http: Directive | undefined, request: HttpRequest, path: string, machine: MachineState, process: Process): Outcome {
  const { location, captures } = selectLocation(server, path);
  const tokensOff = inherited('server_tokens', location, server, http)[0]?.args[0] === 'off';
  const fail = (status: number): Outcome => {
    // error_page 404 /404.html → redirección interna
    for (const page of inherited('error_page', location, server, http)) {
      const codes = page.args.slice(0, -1);
      if (codes.includes(String(status)) && page.args.at(-1) !== path) return { internalRedirect: page.args.at(-1)! };
    }
    return finish(fs, config, server, http, request, path, { status, headers: { 'content-type': 'text/html' }, body: errorBody(status, !tokensOff) }, location);
  };

  // 1) if ($host = ...) { return ...; }  (lo que genera certbot)
  for (const scope of [server.block, location?.block ?? null]) {
    for (const cond of children(scope, 'if')) {
      const m = /^\(?\$(\w+)\s*(!?=|~)\s*(.+?)\)?$/.exec(cond.args.join(' '));
      if (!m) continue;
      const values: Record<string, string> = { host: request.host.split(':')[0], request_method: request.method, scheme: request.https ? 'https' : 'http', uri: path };
      const actual = values[m[1]] ?? '';
      const expected = m[3].replace(/^"|"$/g, '');
      const matches = m[2] === '=' ? actual === expected : m[2] === '!=' ? actual !== expected : new RegExp(expected).test(actual);
      if (!matches) continue;
      const ret = first(cond.block, 'return');
      if (ret) return returnDirective(fs, config, server, http, request, path, ret, location, captures);
    }
  }

  // 2) rewrite (en server y luego en la location)
  for (const scope of [server.block, location?.block ?? null]) {
    for (const rw of children(scope, 'rewrite')) {
      let re: RegExp;
      try {
        re = new RegExp(rw.args[0]);
      } catch {
        continue;
      }
      const m = re.exec(path);
      if (!m) continue;
      const target = substitute(rw.args[1], request, path, m.slice(1));
      const flag = rw.args[2];
      if (flag === 'permanent' || flag === 'redirect' || /^https?:\/\//.test(target)) {
        const url = /^https?:\/\//.test(target) ? target : `${request.https ? 'https' : 'http'}://${request.host}${target}`;
        return finish(fs, config, server, http, request, path, { status: flag === 'permanent' ? 301 : 302, headers: { location: url, 'content-type': 'text/html' }, body: errorBody(flag === 'permanent' ? 301 : 302, !tokensOff) }, location);
      }
      if (target !== path) return { internalRedirect: target };
    }
  }

  // 3) control de acceso
  for (const rule of [...children(location?.block ?? null, 'allow'), ...children(location?.block ?? null, 'deny')].length ? (location?.block ?? []).filter((d) => d.name === 'allow' || d.name === 'deny') : (server.block ?? []).filter((d) => d.name === 'allow' || d.name === 'deny')) {
    if (inCidr('127.0.0.1', rule.args[0])) {
      if (rule.name === 'deny') {
        errorLog(fs, server, http, 'error', `access forbidden by rule`, request);
        return fail(403);
      }
      break;
    }
  }

  // 3b) autenticación básica (auth_basic + htpasswd)
  const auth = inherited('auth_basic', location, server, http)[0];
  if (auth && auth.args[0] !== 'off') {
    const userFile = inherited('auth_basic_user_file', location, server, http)[0]?.args[0];
    const header = request.headers.authorization ?? '';
    const decoded = header.startsWith('Basic ') ? atob(header.slice(6)) : '';
    const [user, ...rest] = decoded.split(':');
    const password = rest.join(':');
    const users = userFile ? fs.privileged(() => (fs.isFile(userFile) ? fs.readFile(userFile) : '')) : '';
    const valid = user && users.split('\n').some((l) => l.startsWith(user + ':') && l.endsWith(btoa(password).replace(/=/g, '').slice(0, 22)));
    if (!valid) {
      if (user) errorLog(fs, server, http, 'error', `user "${user}": password mismatch`, request);
      const response = fail(401);
      if ('headers' in response) response.headers['www-authenticate'] = `Basic realm="${auth.args[0]}"`;
      return response;
    }
  }

  // 4) limit_req
  const limit = inherited('limit_req', location, server, http)[0];
  if (limit && request.headers['user-agent'] !== 'validador') {
    const zoneName = /zone=([^\s]+)/.exec(limit.args.join(' '))?.[1];
    const zone = children(http?.block ?? null, 'limit_req_zone').find((z) => z.args.join(' ').includes(`zone=${zoneName}:`));
    const rate = Number(/rate=(\d+)r\/s/.exec(zone?.args.join(' ') ?? '')?.[1] ?? 10) || Number(/rate=(\d+)r\/m/.exec(zone?.args.join(' ') ?? '')?.[1] ?? 600) / 60;
    const burst = Number(/burst=(\d+)/.exec(limit.args.join(' '))?.[1] ?? 0);
    const rt = runtime(machine);
    const second = Math.floor(fs.now() / 1000);
    const counter = (rt.rate[zoneName ?? ''] ??= { second, count: 0 });
    if (counter.second !== second) {
      counter.second = second;
      counter.count = 0;
    }
    counter.count++;
    if (counter.count > rate + burst) {
      const status = Number(inherited('limit_req_status', location, server, http)[0]?.args[0] ?? 503);
      errorLog(fs, server, http, 'error', `limiting requests, excess: ${counter.count - rate}.000 by zone "${zoneName}"`, request);
      return fail(status);
    }
  }

  // 5) return
  const ret = first(location?.block ?? null, 'return') ?? first(server.block, 'return');
  if (ret) return returnDirective(fs, config, server, http, request, path, ret, location, captures);

  // 6) proxy_pass
  const proxy = first(location?.block ?? null, 'proxy_pass');
  if (proxy) return proxyPass(fs, config, server, http, request, path, proxy, location, machine, fail);

  // 7) archivos estáticos
  if (first(location?.block ?? null, 'stub_status')) {
    const active = 1 + Math.floor(Math.random() * 3);
    return finish(fs, config, server, http, request, path, { status: 200, headers: { 'content-type': 'text/plain' }, body: `Active connections: ${active}\nserver accepts handled requests\n 1024 1024 3121\nReading: 0 Writing: 1 Waiting: ${active - 1}\n` }, location);
  }
  return serveStatic(fs, config, server, http, request, path, location, captures, fail, process);
}

function returnDirective(fs: VirtualFileSystem, config: LoadedConfig, server: Directive, http: Directive | undefined, request: HttpRequest, path: string, ret: Directive, location: Directive | null, captures: string[]): Outcome {
  const tokensOff = inherited('server_tokens', location, server, http)[0]?.args[0] === 'off';
  if (/^https?:\/\//.test(ret.args[0])) {
    return finish(fs, config, server, http, request, path, { status: 302, headers: { location: substitute(ret.args[0], request, path, captures), 'content-type': 'text/html' }, body: errorBody(302, !tokensOff) }, location);
  }
  const status = Number(ret.args[0]);
  const value = ret.args[1] !== undefined ? substitute(ret.args[1], request, path, captures) : undefined;
  if (status >= 300 && status < 400) {
    return finish(fs, config, server, http, request, path, { status, headers: { location: value ?? '/', 'content-type': 'text/html' }, body: errorBody(status, !tokensOff) }, location);
  }
  if (value !== undefined) return finish(fs, config, server, http, request, path, { status, headers: { 'content-type': 'text/plain' }, body: value.endsWith('\n') ? value : value + '\n' }, location);
  return finish(fs, config, server, http, request, path, { status, headers: { 'content-type': 'text/html' }, body: status === 444 ? '' : errorBody(status, !tokensOff) }, location);
}

function proxyPass(fs: VirtualFileSystem, config: LoadedConfig, server: Directive, http: Directive | undefined, request: HttpRequest, path: string, proxy: Directive, location: Directive | null, machine: MachineState, fail: (status: number) => Outcome): Outcome {
  const m = /^(https?):\/\/([^/:]+)(?::(\d+))?(\/.*)?$/.exec(proxy.args[0]);
  if (!m) return fail(502);
  const [, , host, portText, uriPart] = m;
  const upstream = children(http?.block ?? null, 'upstream').find((u) => u.args[0] === host);
  // Si proxy_pass lleva ruta, sustituye el prefijo de la location; si no, pasa la URI original.
  const prefix = location && location.args.length === 1 ? location.args[0] : '';
  const forwardedPath = uriPart !== undefined ? uriPart + path.slice(prefix.length).replace(/^\//, uriPart.endsWith('/') ? '' : '/') : request.path;

  let targets: { host: string; port: number; backup: boolean }[];
  if (upstream) {
    const servers = children(upstream.block, 'server')
      .filter((s) => !s.args.includes('down'))
      .flatMap((s) => {
        const [h, p] = s.args[0].split(':');
        const weight = Number(/weight=(\d+)/.exec(s.args.join(' '))?.[1] ?? 1);
        return Array.from({ length: weight }, () => ({ host: h, port: Number(p ?? 80), backup: s.args.includes('backup') }));
      });
    const primary = servers.filter((s) => !s.backup);
    const rt = runtime(machine);
    let ordered: typeof primary;
    if (first(upstream.block, 'ip_hash')) ordered = primary;
    else if (first(upstream.block, 'least_conn')) {
      ordered = [...primary].sort((a, b) => (rt.roundRobin[`${upstream.args[0]}:${a.port}`] ?? 0) - (rt.roundRobin[`${upstream.args[0]}:${b.port}`] ?? 0));
    } else {
      const start = (rt.roundRobin[upstream.args[0]] ?? 0) % Math.max(1, primary.length);
      rt.roundRobin[upstream.args[0]] = start + 1;
      ordered = [...primary.slice(start), ...primary.slice(0, start)];
    }
    targets = [...ordered, ...servers.filter((s) => s.backup)];
  } else {
    targets = [{ host, port: Number(portText ?? (m[1] === 'https' ? 443 : 80)), backup: false }];
  }

  const headers: Record<string, string> = { ...request.headers, host: request.host };
  for (const h of inherited('proxy_set_header', location, server, http)) headers[h.args[0].toLowerCase()] = substitute(h.args[1], request, path, []);
  for (const target of targets) {
    const result = httpRequest(fs, { ...request, host: target.host, port: target.port, path: forwardedPath, headers });
    if ('error' in result) {
      errorLog(fs, server, http, 'error', `connect() failed (111: Connection refused) while connecting to upstream, upstream: "http://${target.host}:${target.port}${forwardedPath}"`, request);
      continue;
    }
    if (upstream && first(upstream.block, 'least_conn')) {
      const rt = runtime(machine);
      const key = `${upstream.args[0]}:${target.port}`;
      rt.roundRobin[key] = (rt.roundRobin[key] ?? 0) + 1;
    }
    return finish(fs, config, server, http, request, path, { ...result, headers: { ...result.headers } }, location);
  }
  return fail(502);
}

function serveStatic(fs: VirtualFileSystem, config: LoadedConfig, server: Directive, http: Directive | undefined, request: HttpRequest, path: string, location: Directive | null, captures: string[], fail: (status: number) => Outcome, _process: Process): Outcome {
  const aliasDirective = first(location?.block ?? null, 'alias');
  const root = inherited('root', location, server, http)[0]?.args[0] ?? '/usr/share/nginx/html';
  const user = nginxUser(config);
  const toFile = (uri: string): string => {
    if (aliasDirective && location) {
      const prefix = location.args.length === 1 ? location.args[0] : '';
      return normalize(aliasDirective.args[0] + '/' + uri.slice(prefix.length));
    }
    return normalize(root + '/' + uri);
  };
  const indexes = inherited('index', location, server, http)[0]?.args ?? ['index.html'];

  const tryUri = (uri: string): Outcome | 'missing' => {
    const file = toFile(uri);
    const { node, denied } = readableBy(fs, user, file);
    if (denied) {
      errorLog(fs, server, http, 'crit', `open() "${file}" failed (13: Permission denied)`, request);
      return fail(403);
    }
    if (!node) return 'missing';
    if (node.type === 'dir') {
      if (!uri.endsWith('/')) {
        return finish(fs, config, server, http, request, path, { status: 301, headers: { location: `${request.https ? 'https' : 'http'}://${request.host}${uri}/`, 'content-type': 'text/html' }, body: errorBody(301, true) }, location);
      }
      for (const index of indexes) {
        const indexed = readableBy(fs, user, joinPath(file, index));
        if (indexed.denied) {
          errorLog(fs, server, http, 'crit', `open() "${joinPath(file, index)}" failed (13: Permission denied)`, request);
          return fail(403);
        }
        if (indexed.node?.type === 'file') return fileResponse(fs, config, server, http, request, path, joinPath(file, index), indexed.node, location);
      }
      if (inherited('autoindex', location, server, http)[0]?.args[0] === 'on') {
        const entries = fs.privileged(() => fs.readDir(file)).map((n) => `<a href="${n.name}${n.type === 'dir' ? '/' : ''}">${n.name}${n.type === 'dir' ? '/' : ''}</a>`).join('\n');
        return finish(fs, config, server, http, request, path, { status: 200, headers: { 'content-type': 'text/html' }, body: `<html>\n<head><title>Index of ${uri}</title></head>\n<body>\n<h1>Index of ${uri}</h1><hr><pre><a href="../">../</a>\n${entries}\n</pre><hr></body>\n</html>\n` }, location);
      }
      errorLog(fs, server, http, 'error', `directory index of "${file}/" is forbidden`, request);
      return fail(403);
    }
    return fileResponse(fs, config, server, http, request, path, file, node, location);
  };

  const tryFiles = first(location?.block ?? null, 'try_files') ?? first(server.block, 'try_files');
  if (tryFiles) {
    const options = tryFiles.args.slice(0, -1);
    const fallback = tryFiles.args.at(-1)!;
    for (const option of options) {
      const uri = substitute(option, request, path, captures);
      const outcome = tryUri(uri);
      if (outcome !== 'missing') return outcome;
    }
    if (/^=\d{3}$/.test(fallback)) return fail(Number(fallback.slice(1)));
    return { internalRedirect: substitute(fallback, request, path, captures) };
  }
  const outcome = tryUri(path);
  if (outcome !== 'missing') return outcome;
  errorLog(fs, server, http, 'error', `open() "${toFile(path)}" failed (2: No such file or directory)`, request);
  return fail(404);
}

function fileResponse(fs: VirtualFileSystem, config: LoadedConfig, server: Directive, http: Directive | undefined, request: HttpRequest, path: string, file: string, node: FsNode, location: Directive | null): HttpResponse {
  const ext = file.split('.').at(-1)?.toLowerCase() ?? '';
  const body = node.type === 'file' ? node.content : '';
  return finish(fs, config, server, http, request, path, { status: 200, headers: { 'content-type': MIME[ext] ?? 'application/octet-stream', 'last-modified': new Date(node.mtime).toUTCString() }, body }, location);
}

/** Cabeceras finales (Server, gzip, expires, add_header) y log de acceso. */
function finish(fs: VirtualFileSystem, _config: LoadedConfig, server: Directive, http: Directive | undefined, request: HttpRequest, path: string, response: HttpResponse, location: Directive | null): HttpResponse {
  const tokensOff = inherited('server_tokens', location, server, http)[0]?.args[0] === 'off';
  const headers: Record<string, string> = { server: tokensOff ? 'nginx' : `nginx/${NGINX_VERSION} (Ubuntu)`, ...response.headers };
  const ok = response.status < 400;
  const gzipOn = inherited('gzip', location, server, http)[0]?.args[0] === 'on';
  const gzipTypes = ['text/html', ...(inherited('gzip_types', location, server, http)[0]?.args ?? [])];
  if (gzipOn && /gzip/.test(request.headers['accept-encoding'] ?? '') && gzipTypes.some((t) => (headers['content-type'] ?? '').startsWith(t))) {
    headers['content-encoding'] = 'gzip';
    if (inherited('gzip_vary', location, server, http)[0]?.args[0] === 'on') headers.vary = 'Accept-Encoding';
  }
  const expires = inherited('expires', location, server, http)[0];
  if (expires && ok) {
    const value = expires.args[0];
    const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400, y: 31_536_000 };
    const m = /^(\d+)([smhdy]?)$/.exec(value);
    const seconds = value === 'max' ? 315_360_000 : value === 'off' ? -1 : m ? Number(m[1]) * (units[m[2] || 's'] ?? 1) : -1;
    if (seconds >= 0) {
      headers.expires = new Date(fs.now() + seconds * 1000).toUTCString();
      headers['cache-control'] = `max-age=${seconds}`;
    }
  }
  for (const h of inherited('add_header', location, server, http)) {
    if (ok || h.args[2] === 'always') headers[h.args[0].toLowerCase()] = substitute(h.args[1], request, path, []);
  }
  const accessLog = inherited('access_log', null, server, http)[0]?.args[0] ?? '/var/log/nginx/access.log';
  const size = new TextEncoder().encode(response.body).length;
  // Las comprobaciones internas del juego no dejan rastro en los logs.
  if (request.headers['user-agent'] !== 'validador') logLine(fs, accessLog, `127.0.0.1 - - [${nginxDate(fs.now())}] "${request.method} ${request.path} HTTP/1.1" ${response.status} ${size} "-" "${request.headers['user-agent'] ?? 'curl/8.5.0'}"`);
  return { status: response.status, headers, body: response.body };
}
