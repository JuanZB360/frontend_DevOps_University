/**
 * Cortafuegos y protección:
 *   ufw            status enable disable default allow deny reject limit delete reset app
 *   iptables       -L -A -I -D -F -P (reglas de bajo nivel)
 *   fail2ban-client status / set JAIL banip|unbanip IP
 */
import { readMachine, updateMachine, addJournal, type MachineState, type UfwRule } from '../../system/machine';
import type { Command, CommandContext } from '../Command';
import { EXIT_USAGE, fail } from '../helpers';

const APP_PROFILES: Record<string, string> = {
  OpenSSH: '22/tcp',
  'Nginx HTTP': '80/tcp',
  'Nginx HTTPS': '443/tcp',
  'Nginx Full': '80,443/tcp',
  'Apache Full': '80,443/tcp',
};

const SERVICE_PORTS: Record<string, string> = { ssh: '22/tcp', http: '80/tcp', https: '443/tcp', mysql: '3306/tcp', postgresql: '5432/tcp', redis: '6379/tcp' };

function normalizeTarget(target: string): string {
  return APP_PROFILES[target] ? target : SERVICE_PORTS[target] ?? target;
}

function ruleText(rule: UfwRule): string {
  return `${rule.to} ${rule.action.toUpperCase()} ${rule.direction.toUpperCase()} ${rule.from}`;
}

/** ¿Los puertos de una regla incluyen este puerto? (para validar misiones) */
export function ruleCovers(rule: UfwRule, port: number): boolean {
  const spec = APP_PROFILES[rule.to] ?? rule.to;
  const [ports] = spec.split('/');
  return ports.split(',').some((p) => {
    if (p.includes(':')) {
      const [a, b] = p.split(':').map(Number);
      return port >= a && port <= b;
    }
    return Number(p) === port;
  });
}

/** ¿Está permitido el tráfico entrante a este puerto según ufw? */
export function ufwAllows(machine: MachineState, port: number, from = 'Anywhere'): boolean {
  if (!machine.firewall.ufwEnabled) return true;
  for (const rule of machine.firewall.rules) {
    if (rule.direction !== 'in' || !ruleCovers(rule, port)) continue;
    if (rule.from !== 'Anywhere' && rule.from !== from) continue;
    return rule.action === 'allow' || rule.action === 'limit';
  }
  return machine.firewall.defaultIncoming === 'allow';
}

function printStatus(ctx: CommandContext, machine: MachineState, mode: 'plain' | 'verbose' | 'numbered'): void {
  const fw = machine.firewall;
  ctx.stdout.write(`Status: ${fw.ufwEnabled ? 'active' : 'inactive'}\n`);
  if (!fw.ufwEnabled) return;
  if (mode === 'verbose') ctx.stdout.write(`Logging: on (low)\nDefault: ${fw.defaultIncoming} (incoming), ${fw.defaultOutgoing} (outgoing), disabled (routed)\nNew profiles: skip\n`);
  if (fw.rules.length === 0) return;
  ctx.stdout.write(`\n${mode === 'numbered' ? '     ' : ''}To                         Action      From\n${mode === 'numbered' ? '     ' : ''}--                         ------      ----\n`);
  fw.rules.forEach((rule, i) => {
    const action = `${rule.action.toUpperCase()}${mode === 'verbose' || rule.direction === 'out' ? ' ' + rule.direction.toUpperCase() : ''}`;
    ctx.stdout.write(`${mode === 'numbered' ? `[${String(i + 1).padStart(2)}] ` : ''}${rule.to.padEnd(26)} ${action.padEnd(11)} ${rule.from}\n`);
  });
}

