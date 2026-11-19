/**
 * Redes:
 *   ip (a, r, link)  ping  ss / netstat  curl  wget  dig  nslookup  host  traceroute
 */
import { listeningSockets, readMachine } from '../../system/machine';
import { GATEWAY, httpRequest, isLocal, isReachable, LOCAL_IP, resolveHost, reverseLookup, STATUS_TEXT, type HttpResponse } from '../../system/network';
import { basename } from '../../vfs/path';
import type { Command, CommandContext } from '../Command';
import { EXIT_USAGE, fail, reportFsError } from '../helpers';
import { processName } from '../processes/processes';

export const ipCommand: Command = {
  name: 'ip',
  category: 'red',
  summary: 'Muestra y configura la red (ip a, ip r, ip link)',
  execute(ctx) {
    const args = ctx.args.filter((a) => !a.startsWith('-'));
    const brief = ctx.args.includes('-br') || ctx.args.includes('-brief');
    const [object = '', action = 'show'] = args;
    if (/^a(d(dr?)?)?$/.test(object) || object === 'address') {
      if (brief) {
        ctx.stdout.write(`lo               UNKNOWN        127.0.0.1/8 ::1/128\neth0             UP             ${LOCAL_IP}/24 fe80::5054:ff:fe12:3456/64\n`);
        return 0;
      }
      if (action !== 'show' && ctx.session.username !== 'root') return fail(ctx, 'RTNETLINK answers: Operation not permitted', 2);
      ctx.stdout.write(
        '1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000\n    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00\n    inet 127.0.0.1/8 scope host lo\n       valid_lft forever preferred_lft forever\n    inet6 ::1/128 scope host noprefixroute\n       valid_lft forever preferred_lft forever\n' +
        `2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000\n    link/ether 52:54:00:12:34:56 brd ff:ff:ff:ff:ff:ff\n    altname enp0s3\n    inet ${LOCAL_IP}/24 metric 100 brd 10.0.0.255 scope global dynamic eth0\n       valid_lft 85931sec preferred_lft 85931sec\n    inet6 fe80::5054:ff:fe12:3456/64 scope link\n       valid_lft forever preferred_lft forever\n`,
      );
      return 0;
    }
    if (/^r(o(u(te?)?)?)?$/.test(object)) {
      ctx.stdout.write(`default via ${GATEWAY} dev eth0 proto dhcp src ${LOCAL_IP} metric 100\n10.0.0.0/24 dev eth0 proto kernel scope link src ${LOCAL_IP} metric 100\n`);
      return 0;
    }
    if (/^l(i(nk?)?)?$/.test(object)) {
      ctx.stdout.write('1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000\n    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00\n2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP mode DEFAULT group default qlen 1000\n    link/ether 52:54:00:12:34:56 brd ff:ff:ff:ff:ff:ff\n');
      return 0;
    }
    ctx.stderr.write('Usage: ip [ OPTIONS ] OBJECT { COMMAND | help }\nwhere  OBJECT := { address | link | route | neigh | ... }\n');
    return object ? 1 : 255;
  },
};

