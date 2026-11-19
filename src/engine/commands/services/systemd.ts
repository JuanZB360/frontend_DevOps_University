/**
 * Servicios, logs y tareas programadas:
 *   systemctl  status start stop restart reload enable disable is-active is-enabled
 *              daemon-reload list-units list-unit-files list-timers cat
 *   service    forma antigua (service nginx restart)
 *   journalctl -u -n -p -f -k --since -b
 *   logger dmesg crontab logrotate
 */
import { readMachine, updateMachine, addJournal, type MachineState } from '../../system/machine';
import { customUnits, findService, startService, stopService, unitName, type ServiceInfo } from '../../system/services';
import { isFsError } from '../../vfs/errors';
import { basename } from '../../vfs/path';
import type { Command, CommandContext } from '../Command';
import { EXIT_USAGE, fail } from '../helpers';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function logDate(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')} ${d.toTimeString().slice(0, 8)}`;
}

function ago(ms: number, now: number): string {
  const s = Math.max(1, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}min ago`;
  return `${Math.floor(s / 86_400)} days ago`;
}

const ACCESS_DENIED = (action: string, unit: string): string =>
  `Failed to ${action} ${unit}.service: Access denied\nSee system logs and 'systemctl status ${unit}.service' for details.\n\x1b[2m(pista: gestionar servicios requiere permisos de administrador → sudo systemctl ${action} ${unit})\x1b[0m\n`;

/** Hash simple del contenido de una unidad (para detectar cambios sin daemon-reload). */
function hash(text: string): string {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return String(h);
}

/** Unidades propias cargadas en systemd (requieren daemon-reload tras crearlas o editarlas). */
function unitStatus(ctx: CommandContext, machine: MachineState, name: string): 'loaded' | 'changed' | 'not-loaded' | 'package' {
  const unit = customUnits(ctx.fs).find((u) => u.name === `${name}.service` || u.name === name);
  if (!unit) return 'package';
  const loaded = machine.loadedUnits?.[unit.name];
  if (loaded === undefined) return 'not-loaded';
  const content = ctx.fs.privileged(() => ctx.fs.readFile(unit.path));
  return loaded === hash(content) ? 'loaded' : 'changed';
}

function printStatus(ctx: CommandContext, machine: MachineState, info: ServiceInfo): number {
  const now = ctx.fs.now();
  const state = machine.services[info.name];
  const process = machine.processes.find((p) => p.service === info.name);
  const active = state?.active ?? false;
  const failed = !active && state?.failed;
  const dot = active ? '\x1b[1;32m●\x1b[0m' : failed ? '\x1b[1;31m×\x1b[0m' : '○';
  const path = info.kind === 'custom' ? info.unit.path : `/usr/lib/systemd/system/${info.name}.service`;
  const activeLine = active
    ? `\x1b[1;32mactive (running)\x1b[0m since ${DAYS[new Date(state!.since).getDay()]} ${new Date(state!.since).toISOString().slice(0, 19).replace('T', ' ')} UTC; ${ago(state!.since, now)}`
    : failed
      ? `\x1b[1;31mfailed\x1b[0m (Result: exit-code) since ${new Date(state!.since).toISOString().slice(0, 19).replace('T', ' ')} UTC; ${ago(state!.since, now)}`
      : 'inactive (dead)';
  ctx.stdout.write(`${dot} ${info.name}.service - ${info.description}\n`);
  ctx.stdout.write(`     Loaded: loaded (${path}; ${state?.enabled ? 'enabled' : 'disabled'}; preset: enabled)\n`);
  if (unitStatus(ctx, machine, info.name) === 'changed') ctx.stdout.write(`     Warning: The unit file changed on disk. Run 'systemctl daemon-reload' to reload units.\n`);
  ctx.stdout.write(`     Active: ${activeLine}\n`);
  if (failed) ctx.stdout.write(`    Process: ${state!.failed}\n`);
  if (process) {
    ctx.stdout.write(`   Main PID: ${process.pid} (${basename(process.command.split(' ')[0])})\n      Tasks: ${info.name === 'nginx' ? 3 : 1} (limit: 4558)\n     Memory: ${(process.rss / 1024).toFixed(1)}M\n        CPU: ${Math.round((now - process.start) / 3_600_000) + 18}ms\n     CGroup: /system.slice/${info.name}.service\n             └─${process.pid} "${process.command}"\n`);
  }
  const lines = machine.journal.filter((e) => e.unit === info.name || (e.unit === 'systemd' && e.message.includes(`${info.name}.service`))).slice(-6);
  if (lines.length) {
    ctx.stdout.write('\n');
    for (const e of lines) ctx.stdout.write(`${logDate(e.time)} ${ctx.session.hostname} ${e.unit === 'systemd' ? 'systemd[1]' : `${e.unit}[${process?.pid ?? 1}]`}: ${e.priority <= 3 ? `\x1b[1;31m${e.message}\x1b[0m` : e.message}\n`);
  }
  return active ? 0 : 3;
}

export const systemctlCommand: Command = {
  name: 'systemctl',
  category: 'servicios',
  summary: 'Controla los servicios del sistema (start, stop, status, enable...)',
  execute(ctx) {
    const now = ctx.fs.now();
    const nowFlag = ctx.args.includes('--now');
    const args = ctx.args.filter((a) => !a.startsWith('-'));
    const flags = ctx.args.filter((a) => a.startsWith('-'));
    const [action = 'list-units', ...units] = args;
    const isRoot = ctx.session.username === 'root';
    const privileged = ['start', 'stop', 'restart', 'reload', 'enable', 'disable', 'daemon-reload', 'reload-or-restart', 'try-restart', 'mask', 'unmask'];
    if (privileged.includes(action) && !isRoot) {
      ctx.stderr.write(action === 'daemon-reload' ? 'Failed to reload daemon: Access denied\n' : ACCESS_DENIED(action, unitName(units[0] ?? '')));
      return 1;
    }

    let exitCode = 0;
    updateMachine(ctx.fs, (machine) => {
      const lookup = (raw: string): ServiceInfo | null => {
        const name = unitName(raw);
        const info = findService(ctx.fs, machine, name);
        const status = unitStatus(ctx, machine, name);
        if (!info || status === 'not-loaded') {
          ctx.stderr.write(`Failed to ${action} ${name}.service: Unit ${name}.service not found.\n`);
          if (status === 'not-loaded') ctx.stderr.write(`\x1b[2m(pista: acabas de crear la unidad; systemd no la conoce hasta que ejecutes: sudo systemctl daemon-reload)\x1b[0m\n`);
          exitCode = action === 'status' ? 4 : 5;
          return null;
        }
        if (status === 'changed' && action !== 'status') {
          ctx.stderr.write(`Warning: The unit file, source configuration file or drop-ins of ${name}.service changed on disk. Run 'systemctl daemon-reload' to reload units.\n`);
        }
        return info;
      };
      const start = (info: ServiceInfo): void => {
        const error = startService(ctx.fs, machine, info);
        if (error) {
          ctx.stderr.write(error + '\n');
          exitCode = 1;
        }
      };

      switch (action) {
        case 'status': {
          if (units.length === 0) {
            const failed = Object.values(machine.services).filter((s) => !s.active && s.failed).length;
            ctx.stdout.write(`● ${ctx.session.hostname}\n    State: ${failed ? 'degraded' : 'running'}\n    Units: ${Object.keys(machine.services).length + 120} loaded\n     Jobs: 0 queued\n   Failed: ${failed} units\n    Since: ${new Date(machine.bootTime).toUTCString()}\n`);
            break;
          }
          for (const raw of units) {
            const info = lookup(raw);
            if (info) exitCode = Math.max(exitCode, printStatus(ctx, machine, info));
          }
          break;
        }
        case 'start': case 'restart': case 'reload': case 'reload-or-restart': case 'try-restart':
          for (const raw of units) {
            const info = lookup(raw);
            if (!info) continue;
            if (action === 'reload' && machine.services[info.name]?.active) {
              const error = info.kind === 'package' ? info.check?.(ctx.fs, machine) ?? null : null;
              if (error) {
                for (const line of error.split('\n')) addJournal(machine, now, info.name, line, 3);
                ctx.stderr.write(`Job for ${info.name}.service failed because the control process exited with error code.\nSee "systemctl status ${info.name}.service" and "journalctl -xeu ${info.name}.service" for details.\n`);
                exitCode = 1;
              } else addJournal(machine, now, 'systemd', `Reloaded ${info.name}.service - ${info.description}.`);
              continue;
            }
            if (action !== 'start') stopService(ctx.fs, machine, info.name);
            start(info);
          }
          break;
        case 'stop':
          for (const raw of units) {
            const info = lookup(raw);
            if (info) stopService(ctx.fs, machine, info.name);
          }
          break;
        case 'enable': case 'disable':
          for (const raw of units) {
            const info = lookup(raw);
            if (!info) continue;
            const state = (machine.services[info.name] ??= { active: false, enabled: false, since: now });
            const enable = action === 'enable';
            if (state.enabled !== enable) {
              if (enable) ctx.stderr.write(`Created symlink /etc/systemd/system/multi-user.target.wants/${info.name}.service → ${info.kind === 'custom' ? info.unit.path : `/usr/lib/systemd/system/${info.name}.service`}.\n`);
              else ctx.stderr.write(`Removed "/etc/systemd/system/multi-user.target.wants/${info.name}.service".\n`);
            }
            state.enabled = enable;
            if (nowFlag) {
              if (enable) start(info);
              else stopService(ctx.fs, machine, info.name);
            }
          }
          break;
        case 'is-active':
          for (const raw of units) {
            const state = machine.services[unitName(raw)];
            const text = state?.active ? 'active' : state?.failed ? 'failed' : 'inactive';
            ctx.stdout.write(text + '\n');
            if (!state?.active) exitCode = 3;
          }
          break;
        case 'is-enabled':
          for (const raw of units) {
            const state = machine.services[unitName(raw)];
            ctx.stdout.write((state?.enabled ? 'enabled' : 'disabled') + '\n');
            if (!state?.enabled) exitCode = 1;
          }
          break;
        case 'is-failed':
          for (const raw of units) {
            const state = machine.services[unitName(raw)];
            const failed = !state?.active && Boolean(state?.failed);
            ctx.stdout.write((failed ? 'failed' : state?.active ? 'active' : 'inactive') + '\n');
            if (!failed) exitCode = 1;
          }
          break;
        case 'daemon-reload':
          machine.loadedUnits = Object.fromEntries(customUnits(ctx.fs).map((u) => [u.name, hash(ctx.fs.privileged(() => ctx.fs.readFile(u.path)))]));
          for (const u of customUnits(ctx.fs)) for (const e of u.errors) addJournal(machine, now, 'systemd', e, 4);
          break;
        case 'list-units': case 'list-unit-files': {
          const failedOnly = flags.some((f) => f.includes('failed'));
          const runningOnly = flags.some((f) => f.includes('running'));
          ctx.stdout.write(action === 'list-units' ? '  UNIT                          LOAD   ACTIVE   SUB     DESCRIPTION\n' : 'UNIT FILE                        STATE    PRESET\n');
          const names = [...new Set([...Object.keys(machine.services), ...customUnits(ctx.fs).filter((u) => u.name.endsWith('.service')).map((u) => unitName(u.name))])].sort();
          let count = 0;
          for (const name of names) {
            const state = machine.services[name];
            const info = findService(ctx.fs, machine, name);
            if (failedOnly && !(state && !state.active && state.failed)) continue;
            if (runningOnly && !state?.active) continue;
            count++;
            if (action === 'list-unit-files') ctx.stdout.write(`${(name + '.service').padEnd(32)} ${(state?.enabled ? 'enabled' : 'disabled').padEnd(8)} enabled\n`);
            else {
              const active = state?.active ? 'active  ' : state?.failed ? '\x1b[1;31mfailed\x1b[0m  ' : 'inactive';
              const sub = state?.active ? 'running' : state?.failed ? 'failed ' : 'dead   ';
              ctx.stdout.write(`${state?.failed && !state.active ? '\x1b[1;31m●\x1b[0m' : ' '} ${(name + '.service').padEnd(29)} loaded ${active} ${sub} ${info?.description ?? name}\n`);
            }
          }
          ctx.stdout.write(`\n${count} ${action === 'list-units' ? 'loaded units listed' : 'unit files listed'}.\n`);
          break;
        }
        case 'list-timers': {
          ctx.stdout.write('NEXT                        LEFT     LAST                        PASSED  UNIT                         ACTIVATES\n');
          const timers: [string, string, string][] = [['logrotate.timer', 'logrotate.service', 'daily'], ['apt-daily.timer', 'apt-daily.service', 'daily']];
          for (const u of customUnits(ctx.fs)) {
            if (u.name.endsWith('.timer') && machine.services[u.name]?.active) timers.push([u.name, u.name.replace('.timer', '.service'), u.onCalendar ?? '']);
          }
          for (const [t, s, when] of timers) ctx.stdout.write(`${('(' + when + ')').padEnd(27)} -        -                           -       ${t.padEnd(28)} ${s}\n`);
          ctx.stdout.write(`\n${timers.length} timers listed.\n`);
          break;
        }
        case 'cat': {
          for (const raw of units) {
            const unit = customUnits(ctx.fs).find((u) => u.name === `${unitName(raw)}.service`);
            if (unit) ctx.stdout.write(`# ${unit.path}\n${ctx.fs.privileged(() => ctx.fs.readFile(unit.path))}`);
            else ctx.stdout.write(`# /usr/lib/systemd/system/${unitName(raw)}.service\n[Unit]\nDescription=${findService(ctx.fs, machine, raw)?.description ?? raw}\n\n[Service]\nExecStart=/usr/sbin/${unitName(raw)}\n\n[Install]\nWantedBy=multi-user.target\n`);
          }
          break;
        }
        case 'mask': case 'unmask':
          break;
        default:
          ctx.stderr.write(`Unknown command verb '${action}'.\n`);
          exitCode = 1;
      }
    });
    return exitCode;
  },
};

/** Activa los temporizadores (systemctl enable --now x.timer) como servicios "x-timer". */
export const serviceCommand: Command = {
  name: 'service',
  category: 'servicios',
  summary: 'Forma clásica de controlar servicios (service nginx restart)',
  async execute(ctx) {
    const [name, action] = ctx.args;
    if (!name || !action) return fail(ctx, 'Usage: service < option > | --status-all | [ service_name [ command | --full-restart ] ]', EXIT_USAGE);
    return ctx.shell.spawn(['systemctl', action, name]);
  },
};

const PRIORITIES: Record<string, number> = { emerg: 0, alert: 1, crit: 2, err: 3, warning: 4, notice: 5, info: 6, debug: 7 };

export const journalctlCommand: Command = {
  name: 'journalctl',
  category: 'servicios',
  summary: 'Lee el registro (journal) de systemd: -u servicio, -p err, -n 20',
  execute(ctx) {
    const machine = readMachine(ctx.fs);
    const now = ctx.fs.now();
    let entries = [...machine.journal].sort((a, b) => a.time - b.time);
    const value = (flag: string, long?: string): string | undefined => {
      const i = ctx.args.findIndex((a) => a === flag || (long !== undefined && a === long));
      if (i !== -1) return ctx.args[i + 1];
      const inline = ctx.args.find((a) => (long && a.startsWith(long + '=')) || (a.startsWith(flag) && a.length > flag.length && !a.startsWith('--')));
      return inline ? inline.replace(new RegExp(`^(${long ?? flag}=|${flag})`), '') : undefined;
    };
    const unit = value('-u', '--unit');
    if (unit) {
      const name = unitName(unit);
      entries = entries.filter((e) => e.unit === name || (e.unit === 'systemd' && e.message.includes(`${name}.service`)));
    }
    const priority = value('-p', '--priority');
    if (priority) {
      const max = PRIORITIES[priority] ?? Number(priority);
      entries = entries.filter((e) => e.priority <= max);
    }
    if (ctx.args.includes('-k') || ctx.args.includes('--dmesg')) entries = entries.filter((e) => e.unit === 'kernel');
    const since = value('--since', '--since');
    if (since) {
      const offsets: Record<string, number> = { today: now - (now % 86_400_000), yesterday: now - (now % 86_400_000) - 86_400_000 };
      const relative = /^(\d+)\s*(hour|hours|min|minutes|day|days) ago$/.exec(since);
      const limit = offsets[since] ?? (relative ? now - Number(relative[1]) * (relative[2].startsWith('h') ? 3_600_000 : relative[2].startsWith('m') ? 60_000 : 86_400_000) : Date.parse(since));
      if (!Number.isNaN(limit)) entries = entries.filter((e) => e.time >= limit);
    }
    const lines = value('-n', '--lines');
    if (lines) entries = entries.slice(-Number(lines));
    else if (ctx.args.includes('-e') || ctx.args.some((a) => /^-x?e/.test(a))) entries = entries.slice(-40);
    if (entries.length === 0) {
      ctx.stdout.write('-- No entries --\n');
      return 0;
    }
    for (const e of entries) {
      const pid = machine.processes.find((p) => p.service === e.unit)?.pid ?? 1;
      const source = e.unit === 'kernel' ? 'kernel' : e.unit === 'systemd' ? 'systemd[1]' : `${e.unit}[${pid}]`;
      const message = e.priority <= 3 && ctx.stdout.isTTY ? `\x1b[1;31m${e.message}\x1b[0m` : e.priority === 4 && ctx.stdout.isTTY ? `\x1b[1;33m${e.message}\x1b[0m` : e.message;
      ctx.stdout.write(`${logDate(e.time)} ${ctx.session.hostname} ${source}: ${message}\n`);
    }
    if (ctx.args.includes('-f') && ctx.stdout.isTTY) ctx.stderr.write('\x1b[2m(-f sigue el log en tiempo real; en el simulador se muestra lo que hay hasta ahora)\x1b[0m\n');
    return 0;
  },
};

export const loggerCommand: Command = {
  name: 'logger',
  category: 'servicios',
  summary: 'Escribe un mensaje en el log del sistema',
  execute(ctx) {
    const tIndex = ctx.args.indexOf('-t');
    const tag = tIndex !== -1 ? ctx.args[tIndex + 1] : ctx.session.username;
    const message = ctx.args.filter((_, i) => i !== tIndex && (tIndex === -1 || i !== tIndex + 1) && !ctx.args[i].startsWith('-')).join(' ') || (ctx.stdin ?? '').trim();
    const now = ctx.fs.now();
    updateMachine(ctx.fs, (machine) => addJournal(machine, now, tag, message, 5));
    ctx.fs.privileged(() => ctx.fs.writeFile('/var/log/syslog', `${logDate(now)} ${ctx.session.hostname} ${tag}: ${message}\n`, true));
    return 0;
  },
};

export const dmesgCommand: Command = {
  name: 'dmesg',
  category: 'servicios',
  summary: 'Muestra los mensajes del kernel (hardware, discos, memoria...)',
  execute(ctx) {
    if (ctx.session.username !== 'root') {
      ctx.stderr.write('dmesg: read kernel buffer failed: Operation not permitted\n');
      return 1;
    }
    const machine = readMachine(ctx.fs);
    const base = [
      '[    0.000000] Linux version 6.8.0-devops (buildd@devops-u) #1 SMP PREEMPT_DYNAMIC',
      '[    0.004311] DMI: QEMU Standard PC (Q35 + ICH9, 2009)',
      '[    1.208311] sd 0:0:0:0: [sda] 41943040 512-byte logical blocks: (21.5 GB/20.0 GiB)',
      '[    1.208502] sd 1:0:0:0: [sdb] 104857600 512-byte logical blocks: (53.7 GB/50.0 GiB)',
      '[    2.511020] EXT4-fs (sda1): mounted filesystem with ordered data mode. Quota mode: none.',
    ];
    const kernel = machine.journal.filter((e) => e.unit === 'kernel').slice(1).map((e, i) => `[${String(86_000 + i * 1311).padStart(5)}.${String(100000 + i).slice(1)}] ${e.message}`);
    const human = ctx.args.includes('-T') || ctx.args.includes('-H');
    for (const line of [...base, ...kernel]) ctx.stdout.write((human ? line.replace(/^\[[^\]]+\]/, `[${new Date(machine.bootTime).toUTCString().slice(0, 25)}]`) : line) + '\n');
    return 0;
  },
};

// ─────────────────────────────── cron ───────────────────────────────

const FIELD_RANGES: [string, number, number][] = [['minute', 0, 59], ['hour', 0, 23], ['day-of-month', 1, 31], ['month', 1, 12], ['day-of-week', 0, 7]];

/** Valida una línea de crontab de usuario. Devuelve el error o null. */
export function validateCronLine(line: string, system = false): string | null {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#') || /^[A-Z_]+=/.test(trimmed)) return null;
  if (trimmed.startsWith('@')) {
    const [special, ...rest] = trimmed.split(/\s+/);
    if (!['@reboot', '@yearly', '@annually', '@monthly', '@weekly', '@daily', '@midnight', '@hourly'].includes(special)) return `bad time specifier '${special}'`;
    if (rest.length < (system ? 2 : 1)) return 'missing command';
    return null;
  }
  const fields = trimmed.split(/\s+/);
  if (fields.length < (system ? 7 : 6)) return fields.length < 5 ? 'premature EOF' : 'missing command';
  for (let i = 0; i < 5; i++) {
    const [name, min, max] = FIELD_RANGES[i];
    for (const part of fields[i].split(',')) {
      const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
      const named = i === 3 ? /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)$/i.test(part) : i === 4 ? /^(sun|mon|tue|wed|thu|fri|sat)(-(sun|mon|tue|wed|thu|fri|sat))?$/i.test(part) : false;
      if (named) continue;
      if (!m) return `bad ${name}`;
      if (m[1] !== '*') {
        const [a, b] = m[1].split('-').map(Number);
        if (a < min || a > max || (b !== undefined && (b < min || b > max || b < a))) return `bad ${name}`;
      }
    }
  }
  return null;
}