export const ufwCommand: Command = {
  name: 'ufw',
  category: 'seguridad',
  summary: 'Cortafuegos sencillo (ufw allow 22/tcp, ufw enable, ufw status)',
  async execute(ctx) {
    const args = ctx.args.filter((a) => a !== '--force' && a !== '--dry-run');
    const force = ctx.args.includes('--force');
    const [action, ...rest] = args;
    if (!action) return fail(ctx, 'ERROR: not enough args', 1);
    if (ctx.session.username !== 'root' && action !== 'help' && action !== 'version') {
      ctx.stderr.write('ERROR: You need to be root to run this script\n');
      return 1;
    }
    let exitCode = 0;
    // enable pregunta antes de tocar nada.
    if (action === 'enable' && !force) {
      const machine = readMachine(ctx.fs);
      const sshAllowed = machine.firewall.rules.some((r) => r.direction === 'in' && (r.action === 'allow' || r.action === 'limit') && ruleCovers(r, 22));
      if (!sshAllowed) ctx.stderr.write('\x1b[1;33m⚠ No hay ninguna regla que permita SSH (22/tcp): en un servidor remoto te quedarías fuera.\x1b[0m\n');
      const answer = ctx.terminal.readLine ? await ctx.terminal.readLine('Command may disrupt existing ssh connections. Proceed with operation (y|n)? ') : 'y';
      if (answer?.trim().toLowerCase() !== 'y') {
        ctx.stdout.write('Aborted\n');
        return 1;
      }
    }
    if (action === 'reset' && !force) {
      const answer = ctx.terminal.readLine ? await ctx.terminal.readLine('Resetting all rules to installed defaults. Proceed with operation (y|n)? ') : 'y';
      if (answer?.trim().toLowerCase() !== 'y') {
        ctx.stdout.write('Aborted\n');
        return 1;
      }
    }
    updateMachine(ctx.fs, (machine) => {
      const fw = machine.firewall;
      const now = ctx.fs.now();
      switch (action) {
        case 'status':
          printStatus(ctx, machine, rest[0] === 'verbose' ? 'verbose' : rest[0] === 'numbered' ? 'numbered' : 'plain');
          break;
        case 'enable':
          fw.ufwEnabled = true;
          addJournal(machine, now, 'ufw', 'Firewall enabled');
          ctx.stdout.write('Firewall is active and enabled on system startup\n');
          break;
        case 'disable':
          fw.ufwEnabled = false;
          ctx.stdout.write('Firewall stopped and disabled on system startup\n');
          break;
        case 'reload':
          ctx.stdout.write(fw.ufwEnabled ? 'Firewall reloaded\n' : 'Firewall not enabled (skipping reload)\n');
          break;
        case 'reset':
          machine.firewall = { ...fw, ufwEnabled: false, rules: [], defaultIncoming: 'deny', defaultOutgoing: 'allow' };
          ctx.stdout.write('Backing up \'user.rules\' to \'/etc/ufw/user.rules.20241116_091422\'\n');
          break;
        case 'default': {
          const [policy, direction = 'incoming'] = rest;
          if (!['allow', 'deny', 'reject'].includes(policy) || !['incoming', 'outgoing', 'routed'].includes(direction)) {
            ctx.stderr.write('ERROR: Invalid syntax\n');
            exitCode = 1;
            break;
          }
          if (direction === 'incoming') fw.defaultIncoming = policy as 'allow';
          if (direction === 'outgoing') fw.defaultOutgoing = policy as 'allow';
          ctx.stdout.write(`Default ${direction} policy changed to '${policy}'\n(be sure to update your rules accordingly)\n`);
          break;
        }
        case 'allow': case 'deny': case 'reject': case 'limit': {
          let direction: 'in' | 'out' = 'in';
          let words = [...rest];
          if (words[0] === 'in' || words[0] === 'out') {
            direction = words[0];
            words = words.slice(1);
          }
          let from = 'Anywhere';
          let to: string | null = null;
          if (words[0] === 'from') {
            from = words[1] ?? 'Anywhere';
            if (from === 'any') from = 'Anywhere';
            const portIndex = words.indexOf('port');
            const proto = words.indexOf('proto') !== -1 ? words[words.indexOf('proto') + 1] : null;
            to = portIndex !== -1 ? `${words[portIndex + 1]}${proto ? '/' + proto : ''}` : 'Anywhere';
          } else if (words[0]) {
            to = normalizeTarget(words[0]);
          }
          if (!to || (!APP_PROFILES[to] && to !== 'Anywhere' && !/^\d+(:\d+)?(,\d+)*(\/(tcp|udp))?$/.test(to))) {
            ctx.stderr.write(APP_PROFILES[words[0] ?? ''] === undefined && /^[A-Z]/.test(words[0] ?? '') ? `ERROR: Could not find a profile matching '${words[0]}'\n` : 'ERROR: Bad port\n');
            exitCode = 1;
            break;
          }
          const rule: UfwRule = { action: action as UfwRule['action'], to, from, direction };
          if (fw.rules.some((r) => ruleText(r) === ruleText(rule))) {
            ctx.stdout.write('Skipping adding existing rule\n');
            break;
          }
          // Las reglas de bloqueo por IP se insertan al principio para que tengan prioridad.
          if (action !== 'allow' && from !== 'Anywhere') fw.rules.unshift(rule);
          else fw.rules.push(rule);
          ctx.stdout.write(fw.ufwEnabled ? 'Rule added\n' : 'Rules updated\n');
          if (!fw.ufwEnabled) ctx.stdout.write('\x1b[2m(las reglas se aplican cuando actives el cortafuegos: sudo ufw enable)\x1b[0m\n');
          break;
        }
        case 'delete': {
          if (/^\d+$/.test(rest[0] ?? '')) {
            const index = Number(rest[0]) - 1;
            if (!fw.rules[index]) {
              ctx.stderr.write('ERROR: Could not find rule\n');
              exitCode = 1;
              break;
            }
            fw.rules.splice(index, 1);
            ctx.stdout.write('Rule deleted\n');
            break;
          }
          const [act, target] = rest;
          const before = fw.rules.length;
          fw.rules = fw.rules.filter((r) => !(r.action === act && r.to === normalizeTarget(target ?? '')));
          if (fw.rules.length === before) {
            ctx.stderr.write('Could not delete non-existent rule\n');
            exitCode = 1;
          } else ctx.stdout.write('Rule deleted\n');
          break;
        }
        case 'app':
          if (rest[0] === 'list') ctx.stdout.write(`Available applications:\n${Object.keys(APP_PROFILES).filter((p) => p === 'OpenSSH' || machine.packages.nginx?.status === 'installed').map((p) => `  ${p}`).join('\n')}\n`);
          else if (rest[0] === 'info') ctx.stdout.write(`Profile: ${rest[1]}\nPorts:\n  ${APP_PROFILES[rest.slice(1).join(' ')] ?? '?'}\n`);
          break;
        default:
          ctx.stderr.write(`ERROR: Invalid syntax\n`);
          exitCode = 1;
      }
    });
    return exitCode;
  },
};