export const pingCommand: Command = {
  name: 'ping',
  category: 'red',
  summary: 'Comprueba si un equipo responde por la red (-c número de paquetes)',
  async execute(ctx) {
    const cIndex = ctx.args.indexOf('-c');
    const count = cIndex !== -1 ? Number(ctx.args[cIndex + 1]) : /^-c\d+$/.test(ctx.args.find((a) => a.startsWith('-c')) ?? '') ? Number(ctx.args.find((a) => a.startsWith('-c'))!.slice(2)) : 4;
    const host = ctx.args.find((a, i) => !a.startsWith('-') && (cIndex === -1 || i !== cIndex + 1));
    if (!host) return fail(ctx, 'usage error: Destination address required', EXIT_USAGE);
    const ip = resolveHost(ctx.fs, host);
    if (!ip) return fail(ctx, `${host}: Temporary failure in name resolution`, 2);
    const shown = /^\d+\.\d+\.\d+\.\d+$/.test(host) ? ip : `${host} (${ip})`;
    ctx.stdout.write(`PING ${shown} 56(84) bytes of data.\n`);
    const reachable = isReachable(ip);
    const base = isLocal(ip) ? 0.03 : ip.startsWith('10.0.0.') ? 0.4 : 12 + (ip.charCodeAt(0) % 20);
    const times: number[] = [];
    for (let i = 1; i <= Math.min(count, 10); i++) {
      await new Promise((r) => setTimeout(r, 120));
      if (!reachable) continue;
      const t = +(base * (0.9 + Math.random() * 0.25)).toFixed(3);
      times.push(t);
      ctx.stdout.write(`64 bytes from ${reverseLookup(ip) && !isLocal(ip) ? `${reverseLookup(ip)} (${ip})` : ip}: icmp_seq=${i} ttl=${isLocal(ip) ? 64 : 57} time=${t} ms\n`);
    }
    const sent = Math.min(count, 10);
    const loss = reachable ? 0 : 100;
    ctx.stdout.write(`\n--- ${host} ping statistics ---\n${sent} packets transmitted, ${times.length} received, ${loss}% packet loss, time ${sent * 1001}ms\n`);
    if (times.length) ctx.stdout.write(`rtt min/avg/max/mdev = ${Math.min(...times).toFixed(3)}/${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(3)}/${Math.max(...times).toFixed(3)}/0.112 ms\n`);
    if (cIndex === -1 && ctx.stdout.isTTY) ctx.stderr.write('\x1b[2m(en Linux ping no para solo: usa -c 4 o pulsa Ctrl+C)\x1b[0m\n');
    return reachable ? 0 : 1;
  },
};

function createSs(name: 'ss' | 'netstat'): Command {
  return {
    name,
    category: 'red',
    summary: name === 'ss' ? 'Muestra conexiones y puertos en escucha (ss -tulpn)' : 'Versión antigua de ss (paquete net-tools)',
    package: name === 'netstat' ? 'net-tools' : undefined,
    execute(ctx) {
      const flags = ctx.args.filter((a) => a.startsWith('-')).join('');
      if (flags.includes('s') && name === 'ss' && !flags.includes('t')) {
        ctx.stdout.write('Total: 182\nTCP:   8 (estab 2, closed 1, orphaned 0, timewait 1)\n');
        return 0;
      }
      const machine = readMachine(ctx.fs);
      const showProcess = flags.includes('p');
      const numeric = flags.includes('n');
      const udp = flags.includes('u');
      const sockets = listeningSockets(machine).sort((a, b) => a.port - b.port);
      const portName = (p: number): string => (numeric ? String(p) : ({ 22: 'ssh', 80: 'http', 443: 'https', 3306: 'mysql', 5432: 'postgresql', 6379: 'redis' } as Record<number, string>)[p] ?? String(p));
      const owner = (pid: number, proc: string): string => (showProcess && ctx.session.username === 'root' ? ` users:(("${proc}",pid=${pid},fd=6))` : '');
      if (name === 'netstat') {
        ctx.stdout.write('Active Internet connections (only servers)\nProto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name\n');
        for (const { port, process } of sockets) ctx.stdout.write(`tcp        0      0 0.0.0.0:${String(port).padEnd(15)} 0.0.0.0:*               LISTEN      ${showProcess && ctx.session.username === 'root' ? `${process.pid}/${processName(process)}` : '-'}\n`);
        return 0;
      }
      ctx.stdout.write('Netid State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process\n');
      if (udp) ctx.stdout.write(`udp   UNCONN 0      0      127.0.0.53%lo:${numeric ? '53' : 'domain'}        0.0.0.0:*${owner(512, 'systemd-resolve')}\n`);
      for (const { port, process } of sockets) {
        ctx.stdout.write(`tcp   LISTEN 0      ${port === 22 ? 128 : 511}    ${('0.0.0.0:' + portName(port)).padEnd(19)} 0.0.0.0:*${owner(process.pid, processName(process))}\n`);
      }
      if (showProcess && ctx.session.username !== 'root' && sockets.length && ctx.stdout.isTTY) {
        ctx.stderr.write('\x1b[2m(la columna Process solo se ve con sudo: sudo ss -tulpn)\x1b[0m\n');
      }
      return 0;
    },
  };
}

