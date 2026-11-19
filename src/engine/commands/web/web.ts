/**
 * Comandos del módulo web:
 *   nginx     -t  -T  -s reload|stop|quit|reopen  -v  -V
 *   certbot   --nginx -d DOMINIO   certificates   renew [--dry-run]
 *   node      ejecuta una app (en segundo plano queda escuchando en su puerto)
 *   htpasswd  crea usuarios para auth_basic
 */
import { applyNginxConfig } from '../../system/nginx/package';
import { listenPorts, testConfig } from '../../system/nginx/config';
import { NGINX_VERSION } from '../../system/nginx/server';
import { addJournal, readMachine, spawnProcess, updateMachine } from '../../system/machine';
import { PUBLIC_IP, resolveHost } from '../../system/network';
import { ufwAllows } from '../security/firewall';
import { dirname } from '../../vfs/path';
import type { Command } from '../Command';
import { EXIT_USAGE, fail } from '../helpers';

export const nginxCommand: Command = {
  name: 'nginx',
  category: 'devops',
  summary: 'Servidor web: nginx -t comprueba la configuración, -s reload la aplica',
  package: 'nginx',
  execute(ctx) {
    const args = ctx.args;
    if (args.includes('-v')) {
      ctx.stderr.write(`nginx version: nginx/${NGINX_VERSION} (Ubuntu)\n`);
      return 0;
    }
    if (args.includes('-V')) {
      ctx.stderr.write(`nginx version: nginx/${NGINX_VERSION} (Ubuntu)\nbuilt with OpenSSL 3.0.13 30 Jan 2024\nTLS SNI support enabled\nconfigure arguments: --with-http_ssl_module --with-http_v2_module --with-http_stub_status_module --with-http_gzip_static_module\n`);
      return 0;
    }
    const isRoot = ctx.session.username === 'root';
    if (args.includes('-t') || args.includes('-T')) {
      const result = testConfig(ctx.fs);
      if (!isRoot) ctx.stderr.write(`nginx: [alert] could not open error log file: open() "/var/log/nginx/error.log" failed (13: Permission denied)\n`);
      if (!result.ok) {
        ctx.stderr.write(`${result.error}\nnginx: configuration file /etc/nginx/nginx.conf test failed\n`);
        return 1;
      }
      ctx.stderr.write('nginx: the configuration file /etc/nginx/nginx.conf syntax is ok\nnginx: configuration file /etc/nginx/nginx.conf test is successful\n');
      if (args.includes('-T')) {
        for (const [path, content] of Object.entries(result.config.files)) ctx.stdout.write(`# configuration file ${path}:\n${content}\n`);
      }
      return 0;
    }
    const sIndex = args.indexOf('-s');
    if (sIndex !== -1) {
      const signal = args[sIndex + 1];
      if (!isRoot) return fail(ctx, '[alert] kill(1234, 1) failed (1: Operation not permitted)');
      const machine = readMachine(ctx.fs);
      if (!machine.services.nginx?.active) {
        ctx.stderr.write('nginx: [error] invalid PID number "" in "/run/nginx.pid"\n');
        return 1;
      }
      if (signal === 'reload') {
        const result = testConfig(ctx.fs);
        if (!result.ok) {
          // Como el real: la configuración nueva se rechaza y sigue la anterior.
          ctx.stderr.write(`${result.error}\n`);
          return 1;
        }
        updateMachine(ctx.fs, (m) => {
          applyNginxConfig(m, result.config.files, listenPorts(result.config));
          addJournal(m, ctx.fs.now(), 'nginx', 'signal process started');
        });
        return 0;
      }
      if (signal === 'stop' || signal === 'quit') {
        updateMachine(ctx.fs, (m) => {
          m.processes = m.processes.filter((p) => p.service !== 'nginx');
          if (m.services.nginx) m.services.nginx.active = false;
        });
        return 0;
      }
      if (signal === 'reopen') return 0;
      return fail(ctx, `[emerg] invalid option: "-s ${signal ?? ''}"`, 1);
    }
    if (args.length === 0) {
      ctx.stderr.write('nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)\n\x1b[2m(nginx se gestiona como servicio: sudo systemctl start|restart|reload nginx)\x1b[0m\n');
      return 1;
    }
    return fail(ctx, `invalid option: "${args[0]}"`, 1);
  },
};