export const iptablesCommand: Command = {
  name: 'iptables',
  category: 'seguridad',
  summary: 'Reglas de cortafuegos de bajo nivel (iptables -L -n)',
  execute(ctx) {
    if (ctx.session.username !== 'root') {
      ctx.stderr.write('iptables v1.8.10 (nf_tables): Could not fetch rule set generation id: Permission denied (you must be root)\n');
      return 4;
    }
    const args = ctx.args;
    let exitCode = 0;
    updateMachine(ctx.fs, (machine) => {
      const fw = machine.firewall;
      if (args.includes('-L') || args.includes('--list') || args.some((a) => /^-[nv]*L/.test(a))) {
        const chain = args.find((a) => /^(INPUT|OUTPUT|FORWARD)$/.test(a));
        const chains = chain ? [chain] : ['INPUT', 'FORWARD', 'OUTPUT'];
        for (const c of chains) {
          ctx.stdout.write(`Chain ${c} (policy ACCEPT)\ntarget     prot opt source               destination\n`);
          if (c === 'INPUT' && fw.ufwEnabled) ctx.stdout.write('ufw-before-input  all  --  0.0.0.0/0            0.0.0.0/0\nufw-user-input  all  --  0.0.0.0/0            0.0.0.0/0\n');
          for (const rule of fw.iptables.filter((r) => r.startsWith(c + ' '))) {
            const src = /-s (\S+)/.exec(rule)?.[1] ?? '0.0.0.0/0';
            const target = /-j (\S+)/.exec(rule)?.[1] ?? 'ACCEPT';
            const proto = /-p (\S+)/.exec(rule)?.[1] ?? 'all';
            const port = /--dport (\d+)/.exec(rule)?.[1];
            ctx.stdout.write(`${target.padEnd(10)} ${proto.padEnd(4)} --  ${src.padEnd(20)} 0.0.0.0/0${port ? `            ${proto} dpt:${port}` : ''}\n`);
          }
          for (const ip of c === 'INPUT' ? Object.values(fw.banned).flat() : []) ctx.stdout.write(`REJECT     all  --  ${ip.padEnd(20)} 0.0.0.0/0            reject-with icmp-port-unreachable\n`);
          ctx.stdout.write('\n');
        }
        return;
      }
      const opIndex = args.findIndex((a) => ['-A', '-I', '-D', '--append', '--insert', '--delete'].includes(a));
      if (opIndex !== -1) {
        const op = args[opIndex];
        const chain = args[opIndex + 1];
        if (!/^(INPUT|OUTPUT|FORWARD)$/.test(chain ?? '')) {
          ctx.stderr.write(`iptables: Chain '${chain}' does not exist\n`);
          exitCode = 1;
          return;
        }
        const restArgs = args.filter((_, i) => i !== opIndex && i !== opIndex + 1 && !(op.startsWith('-I') && /^\d+$/.test(args[opIndex + 2] ?? '') && i === opIndex + 2));
        const rule = `${chain} ${restArgs.join(' ')}`;
        if (!/-j (ACCEPT|DROP|REJECT|LOG)/.test(rule)) {
          ctx.stderr.write('iptables v1.8.10 (nf_tables): no target specified (-j ACCEPT|DROP|REJECT)\n');
          exitCode = 2;
          return;
        }
        if (op === '-D' || op === '--delete') {
          const index = fw.iptables.indexOf(rule);
          if (index === -1) {
            ctx.stderr.write('iptables: Bad rule (does a matching rule exist in that chain?).\n');
            exitCode = 1;
          } else fw.iptables.splice(index, 1);
        } else if (op === '-I' || op === '--insert') fw.iptables.unshift(rule);
        else fw.iptables.push(rule);
        return;
      }
      if (args.includes('-F') || args.includes('--flush')) {
        fw.iptables = [];
        return;
      }
      if (args.includes('-P')) return;
      ctx.stderr.write("iptables v1.8.10 (nf_tables): no command specified\nTry `iptables -h' or 'iptables --help' for more information.\n");
      exitCode = 2;
    });
    return exitCode;
  },
};