export const ssCommand = createSs('ss');
export const netstatCommand = createSs('netstat');

function parseUrl(raw: string): { https: boolean; host: string; port: number; path: string } | null {
  const withScheme = /^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`;
  const m = /^(https?):\/\/([^/:]+)(?::(\d+))?(\/[^\s]*)?$/i.exec(withScheme);
  if (!m) return null;
  const https = m[1].toLowerCase() === 'https';
  return { https, host: m[2], port: m[3] ? Number(m[3]) : https ? 443 : 80, path: m[4] ?? '/' };
}

const CURL_ERRORS: Record<string, number> = { resolve: 6, refused: 7, timeout: 28, ssl: 60 };

/** Petición siguiendo (o no) redirecciones. */
function fetchUrl(ctx: CommandContext, url: string, method: string, headers: Record<string, string>, body: string, follow: boolean): { response: HttpResponse; url: string } | { error: string; code: number } {
  let current = url;
  for (let hop = 0; hop < 6; hop++) {
    const parsed = parseUrl(current);
    if (!parsed) return { error: `URL rejected: Bad hostname`, code: 3 };
    const result = httpRequest(ctx.fs, { method, host: parsed.host, port: parsed.port, path: parsed.path, headers, body, https: parsed.https });
    if ('error' in result) return { error: result.message, code: CURL_ERRORS[result.error] ?? 7 };
    if (follow && result.status >= 300 && result.status < 400 && result.headers.location) {
      current = result.headers.location.startsWith('http') ? result.headers.location : `${parsed.https ? 'https' : 'http'}://${parsed.host}${result.headers.location}`;
      continue;
    }
    return { response: result, url: current };
  }
  return { error: 'Maximum (5) redirects followed', code: 47 };
}

function headerBlock(response: HttpResponse): string {
  const lines = [`HTTP/1.1 ${response.status} ${STATUS_TEXT[response.status] ?? ''}`.trimEnd()];
  const headers = { date: new Date().toUTCString(), 'content-length': String(new TextEncoder().encode(response.body).length), ...response.headers };
  for (const [k, v] of Object.entries(headers)) lines.push(`${k.replace(/(^|-)\w/g, (c) => c.toUpperCase())}: ${v}`);
  return lines.join('\r\n') + '\r\n\r\n';
}

