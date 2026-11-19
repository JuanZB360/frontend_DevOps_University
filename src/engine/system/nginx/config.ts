/**
 * Configuración de nginx: análisis y validación (lo que hace `nginx -t`).
 *
 * Se lee /etc/nginx/nginx.conf siguiendo los `include` (con comodines) y se
 * construye un árbol de directivas. Los errores imitan los mensajes reales:
 *   nginx: [emerg] unknown directive "lisen" in /etc/nginx/sites-enabled/tienda:3
 */
import type { VirtualFileSystem } from '../../vfs/VirtualFileSystem';
import { basename, dirname, joinPath } from '../../vfs/path';

export interface Directive {
  name: string;
  args: string[];
  /** Hijos si es un bloque ({ ... }). */
  block: Directive[] | null;
  file: string;
  line: number;
}

export class NginxConfigError extends Error {
  readonly file: string;
  readonly line: number;

  constructor(message: string, file: string, line: number) {
    super(message);
    this.file = file;
    this.line = line;
  }

  /** Mensaje con el formato de nginx -t. */
  format(): string {
    return `nginx: [emerg] ${this.message} in ${this.file}:${this.line}`;
  }
}

/** Contextos donde puede aparecer cada directiva (simplificado de la documentación oficial). */
const CONTEXTS: Record<string, string[]> = {
  user: ['main'], worker_processes: ['main'], pid: ['main'], error_log: ['main', 'http', 'server', 'location'], include: ['*'],
  events: ['main'], worker_connections: ['events'], multi_accept: ['events'],
  http: ['main'], sendfile: ['http', 'server', 'location'], tcp_nopush: ['http', 'server', 'location'], types_hash_max_size: ['http'],
  default_type: ['http', 'server', 'location'], access_log: ['http', 'server', 'location'], gzip: ['http', 'server', 'location'],
  gzip_types: ['http', 'server', 'location'], gzip_comp_level: ['http', 'server', 'location'], gzip_min_length: ['http', 'server', 'location'], gzip_vary: ['http', 'server', 'location'],
  ssl_protocols: ['http', 'server'], ssl_prefer_server_ciphers: ['http', 'server'], ssl_ciphers: ['http', 'server'], keepalive_timeout: ['http', 'server', 'location'],
  server_tokens: ['http', 'server', 'location'], client_max_body_size: ['http', 'server', 'location'], types: ['http', 'server', 'location'],
  upstream: ['http'], server: ['http', 'upstream'], least_conn: ['upstream'], ip_hash: ['upstream'], keepalive: ['upstream'],
  listen: ['server'], server_name: ['server'], root: ['http', 'server', 'location'], alias: ['location'], index: ['http', 'server', 'location'],
  location: ['server', 'location'], try_files: ['server', 'location'], return: ['server', 'location', 'if'], rewrite: ['server', 'location', 'if'],
  proxy_pass: ['location', 'if'], proxy_set_header: ['http', 'server', 'location'], proxy_http_version: ['http', 'server', 'location'],
  proxy_read_timeout: ['http', 'server', 'location'], proxy_connect_timeout: ['http', 'server', 'location'], proxy_buffering: ['http', 'server', 'location'],
  proxy_cache_path: ['http'], proxy_cache: ['http', 'server', 'location'], proxy_cache_valid: ['http', 'server', 'location'],
  add_header: ['http', 'server', 'location', 'if'], expires: ['http', 'server', 'location', 'if'], error_page: ['http', 'server', 'location'],
  allow: ['http', 'server', 'location'], deny: ['http', 'server', 'location'], auth_basic: ['http', 'server', 'location'], auth_basic_user_file: ['http', 'server', 'location'],
  limit_req_zone: ['http'], limit_req: ['http', 'server', 'location'], limit_req_status: ['http', 'server', 'location'], limit_conn_zone: ['http'], limit_conn: ['http', 'server', 'location'],
  ssl_certificate: ['http', 'server'], ssl_certificate_key: ['http', 'server'], ssl_session_cache: ['http', 'server'], ssl_session_timeout: ['http', 'server'], ssl_dhparam: ['http', 'server'],
  if: ['server', 'location'], set: ['server', 'location', 'if'], autoindex: ['http', 'server', 'location'], charset: ['http', 'server', 'location'],
  log_format: ['http'], internal: ['location'], http2: ['http', 'server'], resolver: ['http', 'server', 'location'], stub_status: ['server', 'location'],
};

