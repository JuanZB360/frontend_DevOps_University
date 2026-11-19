/**
 * Paquetes del módulo web: nginx, certbot, nodejs y apache2-utils, y cómo
 * responden sus servicios por HTTP.
 */
import type { VirtualFileSystem } from '../../vfs/VirtualFileSystem';
import type { MachineState, Process } from '../machine';
import { registerHttpHandler, type HttpRequest, type HttpResponse } from '../network';
import { registerPackages } from '../packages';
import { listenPorts, testConfig } from './config';
import { handleNginx } from './server';

export const NGINX_CONF = `user www-data;
worker_processes auto;
pid /run/nginx.pid;
error_log /var/log/nginx/error.log;
include /etc/nginx/modules-enabled/*.conf;

events {
\tworker_connections 768;
}

http {
\t##
\t# Ajustes básicos
\t##
\tsendfile on;
\ttcp_nopush on;
\ttypes_hash_max_size 2048;
\t# server_tokens off;

\tinclude /etc/nginx/mime.types;
\tdefault_type application/octet-stream;

\t##
\t# SSL
\t##
\tssl_protocols TLSv1.2 TLSv1.3;
\tssl_prefer_server_ciphers on;

\t##
\t# Logs
\t##
\taccess_log /var/log/nginx/access.log;

\t##
\t# Compresión
\t##
\tgzip on;

\t##
\t# Sitios
\t##
\tinclude /etc/nginx/conf.d/*.conf;
\tinclude /etc/nginx/sites-enabled/*;
}
`;

export const NGINX_DEFAULT_SITE = `##
# Sitio por defecto. Copia este archivo para crear los tuyos:
#   /etc/nginx/sites-available/MI_SITIO  →  ln -s a /etc/nginx/sites-enabled/
##
server {
\tlisten 80 default_server;
\tlisten [::]:80 default_server;

\troot /var/www/html;

\t# Añade index.php si usas PHP
\tindex index.html index.htm index.nginx-debian.html;

\tserver_name _;

\tlocation / {
\t\t# Primero intenta servir la petición como archivo, luego como
\t\t# directorio, y si no existe, devuelve 404.
\t\ttry_files $uri $uri/ =404;
\t}
}
`;

const WELCOME = `<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
</head>
<body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed and
working. Further configuration is required.</p>
<p><em>Thank you for using nginx.</em></p>
</body>
</html>
`;

const MIME_TYPES = `types {
    text/html                html htm shtml;
    text/css                 css;
    application/javascript   js;
    application/json         json;
    image/png                png;
    image/jpeg               jpeg jpg;
    image/svg+xml            svg;
    image/x-icon             ico;
}
`;

/** nginx -t como comprobación previa al arranque; si va bien, carga la config. */
function nginxCheck(fs: VirtualFileSystem, machine: MachineState): string | null {
  const result = testConfig(fs);
  if (!result.ok) return `${result.error}\nnginx: configuration file /etc/nginx/nginx.conf test failed`;
  applyNginxConfig(machine, result.config.files, listenPorts(result.config));
  return null;
}

/** El nginx en marcha pasa a usar esta configuración (arranque o reload). */
export function applyNginxConfig(machine: MachineState, files: Record<string, string>, ports: number[]): void {
  machine.nginxFiles = files;
  const process = machine.processes.find((p) => p.service === 'nginx');
  if (process) process.ports = ports;
}

registerPackages(
  {
    name: 'nginx', version: '1.24.0-2ubuntu7', section: 'httpd', description: 'small, powerful, scalable web/proxy server', sizeKB: 1_400,
    binaries: ['nginx'], systemUser: 'www-data',
    dirs: [['/var/log/nginx', 0o755, 'root'], ['/etc/nginx/conf.d', 0o755, 'root'], ['/etc/nginx/snippets', 0o755, 'root'], ['/etc/nginx/modules-enabled', 0o755, 'root']],
    files: {
      '/etc/nginx/nginx.conf': NGINX_CONF,
      '/etc/nginx/mime.types': MIME_TYPES,
      '/etc/nginx/sites-available/default': NGINX_DEFAULT_SITE,
      '/etc/nginx/sites-enabled/default': '@symlink:/etc/nginx/sites-available/default',
      '/var/www/html/index.nginx-debian.html': WELCOME,
      '/var/log/nginx/access.log': '',
      '/var/log/nginx/error.log': '',
    },
    service: {
      name: 'nginx', description: 'A high performance web server and a reverse proxy server', command: 'nginx: master process /usr/sbin/nginx -g daemon on; master_process on;',
      user: 'root', ports: [80], memMB: 6, check: nginxCheck,
      portsFrom: (fs) => {
        const result = testConfig(fs);
        return result.ok ? listenPorts(result.config) : [80];
      },
    },
  },
  { name: 'certbot', version: '2.9.0-1', section: 'web', description: "automatically configure HTTPS using Let's Encrypt", sizeKB: 60, binaries: ['certbot'], depends: ['python3'] },
  { name: 'python3-certbot-nginx', version: '2.9.0-1', section: 'python', description: 'Nginx plugin for Certbot', sizeKB: 120, depends: ['certbot'] },
  { name: 'nodejs', version: '18.19.1+dfsg-6ubuntu5', section: 'javascript', description: 'evented I/O for V8 javascript - runtime executable', sizeKB: 1_100, binaries: ['node', 'npm'] },
  { name: 'apache2-utils', version: '2.4.58-1ubuntu8', section: 'httpd', description: 'Apache HTTP Server (utility programs for web servers): htpasswd, ab', sizeKB: 400, binaries: ['htpasswd', 'ab'] },
);

registerHttpHandler('nginx', handleNginx);

/**
 * Las apps de Node simuladas responden con JSON indicando su puerto, para que
 * se vea qué instancia atendió cada petición (balanceo de carga). Si el script
 * contiene la línea `// RESPUESTA: texto`, responden con ese texto.
 */
function nodeHandler(fs: VirtualFileSystem, request: HttpRequest, process: Process): HttpResponse {
  const script = process.command.split(/\s+/).find((a) => a.endsWith('.js'));
  const source = script ? fs.privileged(() => (fs.isFile(script) ? fs.readFile(script) : '')) : '';
  const custom = /\/\/ RESPUESTA: (.+)/.exec(source)?.[1];
  const port = process.ports?.[0] ?? 0;
  if (request.path.startsWith('/health')) return { status: 200, headers: { 'content-type': 'application/json', 'x-powered-by': 'Express' }, body: '{"estado":"ok"}\n' };
  const body = custom ? custom + '\n' : JSON.stringify({ servicio: script?.split('/').at(-2) ?? 'app', instancia: port, ruta: request.path, metodo: request.method, cliente: request.headers['x-real-ip'] ?? request.headers['x-forwarded-for'] ?? '127.0.0.1' }) + '\n';
  return { status: 200, headers: { 'content-type': custom ? 'text/plain' : 'application/json', 'x-powered-by': 'Express' }, body };
}

registerHttpHandler('node', nodeHandler);