export const curlCommand: Command = {
  name: 'curl',
  category: 'red',
  summary: 'Hace peticiones HTTP (-I cabeceras, -o guardar, -L seguir, -X método)',
  package: 'curl',
  execute(ctx) {
    let method = 'GET';
    let output: string | null = null;
    let remoteName = false;
    let headOnly = false;
    let include = false;
    let follow = false;
    let silent = false;
    let verbose = false;
    let failOnError = false;
    let writeOut: string | null = null;
    let body = '';
    const headers: Record<string, string> = { 'user-agent': 'curl/8.5.0', accept: '*/*' };
    const urls: string[] = [];
    for (let i = 0; i < ctx.args.length; i++) {
      const arg = ctx.args[i];
      if (arg === '-X' || arg === '--request') method = ctx.args[++i] ?? 'GET';
      else if (arg === '-o' || arg === '--output') output = ctx.args[++i] ?? null;
      else if (arg === '-H' || arg === '--header') {
        const [k, ...v] = (ctx.args[++i] ?? '').split(':');
        headers[k.trim().toLowerCase()] = v.join(':').trim();
      } else if (arg === '-d' || arg === '--data' || arg === '--data-raw' || arg === '--json') {
        body = ctx.args[++i] ?? '';
        if (method === 'GET') method = 'POST';
        if (arg === '--json') headers['content-type'] = 'application/json';
      } else if (arg === '-w' || arg === '--write-out') writeOut = ctx.args[++i] ?? '';
      else if (arg === '-u' || arg === '--user') headers.authorization = `Basic ${btoa(ctx.args[++i] ?? '')}`;
      else if (arg === '--max-time' || arg === '-m' || arg === '--connect-timeout') i++;
      else if (arg.startsWith('-') && !arg.startsWith('--') && arg.length > 1) {
        for (const letter of arg.slice(1)) {
          if (letter === 'I') headOnly = true;
          else if (letter === 'i') include = true;
          else if (letter === 'L') follow = true;
          else if (letter === 's') silent = true;
          else if (letter === 'S') continue;
          else if (letter === 'v') verbose = true;
          else if (letter === 'k') continue;
          else if (letter === 'f') failOnError = true;
          else if (letter === 'O') remoteName = true;
          else return fail(ctx, `option -${letter}: is unknown\ncurl: try 'curl --help' or 'curl --manual' for more information`, 2);
        }
      } else if (arg === '--head') headOnly = true;
      else if (arg === '--location') follow = true;
      else if (arg === '--silent') silent = true;
      else if (arg === '--insecure') continue;
      else if (arg === '--fail') failOnError = true;
      else urls.push(arg);
    }
    if (urls.length === 0) return fail(ctx, "no URL specified\ncurl: try 'curl --help' or 'curl --manual' for more information", 2);
    if (headOnly) method = 'HEAD';
    let exitCode = 0;
    for (const url of urls) {
      const result = fetchUrl(ctx, url, method, headers, body, follow);
      if ('error' in result) {
        if (!silent || ctx.args.includes('-S') || ctx.args.some((a) => /^-[a-zA-Z]*S/.test(a))) ctx.stderr.write(`curl: (${result.code}) ${result.error}\n`);
        if (writeOut) ctx.stdout.write(writeOut.replace(/%\{http_code\}/g, '000').replace(/\\n/g, '\n'));
        exitCode = result.code;
        continue;
      }
      const { response } = result;
      if (verbose) {
        const parsed = parseUrl(url)!;
        ctx.stderr.write(`*   Trying ${resolveHost(ctx.fs, parsed.host)}:${parsed.port}...\n* Connected to ${parsed.host} port ${parsed.port}\n> ${method} ${parsed.path} HTTP/1.1\n> Host: ${parsed.host}\n> User-Agent: curl/8.5.0\n>\n< HTTP/1.1 ${response.status} ${STATUS_TEXT[response.status] ?? ''}\n`);
      }
      if (failOnError && response.status >= 400) {
        if (!silent) ctx.stderr.write(`curl: (22) The requested URL returned error: ${response.status}\n`);
        exitCode = 22;
        continue;
      }
      let text = '';
      if (headOnly) text = headerBlock(response);
      else {
        if (include) text += headerBlock(response);
        text += response.body;
      }
      const target = output ?? (remoteName ? basename(parseUrl(url)!.path) || 'index.html' : null);
      if (target) {
        try {
          ctx.fs.writeFile(ctx.resolve(target), text);
        } catch (error) {
          return reportFsError(ctx, error, target);
        }
        if (!silent && ctx.stdout.isTTY) ctx.stderr.write(`  % Total    % Received % Xferd  Average Speed   Time\n100  ${String(text.length).padStart(5)}  100  ${String(text.length).padStart(5)}    0     0   312k      0 --:--:--\n`);
      } else ctx.stdout.write(text);
      if (writeOut) ctx.stdout.write(writeOut.replace(/%\{http_code\}/g, String(response.status)).replace(/%\{content_type\}/g, response.headers['content-type'] ?? '').replace(/\\n/g, '\n'));
    }
    return exitCode;
  },
};