export const fail2banCommand: Command = {
  name: 'fail2ban-client',
  category: 'seguridad',
  summary: 'Controla fail2ban (bloquea IPs que fallan contraseñas)',
  package: 'fail2ban',
  execute(ctx) {
    if (ctx.session.username !== 'root') return fail(ctx, 'ERROR  Permission denied to socket: /var/run/fail2ban/fail2ban.sock, (you must be root)', 255);
    const [action, jail, sub, ip] = ctx.args;
    let exitCode = 0;
    updateMachine(ctx.fs, (machine) => {
      if (!machine.services.fail2ban?.active) {
        ctx.stderr.write('ERROR  Failed to access socket path: /var/run/fail2ban/fail2ban.sock. Is fail2ban running?\n');
        exitCode = 255;
        return;
      }
      const banned = machine.firewall.banned;
      if (action === 'status' && !jail) {
        ctx.stdout.write('Status\n|- Number of jail:\t1\n`- Jail list:\tsshd\n');
        return;
      }
      if (jail !== 'sshd') {
        ctx.stderr.write(`ERROR  NOK: ('${jail ?? ''}',)\nSorry but the jail '${jail ?? ''}' does not exist\n`);
        exitCode = 255;
        return;
      }
      const list = (banned.sshd ??= []);
      if (action === 'status') {
        ctx.stdout.write(`Status for the jail: sshd\n|- Filter\n|  |- Currently failed:\t3\n|  |- Total failed:\t24\n|  \`- Journal matches:\t_SYSTEMD_UNIT=sshd.service + _COMM=sshd\n\`- Actions\n   |- Currently banned:\t${list.length}\n   |- Total banned:\t${list.length}\n   \`- Banned IP list:\t${list.join(' ')}\n`);
        return;
      }
      if (action === 'set' && (sub === 'banip' || sub === 'unbanip') && ip) {
        if (sub === 'banip') {
          if (!list.includes(ip)) list.push(ip);
          addJournal(machine, ctx.fs.now(), 'fail2ban', `[sshd] Ban ${ip}`, 5);
        } else banned.sshd = list.filter((x) => x !== ip);
        ctx.stdout.write('1\n');
        return;
      }
      ctx.stderr.write('ERROR  Invalid command\n');
      exitCode = EXIT_USAGE;
    });
    return exitCode;
  },
};