/** Explica en español cuándo se ejecuta una expresión cron (para el jugador). */
export function describeCron(expression: string): string {
  const [m, h, dom, mon, dow] = expression.trim().split(/\s+/);
  if (expression.startsWith('@')) return expression.split(/\s+/)[0];
  const parts: string[] = [];
  if (m === '*' && h === '*') parts.push('cada minuto');
  else if (m.startsWith('*/')) parts.push(`cada ${m.slice(2)} minutos`);
  else if (h === '*') parts.push(`en el minuto ${m} de cada hora`);
  else if (h.startsWith('*/')) parts.push(`cada ${h.slice(2)} horas (minuto ${m})`);
  else parts.push(`a las ${h.padStart(2, '0')}:${m.padStart(2, '0')}`);
  if (dom !== '*') parts.push(`el día ${dom}`);
  if (mon !== '*') parts.push(`del mes ${mon}`);
  if (dow !== '*') parts.push(`(día de la semana ${dow})`);
  return parts.join(' ');
}

const CRONTAB_DIR = '/var/spool/cron/crontabs';

export const crontabCommand: Command = {
  name: 'crontab',
  category: 'servicios',
  summary: 'Programa tareas periódicas (-l lista, -e edita, -r borra)',
  async execute(ctx) {
    const uIndex = ctx.args.indexOf('-u');
    const user = uIndex !== -1 ? ctx.args[uIndex + 1] : ctx.session.username;
    if (uIndex !== -1 && user !== ctx.session.username && ctx.session.username !== 'root') return fail(ctx, 'must be privileged to use -u');
    const flags = ctx.args.filter((a, i) => a.startsWith('-') && a !== '-u' && (uIndex === -1 || i !== uIndex + 1) && a !== '-');
    const file = ctx.args.find((a, i) => (!a.startsWith('-') || a === '-') && (uIndex === -1 || i !== uIndex + 1));
    const path = `${CRONTAB_DIR}/${user}`;
    const read = (): string | null => ctx.fs.privileged(() => (ctx.fs.exists(path) ? ctx.fs.readFile(path) : null));
    const install = (content: string): number => {
      const lines = content.split('\n');
      for (let n = 0; n < lines.length; n++) {
        const error = validateCronLine(lines[n]);
        if (error) {
          ctx.stderr.write(`"-":${n + 1}: ${error}\nerrors in crontab file, can't install.\n`);
          return 1;
        }
      }
      ctx.fs.privileged(() => {
        ctx.fs.mkdir(CRONTAB_DIR, true);
        ctx.fs.writeFile(path, content.endsWith('\n') || content === '' ? content : content + '\n');
        ctx.fs.chown(path, user, 'crontab');
        ctx.fs.chmod(path, 0o600);
      });
      return 0;
    };

    if (flags.includes('-l')) {
      const content = read();
      if (content === null) {
        ctx.stderr.write(`no crontab for ${user}\n`);
        return 1;
      }
      ctx.stdout.write(content);
      return 0;
    }
    if (flags.includes('-r')) {
      if (read() === null) {
        ctx.stderr.write(`no crontab for ${user}\n`);
        return 1;
      }
      ctx.fs.privileged(() => ctx.fs.remove(path));
      return 0;
    }
    if (flags.includes('-e')) {
      if (!ctx.terminal.edit) return fail(ctx, 'no se puede abrir el editor');
      const template = '# Edita este archivo para programar tareas.\n# Formato: minuto hora día-del-mes mes día-de-la-semana comando\n#\n# Ejemplo: copia de seguridad cada día a las 5:00\n# 0 5 * * * tar -czf /backup/home.tar.gz /home\n#\n# m h  dom mon dow   command\n';
      const original = read() ?? template;
      if (read() === null) ctx.stdout.write(`no crontab for ${user} - using an empty one\n`);
      const edited = await ctx.terminal.edit(`/tmp/crontab.${user}/crontab`, original);
      if (edited === null || edited === original) {
        ctx.stdout.write('No modification made\n');
        return 0;
      }
      const code = install(edited);
      if (code === 0) ctx.stdout.write('crontab: installing new crontab\n');
      return code;
    }
    if (file !== undefined) {
      let content: string;
      if (file === '-') content = ctx.stdin ?? '';
      else {
        try {
          content = ctx.fs.readFile(ctx.resolve(file));
        } catch (error) {
          if (!isFsError(error)) throw error;
          return fail(ctx, `${file}: ${error.reason}`);
        }
      }
      return install(content);
    }
    ctx.stderr.write('usage:\tcrontab [-u user] file\n\tcrontab [-u user] [ -e | -l | -r ]\n');
    return 1;
  },
};