export const wgetCommand: Command = {
  name: 'wget',
  category: 'red',
  summary: 'Descarga archivos de Internet',
  package: 'wget',
  execute(ctx) {
    const oIndex = ctx.args.findIndex((a) => a === '-O' || a === '--output-document');
    const quiet = ctx.args.includes('-q');
    const url = ctx.args.find((a, i) => !a.startsWith('-') && (oIndex === -1 || i !== oIndex + 1));
    if (!url) return fail(ctx, 'missing URL\nUsage: wget [OPTION]... [URL]...', 1);
    const parsed = parseUrl(url);
    if (!parsed) return fail(ctx, `${url}: Invalid URL`, 1);
    const name = oIndex !== -1 ? ctx.args[oIndex + 1] : basename(parsed.path) || 'index.html';
    if (!quiet) ctx.stderr.write(`--${new Date().toISOString().slice(0, 19).replace('T', ' ')}--  ${url}\nResolving ${parsed.host} (${parsed.host})... ${resolveHost(ctx.fs, parsed.host) ?? 'failed'}\n`);
    const result = fetchUrl(ctx, url, 'GET', { 'user-agent': 'Wget/1.21.4' }, '', true);
    if ('error' in result) {
      ctx.stderr.write(result.code === 6 ? `wget: unable to resolve host address '${parsed.host}'\n` : `failed: ${result.error}.\n`);
      return 4;
    }
    if (result.response.status >= 400) {
      if (!quiet) ctx.stderr.write(`HTTP request sent, awaiting response... ${result.response.status} ${STATUS_TEXT[result.response.status] ?? ''}\nERROR ${result.response.status}: ${STATUS_TEXT[result.response.status] ?? ''}.\n`);
      return 8;
    }
    if (name === '-') {
      ctx.stdout.write(result.response.body);
      return 0;
    }
    try {
      ctx.fs.writeFile(ctx.resolve(name), result.response.body);
    } catch (error) {
      return reportFsError(ctx, error, name);
    }
    if (!quiet) ctx.stderr.write(`HTTP request sent, awaiting response... 200 OK\nLength: ${result.response.body.length} [${result.response.headers['content-type'] ?? 'text/plain'}]\nSaving to: ‘${name}’\n\n${name.padEnd(20)} 100%[===================>]   ${result.response.body.length}  --.-KB/s    in 0s\n\n‘${name}’ saved [${result.response.body.length}/${result.response.body.length}]\n`);
    return 0;
  },
};

export const digCommand: Command = {
  name: 'dig',
  category: 'red',
  summary: 'Consulta el DNS (dig dominio, +short solo la IP)',
  execute(ctx) {
    const short = ctx.args.includes('+short');
    const name = ctx.args.find((a) => !a.startsWith('+') && !a.startsWith('@') && !['A', 'AAAA', 'MX', 'NS', 'TXT', 'CNAME'].includes(a));
    if (!name) return fail(ctx, 'usage: dig [@server] name [type]', 1);
    const ip = resolveHost(ctx.fs, name);
    if (short) {
      if (ip) ctx.stdout.write(ip + '\n');
      return 0;
    }
    ctx.stdout.write(`\n; <<>> DiG 9.18.24-0ubuntu5-Ubuntu <<>> ${name}\n;; global options: +cmd\n;; Got answer:\n;; ->>HEADER<<- opcode: QUERY, status: ${ip ? 'NOERROR' : 'NXDOMAIN'}, id: 41853\n;; flags: qr rd ra; QUERY: 1, ANSWER: ${ip ? 1 : 0}, AUTHORITY: 0, ADDITIONAL: 1\n\n;; QUESTION SECTION:\n;${name}.\t\t\tIN\tA\n\n`);
    if (ip) ctx.stdout.write(`;; ANSWER SECTION:\n${name}.\t\t300\tIN\tA\t${ip}\n\n`);
    ctx.stdout.write(`;; Query time: 12 msec\n;; SERVER: 127.0.0.53#53(127.0.0.53) (UDP)\n;; WHEN: ${new Date().toUTCString()}\n;; MSG SIZE  rcvd: 56\n\n`);
    return 0;
  },
};