/** Directivas que admiten (o exigen) un número concreto de argumentos. */
const ARG_COUNT: Record<string, [number, number]> = {
  listen: [1, 6], server_name: [1, 20], root: [1, 1], alias: [1, 1], proxy_pass: [1, 1], try_files: [2, 10], return: [1, 2],
  worker_processes: [1, 1], gzip: [1, 1], server_tokens: [1, 1], expires: [1, 2], ssl_certificate: [1, 1], ssl_certificate_key: [1, 1],
  limit_req_zone: [3, 4], index: [1, 10], rewrite: [2, 3], add_header: [2, 3], error_page: [2, 10], location: [1, 2], upstream: [1, 1],
  proxy_set_header: [2, 2], allow: [1, 1], deny: [1, 1], include: [1, 1], keepalive_timeout: [1, 2], client_max_body_size: [1, 1],
};

const FLAGS_ON_OFF = new Set(['gzip', 'server_tokens', 'sendfile', 'tcp_nopush', 'autoindex', 'proxy_buffering', 'gzip_vary', 'multi_accept', 'ssl_prefer_server_ciphers', 'http2']);

/** Tokeniza un archivo de configuración de nginx. */
function tokenize(text: string, file: string): { value: string; line: number; quoted: boolean }[] {
  const tokens: { value: string; line: number; quoted: boolean }[] = [];
  let line = 1;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\n') {
      line++;
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '#') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '{' || ch === '}' || ch === ';') {
      tokens.push({ value: ch, line, quoted: false });
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let value = '';
      while (j < text.length && text[j] !== ch) {
        if (text[j] === '\\' && j + 1 < text.length) {
          value += text[j + 1];
          j += 2;
          continue;
        }
        if (text[j] === '\n') line++;
        value += text[j++];
      }
      if (j >= text.length) throw new NginxConfigError('unexpected end of file, expecting ";" or "}"', file, line);
      tokens.push({ value, line, quoted: true });
      i = j + 1;
      continue;
    }
    let value = '';
    while (i < text.length && !/[\s{};#]/.test(text[i])) {
      // Las variables ${x} pueden llevar llaves.
      if (text[i] === '$' && text[i + 1] === '{') {
        const end = text.indexOf('}', i);
        value += text.slice(i, end + 1);
        i = end + 1;
        continue;
      }
      value += text[i++];
    }
    tokens.push({ value, line, quoted: false });
  }
  return tokens;
}

export interface LoadedConfig {
  root: Directive[];
  /** Contenido de cada archivo leído (para nginx -T y para la configuración "en marcha"). */
  files: Record<string, string>;
}