// ─────────────────────────────── logrotate ───────────────────────────────

const LOGROTATE_DIRECTIVES = new Set(['daily', 'weekly', 'monthly', 'yearly', 'rotate', 'compress', 'nocompress', 'delaycompress', 'missingok', 'nomissingok', 'notifempty', 'ifempty', 'create', 'nocreate', 'size', 'maxsize', 'minsize', 'maxage', 'dateext', 'copytruncate', 'sharedscripts', 'postrotate', 'prerotate', 'endscript', 'su', 'olddir', 'include', 'su', 'extension']);

interface RotateBlock {
  paths: string[];
  directives: Map<string, string>;
}

function parseLogrotate(content: string, file: string, errors: string[]): RotateBlock[] {
  const blocks: RotateBlock[] = [];
  const global = new Map<string, string>();
  let current: RotateBlock | null = null;
  let pendingPaths: string[] = [];
  let inScript = false;
  content.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    if (inScript) {
      if (line === 'endscript') inScript = false;
      return;
    }
    if (line.endsWith('{')) {
      const paths = line.slice(0, -1).trim().split(/\s+/).filter(Boolean);
      current = { paths: [...pendingPaths, ...paths], directives: new Map(global) };
      pendingPaths = [];
      return;
    }
    if (line === '}') {
      if (current) blocks.push(current);
      else errors.push(`error: ${file}:${index + 1} unexpected }`);
      current = null;
      return;
    }
    if (line.startsWith('/')) {
      pendingPaths.push(...line.split(/\s+/));
      return;
    }
    const [key, ...rest] = line.split(/\s+/);
    if (!LOGROTATE_DIRECTIVES.has(key)) {
      errors.push(`error: ${file}:${index + 1} unknown option '${key}' -- ignoring line`);
      return;
    }
    if (key === 'postrotate' || key === 'prerotate') inScript = true;
    if (key === 'rotate' && !/^\d+$/.test(rest[0] ?? '')) errors.push(`error: ${file}:${index + 1} bad rotation count '${rest[0] ?? ''}'`);
    (current ? current.directives : global).set(key, rest.join(' '));
  });
  if (current) errors.push(`error: ${file}: missing '}' at end of file`);
  return blocks;
}