const OPTIONS_SSL = `# Generado por Certbot
ssl_session_cache shared:le_nginx_SSL:10m;
ssl_session_timeout 1440m;
ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers off;
`;

export const certbotCommand: Command = {
  name: 'certbot',
  category: 'devops',
  summary: "Certificados HTTPS gratuitos de Let's Encrypt",
  package: 'certbot',
  execute(ctx) {
    const args = ctx.args;
    const action = args.find((a) => !a.startsWith('-') && ['certificates', 'renew', 'certonly', 'delete', 'run'].includes(a)) ?? 'run';
    if (ctx.session.username !== 'root') {
      ctx.stderr.write('The following error was encountered:\n[Errno 13] Permission denied: \'/var/log/letsencrypt/.certbot.lock\'\nEither run as root, or set --config-dir, --work-dir, and --logs-dir to writeable paths.\n');
      return 1;
    }
    const live = '/etc/letsencrypt/live';
    if (action === 'certificates') {
      const domains = ctx.fs.isDirectory(live) ? ctx.fs.readDir(live).filter((n) => n.type === 'dir').map((n) => n.name) : [];
      ctx.stdout.write('- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -\n');
      if (domains.length === 0) ctx.stdout.write('No certificates found.\n');
      for (const d of domains) {
        const expiry = new Date(ctx.fs.now() + 89 * 86_400_000).toISOString().slice(0, 10);
        ctx.stdout.write(`Found the following certs:\n  Certificate Name: ${d}\n    Domains: ${d}\n    Expiry Date: ${expiry} 09:14:22+00:00 (VALID: 89 days)\n    Certificate Path: ${live}/${d}/fullchain.pem\n    Private Key Path: ${live}/${d}/privkey.pem\n`);
      }
      ctx.stdout.write('- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -\n');
      return 0;
    }
    if (action === 'renew') {
      const domains = ctx.fs.isDirectory(live) ? ctx.fs.readDir(live).filter((n) => n.type === 'dir').map((n) => n.name) : [];
      const dry = args.includes('--dry-run');
      ctx.stdout.write('Saving debug log to /var/log/letsencrypt/letsencrypt.log\n\n');
      for (const d of domains) ctx.stdout.write(`Processing /etc/letsencrypt/renewal/${d}.conf\n${dry ? `Simulating renewal of an existing certificate for ${d}\n` : 'Certificate not yet due for renewal\n'}`);
      ctx.stdout.write(dry ? `\nCongratulations, all simulated renewals succeeded:\n${domains.map((d) => `  ${live}/${d}/fullchain.pem (success)`).join('\n')}\n` : '\nNo renewals were attempted.\n');
      return 0;
    }
    if (!args.includes('--nginx') && action !== 'certonly') {
      ctx.stderr.write('Certbot doesn\'t know how to automatically configure the web server on this system.\n\x1b[2m(usa: sudo certbot --nginx -d tu.dominio)\x1b[0m\n');
      return 1;
    }
    const domains: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-d' || args[i] === '--domains') domains.push(...(args[++i] ?? '').split(','));
    }
    if (domains.length === 0) return fail(ctx, 'Please specify --domains, or --installer that will help in domain names autodiscovery', EXIT_USAGE);
    const machine = readMachine(ctx.fs);
    if (!machine.packages['python3-certbot-nginx'] || machine.packages['python3-certbot-nginx'].status !== 'installed') {
      ctx.stderr.write("The requested nginx plugin does not appear to be installed\n\x1b[2m(instálalo: sudo apt install python3-certbot-nginx)\x1b[0m\n");
      return 1;
    }
    if (!machine.services.nginx?.active) return fail(ctx, 'Could not bind TCP port 80 because it is already in use by another process... or nginx is not running.');
    ctx.stdout.write('Saving debug log to /var/log/letsencrypt/letsencrypt.log\nRequesting a certificate for ' + domains.join(' and ') + '\n');
    for (const domain of domains) {
      if (resolveHost(ctx.fs, domain) !== PUBLIC_IP) {
        ctx.stderr.write(`\nCertbot failed to authenticate some domains (authenticator: nginx). The Certificate Authority reported these problems:\n  Domain: ${domain}\n  Type:   dns\n  Detail: DNS problem: NXDOMAIN looking up A for ${domain} - check that a DNS record exists for this domain\n`);
        return 1;
      }
      if (!ufwAllows(machine, 80)) {
        ctx.stderr.write(`\nCertbot failed to authenticate some domains (authenticator: nginx). The Certificate Authority reported these problems:\n  Domain: ${domain}\n  Type:   connection\n  Detail: ${PUBLIC_IP}: Fetching http://${domain}/.well-known/acme-challenge/x: Timeout during connect (likely firewall problem)\n\x1b[2m(el cortafuegos bloquea el puerto 80: sudo ufw allow 'Nginx Full')\x1b[0m\n`);
        return 1;
      }
    }
    // Busca el archivo del sitio con ese server_name.
    const sites = ctx.fs.isDirectory('/etc/nginx/sites-enabled') ? ctx.fs.readDir('/etc/nginx/sites-enabled').map((n) => ctx.fs.realPath(`/etc/nginx/sites-enabled/${n.name}`)) : [];
    const main = domains[0];
    // El dominio debe aparecer como nombre completo (api.devops-u.com no vale para devops-u.com).
    const domainRe = `server_name[^;]*?(?<=\\s)${main.replace(/\./g, '\\.')}(?=[\\s;])`;
    const siteFile = sites.find((path) => new RegExp(domainRe).test(ctx.fs.readFile(path)));
    if (!siteFile) {
      ctx.stderr.write(`\nCould not automatically find a matching server block for ${main}. Set the \`server_name\` directive to use the Nginx installer.\n`);
      return 1;
    }
    const certDir = `${live}/${main}`;
    ctx.fs.mkdir(certDir, true);
    ctx.fs.writeFile(`${certDir}/fullchain.pem`, `-----BEGIN CERTIFICATE-----\nMIIF${main.replace(/\./g, '')}LetsEncryptR11\n-----END CERTIFICATE-----\n`);
    ctx.fs.writeFile(`${certDir}/privkey.pem`, '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----\n');
    ctx.fs.chmod(`${certDir}/privkey.pem`, 0o600);
    if (!ctx.fs.exists('/etc/letsencrypt/options-ssl-nginx.conf')) ctx.fs.writeFile('/etc/letsencrypt/options-ssl-nginx.conf', OPTIONS_SSL);
    ctx.stdout.write(`\nSuccessfully received certificate.\nCertificate is saved at: ${certDir}/fullchain.pem\nKey is saved at:         ${certDir}/privkey.pem\nThis certificate expires on ${new Date(ctx.fs.now() + 90 * 86_400_000).toISOString().slice(0, 10)}.\nCertbot has set up a scheduled task to automatically renew this certificate in the background.\n\nDeploying certificate\n`);

    if (action !== 'certonly') {
      const text = ctx.fs.readFile(siteFile);
      const redirect = !args.includes('--no-redirect');
      const sslLines = `\n    listen 443 ssl; # managed by Certbot\n    ssl_certificate ${certDir}/fullchain.pem; # managed by Certbot\n    ssl_certificate_key ${certDir}/privkey.pem; # managed by Certbot\n    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot\n`;
      // Inserta las líneas SSL justo después del server_name del dominio.
      const nameLine = new RegExp(`(${domainRe}[^;]*;)`);
      let updated = text.replace(nameLine, `$1${sslLines}`);
      if (redirect) {
        updated = updated.replace(/^(\s*)listen\s+(\[::\]:)?80( default_server)?;\s*\n/gm, '');
        updated += `\nserver {\n    if ($host = ${main}) {\n        return 301 https://$host$request_uri;\n    } # managed by Certbot\n\n    listen 80;\n    server_name ${domains.join(' ')};\n    return 404; # managed by Certbot\n}\n`;
      }
      ctx.fs.writeFile(siteFile, updated);
      ctx.stdout.write(`Successfully deployed certificate for ${main} to ${siteFile}\n${redirect ? `Congratulations! You have successfully enabled HTTPS on https://${main}\n` : ''}`);
      const result = testConfig(ctx.fs);
      if (result.ok) updateMachine(ctx.fs, (m) => applyNginxConfig(m, result.config.files, listenPorts(result.config)));
    }
    return 0;
  },
};