/** Comodines de include: /etc/nginx/sites-enabled/* */
function expandInclude(fs: VirtualFileSystem, pattern: string, baseDir: string): string[] {
  const abs = pattern.startsWith('/') ? pattern : joinPath(baseDir, pattern);
  if (!/[*?]/.test(abs)) return fs.exists(abs) ? [abs] : [];
  const dir = dirname(abs);
  const re = new RegExp('^' + basename(abs).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
  if (!fs.isDirectory(dir)) return [];
  return fs.readDir(dir).filter((n) => re.test(n.name) && n.type !== 'dir').map((n) => joinPath(dir, n.name)).filter((p) => fs.isFile(p));
}

/**
 * Carga la configuración. `read` permite usar una copia guardada (la que tiene
 * el nginx en marcha) en lugar de los archivos actuales del disco.
 */
export function loadConfig(fs: VirtualFileSystem, read?: Record<string, string>): LoadedConfig {
  const files: Record<string, string> = {};
  const readFile = (path: string, line: number, from: string): string => {
    if (read) {
      if (read[path] === undefined) throw new NginxConfigError(`open() "${path}" failed (2: No such file or directory)`, from, line);
      return read[path];
    }
    try {
      return fs.privileged(() => fs.readFile(path));
    } catch {
      throw new NginxConfigError(`open() "${path}" failed (2: No such file or directory)`, from, line);
    }
  };
  const listInclude = (pattern: string): string[] => {
    if (read) {
      const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');
      return Object.keys(read).filter((p) => re.test(p)).sort();
    }
    return fs.privileged(() => expandInclude(fs, pattern, '/etc/nginx'));
  };

  const parseFile = (path: string, context: string, line: number, from: string, depth: number): Directive[] => {
    if (depth > 10) throw new NginxConfigError('too many nested includes', from, line);
    const text = readFile(path, line, from);
    files[path] = text;
    const tokens = tokenize(text, path);
    let pos = 0;
    const parseBlock = (ctx: string, closing: boolean): Directive[] => {
      const directives: Directive[] = [];
      while (pos < tokens.length) {
        const token = tokens[pos];
        if (token.value === '}' && !token.quoted) {
          if (!closing) throw new NginxConfigError('unexpected "}"', path, token.line);
          pos++;
          return directives;
        }
        if ((token.value === '{' || token.value === ';') && !token.quoted) throw new NginxConfigError(`unexpected "${token.value}"`, path, token.line);
        const name = token.value;
        const startLine = token.line;
        pos++;
        const args: string[] = [];
        while (pos < tokens.length && !(['{', ';', '}'].includes(tokens[pos].value) && !tokens[pos].quoted)) args.push(tokens[pos++].value);
        const end = tokens[pos];
        if (!end) throw new NginxConfigError('unexpected end of file, expecting ";" or "}"', path, tokens.at(-1)?.line ?? startLine);
        if (end.value === '}') throw new NginxConfigError(`unexpected "}"`, path, end.line);
        const isBlock = end.value === '{';
        pos++;

        // Dentro de types { } cada línea es "tipo/mime extensiones;", no una directiva.
        if (ctx === 'types') {
          if (isBlock) throw new NginxConfigError(`unexpected "{"`, path, startLine);
          directives.push({ name, args, block: null, file: path, line: startLine });
          continue;
        }
        const allowed = CONTEXTS[name];
        if (!allowed) throw new NginxConfigError(`unknown directive "${name}"`, path, startLine);
        if (!allowed.includes('*') && !allowed.includes(ctx)) throw new NginxConfigError(`"${name}" directive is not allowed here`, path, startLine);
        const count = ARG_COUNT[name];
        if (count && (args.length < count[0] || args.length > count[1])) throw new NginxConfigError(`invalid number of arguments in "${name}" directive`, path, startLine);
        if (FLAGS_ON_OFF.has(name) && args.length && !['on', 'off'].includes(args[0])) throw new NginxConfigError(`invalid value "${args[0]}" in "${name}" directive, it must be "on" or "off"`, path, startLine);
        const blockDirectives = new Set(['events', 'http', 'server', 'location', 'upstream', 'if', 'types']);
        if (blockDirectives.has(name) && !isBlock && !(name === 'server' && ctx === 'upstream')) throw new NginxConfigError(`directive "${name}" has no opening "{"`, path, startLine);
        if (!blockDirectives.has(name) && isBlock) throw new NginxConfigError(`directive "${name}" is not terminated by ";"`, path, startLine);

        if (name === 'include') {
          for (const included of listInclude(args[0])) directives.push(...parseFile(included, ctx, startLine, path, depth + 1));
          continue;
        }
        const childContext = name === 'server' && ctx === 'upstream' ? 'upstream-server' : name;
        const block = isBlock ? parseBlock(childContext, true) : null;
        directives.push({ name, args, block, file: path, line: startLine });
      }
      if (closing) throw new NginxConfigError('unexpected end of file, expecting "}"', path, tokens.at(-1)?.line ?? 1);
      return directives;
    };
    return parseBlock(context, false);
  };

  const root = parseFile('/etc/nginx/nginx.conf', 'main', 0, '/etc/nginx/nginx.conf', 0);
  return { root, files };
}

// ───────────────────────────── Validación semántica ─────────────────────────────

export function children(directives: Directive[] | null, name: string): Directive[] {
  return (directives ?? []).filter((d) => d.name === name);
}

export function first(directives: Directive[] | null, name: string): Directive | undefined {
  return (directives ?? []).find((d) => d.name === name);
}

export interface ListenSpec {
  port: number;
  ssl: boolean;
  defaultServer: boolean;
}

export function parseListen(args: string[]): ListenSpec {
  const address = args[0];
  const port = Number(/(\d+)$/.exec(address)?.[1] ?? 80);
  return { port, ssl: args.includes('ssl'), defaultServer: args.includes('default_server') };
}

/** Comprobaciones que nginx hace al cargar (además de la sintaxis). */
export function validate(fs: VirtualFileSystem, config: LoadedConfig): void {
  const http = first(config.root, 'http');
  if (!http) return;
  const upstreams = new Set(children(http.block, 'upstream').map((u) => u.args[0]));
  const zones = new Set(children(http.block, 'limit_req_zone').map((z) => /zone=([^:]+)/.exec(z.args.join(' '))?.[1]));
  const defaults = new Map<string, Directive>();
  const names = new Map<string, Directive>();
  for (const server of children(http.block, 'server')) {
    for (const listen of children(server.block, 'listen')) {
      const spec = parseListen(listen.args);
      if (spec.defaultServer) {
        const address = `${listen.args[0].startsWith('[') ? '[::]' : '0.0.0.0'}:${spec.port}`;
        if (defaults.has(address)) throw new NginxConfigError(`a duplicate default server for ${address}`, listen.file, listen.line);
        defaults.set(address, listen);
      }
      if (spec.ssl) {
        const cert = first(server.block, 'ssl_certificate') ?? first(http.block, 'ssl_certificate');
        if (!cert) throw new NginxConfigError(`no "ssl_certificate" is defined for the "listen ... ssl" directive`, listen.file, listen.line);
        for (const key of [cert, first(server.block, 'ssl_certificate_key') ?? first(http.block, 'ssl_certificate_key')]) {
          if (key && !fs.privileged(() => fs.exists(key.args[0]))) {
            throw new NginxConfigError(`cannot load certificate "${key.args[0]}": BIO_new_file() failed (SSL: error:80000002:system library::No such file or directory)`, key.file, key.line);
          }
        }
      }
      for (const name of first(server.block, 'server_name')?.args ?? []) {
        const key = `${name}:${spec.port}`;
        if (names.has(key) && name !== '_' && name !== '') {
          // nginx solo avisa (warn); se registra igualmente.
        }
        names.set(key, server);
      }
    }
    const walk = (directives: Directive[] | null): void => {
      for (const d of directives ?? []) {
        if (d.name === 'proxy_pass') {
          const url = d.args[0];
          const m = /^https?:\/\/([^/:]+)(:\d+)?/.exec(url);
          if (!m) throw new NginxConfigError(`invalid URL prefix in "${url}"`, d.file, d.line);
          const host = m[1];
          if (!m[2] && !upstreams.has(host) && !/^\d+\.\d+\.\d+\.\d+$/.test(host) && host !== 'localhost' && !host.startsWith('$')) {
            throw new NginxConfigError(`host not found in upstream "${host}"`, d.file, d.line);
          }
        }
        if (d.name === 'limit_req') {
          const zone = /zone=([^\s]+)/.exec(d.args.join(' '))?.[1];
          if (zone && !zones.has(zone)) throw new NginxConfigError(`zero size shared memory zone "${zone}"`, d.file, d.line);
        }
        if (d.name === 'return' && !/^\d{3}$/.test(d.args[0]) && !/^https?:\/\//.test(d.args[0])) {
          throw new NginxConfigError(`invalid return code "${d.args[0]}"`, d.file, d.line);
        }
        if (d.name === 'location' && d.block) walk(d.block);
      }
    };
    walk(server.block);
  }
}

/** Carga + valida. Devuelve los errores formateados (vacío = configuración correcta). */
export function testConfig(fs: VirtualFileSystem): { ok: true; config: LoadedConfig } | { ok: false; error: string } {
  try {
    const config = loadConfig(fs);
    validate(fs, config);
    return { ok: true, config };
  } catch (error) {
    if (error instanceof NginxConfigError) return { ok: false, error: error.format() };
    throw error;
  }
}

/** Puertos en los que escuchará nginx con esta configuración. */
export function listenPorts(config: LoadedConfig): number[] {
  const http = first(config.root, 'http');
  const ports = new Set<number>();
  for (const server of children(http?.block ?? null, 'server')) {
    const listens = children(server.block, 'listen');
    if (listens.length === 0) ports.add(80);
    for (const l of listens) ports.add(parseListen(l.args).port);
  }
  return [...ports].sort((a, b) => a - b);
}