export const logrotateCommand: Command = {
  name: 'logrotate',
  category: 'servicios',
  summary: 'Rota los logs para que no llenen el disco (-d prueba, -f fuerza)',
  execute(ctx) {
    const debug = ctx.args.includes('-d') || ctx.args.includes('--debug');
    const force = ctx.args.includes('-f') || ctx.args.includes('--force');
    const files = ctx.args.filter((a) => !a.startsWith('-'));
    if (files.length === 0) return fail(ctx, 'Usage: logrotate [OPTION...] <configfile>', 1);
    if (!debug && ctx.session.username !== 'root') {
      ctx.stderr.write(`error: error opening state file /var/lib/logrotate/status: Permission denied\n`);
      return 1;
    }
    const errors: string[] = [];
    const blocks: RotateBlock[] = [];
    for (const file of files) {
      try {
        const abs = ctx.resolve(file);
        const contents = ctx.fs.isDirectory(abs) ? ctx.fs.readDir(abs).filter((n) => n.type === 'file').map((n) => [`${abs}/${n.name}`, ctx.fs.readFile(`${abs}/${n.name}`)]) : [[abs, ctx.fs.readFile(abs)]];
        for (const [path, content] of contents) blocks.push(...parseLogrotate(content, path, errors));
      } catch (error) {
        if (!isFsError(error)) throw error;
        ctx.stderr.write(`error: cannot stat ${file}: ${error.reason}\n`);
        return 1;
      }
    }
    for (const e of errors) ctx.stderr.write(e + '\n');
    if (debug) ctx.stdout.write('WARNING: logrotate in debug mode does nothing except printing debug messages!  Consider using verbose mode (-v) instead if this is not what you want.\n\n');
    for (const block of blocks) {
      const d = block.directives;
      const period = ['daily', 'weekly', 'monthly', 'yearly'].find((p) => d.has(p)) ?? 'weekly';
      ctx.stdout.write(`rotating pattern: ${block.paths.join(' ')}  ${d.has('size') ? `${d.get('size')} bytes` : period} (${d.get('rotate') ?? '0'} rotations)\nempty log files are ${d.has('notifempty') ? 'not ' : ''}rotated, old logs are ${d.has('compress') ? '' : 'not '}compressed\n`);
      for (const pattern of block.paths) {
        const targets = pattern.includes('*')
          ? (() => {
              const dir = pattern.slice(0, pattern.lastIndexOf('/'));
              const re = new RegExp('^' + basename(pattern).replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
              return ctx.fs.isDirectory(dir) ? ctx.fs.readDir(dir).filter((n) => n.type === 'file' && re.test(n.name)).map((n) => `${dir}/${n.name}`) : [];
            })()
          : [pattern];
        for (const log of targets) {
          ctx.stdout.write(`considering log ${log}\n`);
          if (!ctx.fs.exists(log)) {
            ctx.stdout.write(d.has('missingok') ? '  log does not exist -- skipping\n' : `error: stat of ${log} failed: No such file or directory\n`);
            continue;
          }
          if (debug || !force) {
            ctx.stdout.write(`  log ${force ? 'will be' : 'does not need'} rotat${force ? 'ed' : 'ing'}\n`);
            if (debug) continue;
            if (!force) continue;
          }
          const keep = Number(d.get('rotate') ?? 4);
          const ext = d.has('compress') && !d.has('delaycompress') ? '.gz' : '';
          ctx.fs.privileged(() => {
            for (let i = keep; i >= 1; i--) {
              for (const suffix of ['', '.gz']) {
                const from = `${log}.${i}${suffix}`;
                if (!ctx.fs.exists(from)) continue;
                if (i === keep) ctx.fs.remove(from);
                else ctx.fs.move(from, `${log}.${i + 1}${suffix}`);
              }
            }
            ctx.fs.copy(log, `${log}.1${ext}`);
            ctx.fs.writeFile(log, '');
          });
          ctx.stdout.write(`  renaming ${log} to ${log}.1${ext}\n`);
        }
      }
    }
    return errors.length ? 1 : 0;
  },
};