export const nslookupCommand: Command = {
  name: 'nslookup',
  category: 'red',
  summary: 'Consulta el DNS (forma clásica)',
  execute(ctx) {
    const name = ctx.args.find((a) => !a.startsWith('-'));
    if (!name) return fail(ctx, 'usage: nslookup name', 1);
    const ip = resolveHost(ctx.fs, name);
    ctx.stdout.write('Server:\t\t127.0.0.53\nAddress:\t127.0.0.53#53\n\n');
    if (!ip) {
      ctx.stdout.write(`** server can't find ${name}: NXDOMAIN\n\n`);
      return 1;
    }
    ctx.stdout.write(`Non-authoritative answer:\nName:\t${name}\nAddress: ${ip}\n\n`);
    return 0;
  },
};

export const hostCommand: Command = {
  name: 'host',
  category: 'red',
  summary: 'Traduce entre nombres e IPs',
  execute(ctx) {
    const name = ctx.args.find((a) => !a.startsWith('-'));
    if (!name) return fail(ctx, 'Usage: host [-aCdilrTvVw] [-c class] [-N ndots] [-t type] [-W time] hostname', 1);
    if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) {
      const rev = reverseLookup(name);
      if (!rev) {
        ctx.stdout.write(`Host ${name.split('.').reverse().join('.')}.in-addr.arpa. not found: 3(NXDOMAIN)\n`);
        return 1;
      }
      ctx.stdout.write(`${name.split('.').reverse().join('.')}.in-addr.arpa domain name pointer ${rev}.\n`);
      return 0;
    }
    const ip = resolveHost(ctx.fs, name);
    if (!ip) {
      ctx.stdout.write(`Host ${name} not found: 3(NXDOMAIN)\n`);
      return 1;
    }
    ctx.stdout.write(`${name} has address ${ip}\n`);
    return 0;
  },
};

export const tracerouteCommand: Command = {
  name: 'traceroute',
  category: 'red',
  summary: 'Muestra los saltos hasta un equipo',
  async execute(ctx) {
    const host = ctx.args.find((a) => !a.startsWith('-'));
    if (!host) return fail(ctx, 'Specify "host" missing argument.', 1);
    const ip = resolveHost(ctx.fs, host);
    if (!ip) return fail(ctx, `${host}: Name or service not known\nCannot handle "host" cmdline arg \`${host}' on position 1 (argc 1)`, 1);
    ctx.stdout.write(`traceroute to ${host} (${ip}), 30 hops max, 60 byte packets\n`);
    const hops = isLocal(ip) ? [ip] : ip.startsWith('10.0.0.') ? [ip] : [GATEWAY, '100.64.0.1', '72.14.215.85', '108.170.252.1', ip];
    for (const [i, hop] of hops.entries()) {
      await new Promise((r) => setTimeout(r, 120));
      if (!isReachable(ip) && i === hops.length - 1) {
        ctx.stdout.write(`${String(i + 1).padStart(2)}  * * *\n`);
        continue;
      }
      ctx.stdout.write(`${String(i + 1).padStart(2)}  ${reverseLookup(hop) ?? hop} (${hop})  ${(1 + i * 3.1).toFixed(3)} ms  ${(1.2 + i * 3).toFixed(3)} ms  ${(1.1 + i * 3.2).toFixed(3)} ms\n`);
    }
    return 0;
  },
};