export const nodeCommand: Command = {
  name: 'node',
  category: 'devops',
  summary: 'Ejecuta aplicaciones JavaScript (Node.js)',
  package: 'nodejs',
  execute(ctx) {
    if (ctx.args.includes('-v') || ctx.args.includes('--version')) {
      ctx.stdout.write('v18.19.1\n');
      return 0;
    }
    const [script] = ctx.args.filter((a) => !a.startsWith('-'));
    if (!script) {
      ctx.stdout.write('Welcome to Node.js v18.19.1.\n\x1b[2m(el REPL interactivo no está disponible en el simulador)\x1b[0m\n');
      return 0;
    }
    const abs = ctx.resolve(script);
    let source: string;
    try {
      source = ctx.fs.readFile(abs);
    } catch {
      ctx.stderr.write(`node:internal/modules/cjs/loader:1080\n  throw err;\n  ^\n\nError: Cannot find module '${abs}'\n`);
      return 1;
    }
    const port = Number(ctx.session.getVar('PORT') ?? /(?:PORT\s*\|\|\s*|listen\(\s*)(\d{2,5})/.exec(source)?.[1] ?? NaN);
    if (Number.isNaN(port)) {
      const logs = [...source.matchAll(/console\.log\((['"`])(.*?)\1\)/g)].map((m) => m[2]);
      for (const l of logs) ctx.stdout.write(l + '\n');
      return 0;
    }
    const busy = readMachine(ctx.fs).processes.some((p) => p.ports?.includes(port));
    if (busy) {
      ctx.stderr.write(`Error: listen EADDRINUSE: address already in use :::${port}\n`);
      return 1;
    }
    if (!ctx.background) {
      ctx.stdout.write(`Servidor escuchando en http://localhost:${port}\n\x1b[2m(en primer plano bloquearía la terminal: lánzalo con & o como servicio de systemd)\x1b[0m\n`);
      return 0;
    }
    updateMachine(ctx.fs, (machine) => {
      const existing = machine.processes.find((p) => p.pid === ctx.backgroundPid);
      if (existing) {
        existing.command = `node ${abs}`;
        existing.ports = [port];
        existing.persistent = true;
        existing.rss = 45_000;
        existing.mem = 1.1;
      } else {
        spawnProcess(machine, ctx.fs.now(), { user: ctx.session.username, command: `node ${abs}`, cpu: 0.3, mem: 1.1, rss: 45_000, ports: [port], persistent: true, tty: 'pts/0' });
      }
    });
    ctx.stdout.write(`Servidor escuchando en http://localhost:${port}\n`);
    return 0;
  },
};

export const htpasswdCommand: Command = {
  name: 'htpasswd',
  category: 'devops',
  summary: 'Crea usuarios y contraseñas para auth_basic',
  package: 'apache2-utils',
  async execute(ctx) {
    const create = ctx.args.some((a) => /^-[a-zA-Z]*c/.test(a));
    const batch = ctx.args.some((a) => /^-[a-zA-Z]*b/.test(a));
    const operands = ctx.args.filter((a) => !a.startsWith('-'));
    const [file, user, inlinePassword] = operands;
    if (!file || !user) return fail(ctx, 'Usage:\n\thtpasswd [-cimBdpsDv] [-C cost] passwordfile username\n\thtpasswd -b[cmBdpsDv] [-C cost] passwordfile username password', 1);
    let password = batch ? inlinePassword : undefined;
    if (password === undefined) {
      password = (await ctx.terminal.readLine?.('New password: ', { secret: true })) ?? undefined;
      const again = (await ctx.terminal.readLine?.('Re-type new password: ', { secret: true })) ?? undefined;
      if (password === undefined || password !== again) return fail(ctx, 'password verification error', 3);
    }
    const abs = ctx.resolve(file);
    const existing = create || !ctx.fs.exists(abs) ? '' : ctx.fs.readFile(abs);
    if (!create && !ctx.fs.exists(abs)) return fail(ctx, `cannot modify file ${file}; use '-c' to create it`, 1);
    const lines = existing.split('\n').filter((l) => l && !l.startsWith(user + ':'));
    lines.push(`${user}:$apr1$devopsu$${btoa(password).replace(/=/g, '').slice(0, 22)}`);
    ctx.fs.mkdir(dirname(abs), true);
    ctx.fs.writeFile(abs, lines.join('\n') + '\n');
    ctx.stdout.write(`${existing ? 'Updating' : 'Adding'} password for user ${user}\n`);
    return 0;
  },
};
