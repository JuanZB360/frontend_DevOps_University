/**
 * Comandos de identificación del sistema: whoami, hostname, uname, date.
 * Son tan pequeños que agruparlos en un archivo mejora la legibilidad
 * sin romper la responsabilidad única: todos "informan sobre el sistema".
 */
import type { Command } from '../Command';
import { EXIT_USAGE, parseOrFail } from '../helpers';

const KERNEL = { name: 'Linux', release: '6.8.0-devops', version: '#1 SMP PREEMPT_DYNAMIC', machine: 'x86_64', os: 'GNU/Linux' };

export const whoamiCommand: Command = {
  name: 'whoami',
  category: 'sistema',
  summary: 'Muestra tu nombre de usuario',
  execute(ctx) {
    ctx.stdout.write(ctx.session.username + '\n');
    return 0;
  },
};

export const hostnameCommand: Command = {
  name: 'hostname',
  category: 'sistema',
  summary: 'Muestra el nombre de la máquina (-I sus IPs)',
  execute(ctx) {
    if (ctx.args.includes('-I') || ctx.args.includes('-i')) {
      ctx.stdout.write(ctx.args.includes('-I') ? '10.0.0.10 \n' : '127.0.1.1\n');
      return 0;
    }
    ctx.stdout.write(ctx.session.hostname + '\n');
    return 0;
  },
};

const UNAME_SPECS = [
  { key: 'all', short: 'a', long: 'all' },
  { key: 'kernel', short: 's', long: 'kernel-name' },
  { key: 'node', short: 'n', long: 'nodename' },
  { key: 'release', short: 'r', long: 'kernel-release' },
  { key: 'version', short: 'v', long: 'kernel-version' },
  { key: 'machine', short: 'm', long: 'machine' },
  { key: 'os', short: 'o', long: 'operating-system' },
] as const;

export const unameCommand: Command = {
  name: 'uname',
  category: 'sistema',
  summary: 'Muestra información del kernel',
  execute(ctx) {
    const options = parseOrFail(ctx, UNAME_SPECS);
    if (!options) return EXIT_USAGE;
    const f = options.flags;
    const all = f.has('all');
    const parts: string[] = [];
    if (all || f.has('kernel') || f.size === 0) parts.push(KERNEL.name);
    if (all || f.has('node')) parts.push(ctx.session.hostname);
    if (all || f.has('release')) parts.push(KERNEL.release);
    if (all || f.has('version')) parts.push(KERNEL.version);
    if (all || f.has('machine')) parts.push(KERNEL.machine);
    if (all || f.has('os')) parts.push(KERNEL.os);
    ctx.stdout.write(parts.join(' ') + '\n');
    return 0;
  },
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Formatea una fecha con los especificadores de `date +FORMATO`. */
export function formatDate(d: Date, format: string): string {
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  const map: Record<string, () => string> = {
    Y: () => String(d.getFullYear()), y: () => pad(d.getFullYear() % 100), m: () => pad(d.getMonth() + 1), d: () => pad(d.getDate()),
    e: () => String(d.getDate()).padStart(2), H: () => pad(d.getHours()), M: () => pad(d.getMinutes()), S: () => pad(d.getSeconds()),
    F: () => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, T: () => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    s: () => String(Math.floor(d.getTime() / 1000)), a: () => DAYS[d.getDay()], A: () => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()],
    b: () => MONTHS[d.getMonth()], j: () => pad(Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86_400_000), 3),
    u: () => String(d.getDay() || 7), Z: () => 'UTC', z: () => '+0000', n: () => '\n', t: () => '\t', '%': () => '%',
  };
  return format.replace(/%(.)/g, (m, c: string) => map[c]?.() ?? m);
}

export const dateCommand: Command = {
  name: 'date',
  category: 'sistema',
  summary: 'Muestra la fecha y hora (date +%F → 2024-11-16)',
  execute(ctx) {
    const format = ctx.args.find((a) => a.startsWith('+'));
    const dIndex = ctx.args.findIndex((a) => a === '-d' || a === '--date');
    let d = new Date(ctx.fs.now());
    if (dIndex !== -1) {
      const spec = ctx.args[dIndex + 1] ?? '';
      const rel = /^(-?\d+)\s*(day|days|hour|hours)( ago)?$/.exec(spec);
      if (spec === 'yesterday') d = new Date(d.getTime() - 86_400_000);
      else if (spec === 'tomorrow') d = new Date(d.getTime() + 86_400_000);
      else if (rel) d = new Date(d.getTime() + (rel[3] ? -1 : 1) * Number(rel[1]) * (rel[2].startsWith('day') ? 86_400_000 : 3_600_000));
      else if (!Number.isNaN(Date.parse(spec))) d = new Date(spec);
    }
    if (format) {
      ctx.stdout.write(formatDate(d, format.slice(1)) + '\n');
      return 0;
    }
    ctx.stdout.write(formatDate(d, '%a %b %e %T UTC %Y') + '\n');
    return 0;
  },
};
