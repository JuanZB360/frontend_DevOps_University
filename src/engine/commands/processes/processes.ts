/**
 * Procesos y recursos:
 *   ps top kill killall pkill pgrep jobs fg bg nohup nice renice
 *   free uptime vmstat iostat lsof
 */
import { addJournal, readMachine, updateMachine, type MachineState, type Process } from '../../system/machine';
import type { Command, CommandContext } from '../Command';
import { EXIT_USAGE, fail } from '../helpers';

const SHELL_PID = 1337;

const SIGNALS: Record<string, number> = { HUP: 1, INT: 2, QUIT: 3, KILL: 9, USR1: 10, USR2: 12, TERM: 15, CONT: 18, STOP: 19, TSTP: 20 };

/** Nombre corto del programa (la "comm" de ps). */
export function processName(p: Process): string {
  const first = p.command.replace(/^sshd: .*/, 'sshd').split(' ')[0];
  return first.split('/').at(-1)!.replace(/:$/, '');
}

/** Procesos visibles: los del sistema + la shell del jugador. */
function allProcesses(ctx: CommandContext, machine: MachineState): Process[] {
  const shell: Process = {
    pid: SHELL_PID, ppid: 1, user: ctx.session.username, command: '-bash', cpu: 0, mem: 0.1, rss: 5_400,
    state: 'S', nice: 0, start: ctx.fs.now() - 3_600_000, tty: 'pts/0',
  };
  return [...machine.processes, shell];
}

function startTime(ms: number, now: number): string {
  const d = new Date(ms);
  if (now - ms < 86_400_000) return d.toTimeString().slice(0, 5);
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()] + String(d.getDate()).padStart(2, '0');
}

function cpuTime(p: Process, now: number): string {
  const seconds = Math.floor(((now - p.start) / 1000) * (p.cpu / 100));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export const psCommand: Command = {
  name: 'ps',
  category: 'procesos',
  summary: 'Lista los procesos (ps aux: todos con detalle)',
  execute(ctx) {
    const machine = readMachine(ctx.fs);
    const now = ctx.fs.now();
    const args = ctx.args.join(' ');
    let list = allProcesses(ctx, machine);
    // Sintaxis BSD: "ps aux" (letras sin guion, con x).
    const bsd = ctx.args.some((a) => /^[aux]+$/.test(a) && a.includes('x'));
    const all = bsd || /-e|-A|-ef|-aux/.test(args);
    const userIndex = ctx.args.findIndex((a) => a === '-u' || a === '-U');
    const pidIndex = ctx.args.findIndex((a) => a === '-p');
    if (userIndex !== -1) list = list.filter((p) => p.user === ctx.args[userIndex + 1]);
    else if (pidIndex !== -1) list = list.filter((p) => (ctx.args[pidIndex + 1] ?? '').split(',').includes(String(p.pid)));
    else if (!all) list = list.filter((p) => p.tty === 'pts/0' && p.user === ctx.session.username);
    const sort = /--sort=(-?)(%?\w+)/.exec(args);
    if (sort) {
      const key = sort[2].replace('%', '') as 'cpu' | 'mem' | 'pid';
      const field = key === 'cpu' ? 'cpu' : key === 'mem' ? 'mem' : 'pid';
      list = [...list].sort((a, b) => (sort[1] === '-' ? b[field] - a[field] : a[field] - b[field]));
    }
    const self: Process = { pid: machine.nextPid, ppid: SHELL_PID, user: ctx.session.username, command: `ps ${ctx.args.join(' ')}`.trim(), cpu: 0, mem: 0, rss: 3_900, state: 'R', nice: 0, start: now, tty: 'pts/0' };
    const rows = [...list, self];

    if (bsd || args.includes('-aux') || /\bu\b/.test(args)) {
      ctx.stdout.write('USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\n');
      for (const p of rows) {
        ctx.stdout.write(
          `${p.user.slice(0, 8).padEnd(8)} ${String(p.pid).padStart(7)} ${p.cpu.toFixed(1).padStart(4)} ${p.mem.toFixed(1).padStart(4)} ${String(p.rss * 3).padStart(6)} ${String(p.rss).padStart(5)} ${p.tty.padEnd(8)} ${(p.state + (p.nice < 0 ? '<' : p.nice > 0 ? 'N' : '') + (p.tty === '?' ? 's' : '+')).padEnd(4)} ${startTime(p.start, now).padEnd(5)} ${cpuTime(p, now).padStart(6)} ${p.command}\n`,
        );
      }
      return 0;
    }
    if (args.includes('-f') || args.includes('-ef')) {
      ctx.stdout.write('UID          PID    PPID  C STIME TTY          TIME CMD\n');
      for (const p of rows) ctx.stdout.write(`${p.user.slice(0, 8).padEnd(8)} ${String(p.pid).padStart(7)} ${String(p.ppid).padStart(7)} ${String(Math.round(p.cpu)).padStart(2)} ${startTime(p.start, now)} ${p.tty.padEnd(8)} 00:${cpuTime(p, now).padStart(5, '0')} ${p.command}\n`);
      return 0;
    }
    ctx.stdout.write('    PID TTY          TIME CMD\n');
    for (const p of rows) ctx.stdout.write(`${String(p.pid).padStart(7)} ${p.tty.padEnd(8)} 00:00:${cpuTime(p, now).split(':')[1]} ${processName(p) === '-bash' ? 'bash' : processName(p)}\n`);
    return 0;
  },
};

function memoryStats(machine: MachineState): { total: number; used: number; free: number; cache: number; available: number } {
  const total = machine.memoryMB;
  const used = Math.min(total - 50, Math.round(machine.processes.reduce((sum, p) => sum + p.rss / 1024, 0) + 420));
  const cache = Math.round((total - used) * 0.45);
  const free = total - used - cache;
  return { total, used, free, cache, available: free + Math.round(cache * 0.8) };
}

function loadAverage(machine: MachineState): [number, number, number] {
  const busy = machine.processes.reduce((sum, p) => sum + p.cpu, 0) / 100;
  const l = Math.max(0.02, busy);
  return [l, l * 0.9 + 0.01, l * 0.7 + 0.02];
}

function uptimeText(machine: MachineState, now: number): string {
  const minutes = Math.floor((now - machine.bootTime) / 60_000);
  const days = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  return `${days} day${days === 1 ? '' : 's'}, ${String(h).padStart(2)}:${String(m).padStart(2, '0')}`;
}

export const topCommand: Command = {
  name: 'top',
  aliases: ['htop'],
  category: 'procesos',
  summary: 'Muestra los procesos que más recursos consumen',
  execute(ctx) {
    const machine = readMachine(ctx.fs);
    const now = ctx.fs.now();
    const list = allProcesses(ctx, machine).sort((a, b) => b.cpu - a.cpu || b.mem - a.mem);
    const mem = memoryStats(machine);
    const [l1, l5, l15] = loadAverage(machine);
    const cpuUsed = Math.min(100, machine.processes.reduce((s, p) => s + p.cpu, 0) / 2);
    ctx.stdout.write(
      `top - ${new Date(now).toTimeString().slice(0, 8)} up ${uptimeText(machine, now)},  1 user,  load average: ${l1.toFixed(2)}, ${l5.toFixed(2)}, ${l15.toFixed(2)}\n` +
      `Tasks: ${list.length} total,   ${list.filter((p) => p.state === 'R' || p.cpu > 50).length} running, ${list.length - list.filter((p) => p.cpu > 50).length} sleeping,   ${list.filter((p) => p.state === 'T').length} stopped,   ${list.filter((p) => p.state === 'Z').length} zombie\n` +
      `%Cpu(s): ${cpuUsed.toFixed(1)} us,  0.3 sy,  0.0 ni, ${(100 - cpuUsed).toFixed(1)} id,  0.0 wa,  0.0 hi,  0.0 si,  0.0 st\n` +
      `MiB Mem :  ${mem.total.toFixed(1)} total,   ${mem.free.toFixed(1)} free,   ${mem.used.toFixed(1)} used,   ${mem.cache.toFixed(1)} buff/cache\n` +
      `MiB Swap:  ${machine.swapMB.toFixed(1)} total,   ${machine.swapMB.toFixed(1)} free,      0.0 used.   ${mem.available.toFixed(1)} avail Mem\n\n` +
      '    PID USER      PR  NI    VIRT    RES  %CPU  %MEM     TIME+ COMMAND\n',
    );
    for (const p of list.slice(0, 15)) {
      ctx.stdout.write(`${String(p.pid).padStart(7)} ${p.user.slice(0, 8).padEnd(8)}  ${String(20 + p.nice).padStart(2)} ${String(p.nice).padStart(3)} ${String(p.rss * 3).padStart(7)} ${String(p.rss).padStart(6)} ${p.cpu.toFixed(1).padStart(5)} ${p.mem.toFixed(1).padStart(5)} ${cpuTime(p, now).padStart(9)} ${processName(p)}\n`);
    }
    if (ctx.stdout.isTTY && !ctx.args.includes('-b')) {
      ctx.stderr.write(`\x1b[2m(En un servidor real ${ctx.name} se actualiza cada 3 s: P ordena por CPU, M por memoria, k mata un proceso, q sale.)\x1b[0m\n`);
    }
    return 0;
  },
};

/** Resuelve "%1" (trabajo) o un PID. */
function resolveTarget(machine: MachineState, target: string): Process | 'shell' | undefined {
  if (target.startsWith('%')) return machine.processes.find((p) => p.job === Number(target.slice(1) || 1));
  if (Number(target) === SHELL_PID) return 'shell';
  return machine.processes.find((p) => p.pid === Number(target));
}

/** Aplica una señal. Devuelve un mensaje de error o null. */
function signalProcess(ctx: CommandContext, machine: MachineState, process: Process, signal: number): string | null {
  if (ctx.session.username !== 'root' && process.user !== ctx.session.username) return 'Operation not permitted';
  if (process.pid === 1) return 'Operation not permitted';
  const now = ctx.fs.now();
  if (signal === 19 || signal === 20) {
    process.state = 'T';
    return null;
  }
  if (signal === 18) {
    process.state = 'S';
    return null;
  }
  if (signal === 1 && process.service) {
    addJournal(machine, now, process.service, `Reloading ${process.service} configuration (SIGHUP).`);
    return null;
  }
  // TERM, KILL, INT...: el proceso termina. Algunos procesos "rebeldes" ignoran TERM.
  if (signal !== 9 && process.command.includes('--ignore-term')) return null;
  machine.processes = machine.processes.filter((p) => p.pid !== process.pid && p.ppid !== process.pid);
  if (process.service && machine.services[process.service]) {
    const service = machine.services[process.service];
    service.active = false;
    if (signal === 9) service.failed = `Main process exited, code=killed, status=9/KILL`;
    addJournal(machine, now, process.service, `${process.service}.service: Main process exited, code=killed, status=${signal}/${Object.keys(SIGNALS).find((k) => SIGNALS[k] === signal) ?? signal}`, 4);
  }
  return null;
}

function parseSignal(arg: string | undefined): number | null {
  if (!arg) return 15;
  const name = arg.replace(/^-/, '').replace(/^SIG/i, '').replace(/^s\s*/, '').toUpperCase();
  if (/^\d+$/.test(name)) return Number(name);
  return SIGNALS[name] ?? null;
}

export const killCommand: Command = {
  name: 'kill',
  category: 'procesos',
  summary: 'Envía una señal a un proceso (por defecto TERM; -9 = KILL)',
  builtin: true,
  execute(ctx) {
    if (ctx.args[0] === '-l' || ctx.args[0] === '-L') {
      ctx.stdout.write(Object.entries(SIGNALS).map(([k, v]) => `${String(v).padStart(2)}) SIG${k}`).join('\t') + '\n');
      return 0;
    }
    let signal = 15;
    const targets: string[] = [];
    for (let i = 0; i < ctx.args.length; i++) {
      const arg = ctx.args[i];
      if (arg === '-s' || arg === '-n') {
        const s = parseSignal(ctx.args[++i]);
        if (s === null) return fail(ctx, `${ctx.args[i]}: invalid signal specification`);
        signal = s;
      } else if (arg.startsWith('-') && targets.length === 0) {
        const s = parseSignal(arg);
        if (s === null) return fail(ctx, `${arg.slice(1)}: invalid signal specification`);
        signal = s;
      } else targets.push(arg);
    }
    if (targets.length === 0) return fail(ctx, 'usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]', EXIT_USAGE);
    let exitCode = 0;
    updateMachine(ctx.fs, (machine) => {
      for (const target of targets) {
        const process = resolveTarget(machine, target);
        if (process === 'shell') {
          ctx.stderr.write('N0X: Si matas tu propia shell, te desconectas. Mejor no.\n');
          exitCode = 1;
          continue;
        }
        if (!process) {
          ctx.stderr.write(`bash: kill: ${target}: ${target.startsWith('%') ? 'no such job' : '(' + target + ') - No such process'}\n`);
          exitCode = 1;
          continue;
        }
        const error = signalProcess(ctx, machine, process, signal);
        if (error) {
          ctx.stderr.write(`bash: kill: (${process.pid}) - ${error}\n`);
          exitCode = 1;
        } else if (target.startsWith('%') && (signal === 9 || signal === 15)) {
          ctx.stdout.write(`[${process.job}]+  ${signal === 9 ? 'Killed' : 'Terminated'}              ${process.command}\n`);
        }
      }
    });
    return exitCode;
  },
};

/** Coincidencia por nombre (pkill nginx) o por línea completa (pkill -f "python app.py"). */
function matcher(pattern: string, full: boolean, exact: boolean): (p: Process) => boolean {
  if (exact) return (p) => processName(p) === pattern;
  const re = new RegExp(pattern);
  return (p) => re.test(full ? p.command : processName(p));
}

function createPkill(name: 'pkill' | 'killall'): Command {
  return {
    name,
    category: 'procesos',
    summary: name === 'pkill' ? 'Envía una señal a procesos por nombre' : 'Mata todos los procesos con ese nombre',
    execute(ctx) {
      let signal = 15;
      let full = false;
      let user: string | undefined;
      const patterns: string[] = [];
      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg === '-f') full = true;
        else if (arg === '-u') user = ctx.args[++i];
        else if (arg === '-s' || arg === '--signal') signal = parseSignal(ctx.args[++i]) ?? 15;
        else if (arg.startsWith('-')) signal = parseSignal(arg) ?? 15;
        else patterns.push(arg);
      }
      if (patterns.length === 0 && !user) return fail(ctx, 'no matching criteria specified', EXIT_USAGE);
      let matched = 0;
      let denied = false;
      updateMachine(ctx.fs, (machine) => {
        const test = patterns.length ? matcher(patterns[0], full, name === 'killall') : () => true;
        for (const process of [...machine.processes]) {
          if (!test(process) || (user && process.user !== user)) continue;
          matched++;
          if (signalProcess(ctx, machine, process, signal)) {
            denied = true;
            if (name === 'killall') ctx.stderr.write(`${processName(process)}(${process.pid}): Operation not permitted\n`);
          }
        }
      });
      if (matched === 0 && name === 'killall') ctx.stderr.write(`${patterns[0]}: no process found\n`);
      return matched === 0 || denied ? 1 : 0;
    },
  };
}

export const pkillCommand = createPkill('pkill');
export const killallCommand = createPkill('killall');

export const pgrepCommand: Command = {
  name: 'pgrep',
  category: 'procesos',
  summary: 'Busca procesos por nombre y muestra su PID',
  execute(ctx) {
    const full = ctx.args.includes('-f');
    const list = ctx.args.includes('-l');
    const all = ctx.args.includes('-a');
    const userIndex = ctx.args.indexOf('-u');
    const user = userIndex !== -1 ? ctx.args[userIndex + 1] : undefined;
    const pattern = ctx.args.find((a, i) => !a.startsWith('-') && (userIndex === -1 || i !== userIndex + 1));
    const machine = readMachine(ctx.fs);
    const test = pattern ? matcher(pattern, full, false) : () => true;
    const found = machine.processes.filter((p) => test(p) && (!user || p.user === user));
    for (const p of found) ctx.stdout.write(`${p.pid}${all ? ' ' + p.command : list ? ' ' + processName(p) : ''}\n`);
    return found.length ? 0 : 1;
  },
};

export const jobsCommand: Command = {
  name: 'jobs',
  category: 'procesos',
  summary: 'Lista los trabajos en segundo plano de esta terminal',
  builtin: true,
  execute(ctx) {
    const machine = readMachine(ctx.fs);
    const jobs = machine.processes.filter((p) => p.job !== undefined && p.user === ctx.session.username).sort((a, b) => a.job! - b.job!);
    jobs.forEach((p, i) => {
      const marker = i === jobs.length - 1 ? '+' : i === jobs.length - 2 ? '-' : ' ';
      const pid = ctx.args.includes('-l') ? ` ${p.pid}` : '';
      ctx.stdout.write(`[${p.job}]${marker}${pid}  ${(p.state === 'T' ? 'Stopped' : 'Running').padEnd(22)}${p.command} &\n`);
    });
    return 0;
  },
};

function jobTarget(ctx: CommandContext, machine: MachineState): Process | undefined {
  const spec = ctx.args[0];
  const jobs = machine.processes.filter((p) => p.job !== undefined && p.user === ctx.session.username);
  if (!spec) return jobs.sort((a, b) => b.job! - a.job!)[0];
  return jobs.find((p) => p.job === Number(spec.replace('%', '')));
}

export const fgCommand: Command = {
  name: 'fg',
  category: 'procesos',
  summary: 'Trae un trabajo al primer plano',
  builtin: true,
  async execute(ctx) {
    let process: Process | undefined;
    updateMachine(ctx.fs, (machine) => {
      process = jobTarget(ctx, machine);
      // En el simulador, traerlo al frente equivale a esperar a que termine.
      if (process) machine.processes = machine.processes.filter((p) => p.pid !== process!.pid);
    });
    if (!process) return fail(ctx, `${ctx.args[0] ?? 'current'}: no such job`);
    ctx.stdout.write(`${process.command}\n`);
    await new Promise((r) => setTimeout(r, 400));
    return 0;
  },
};

export const bgCommand: Command = {
  name: 'bg',
  category: 'procesos',
  summary: 'Reanuda en segundo plano un trabajo detenido',
  builtin: true,
  execute(ctx) {
    let process: Process | undefined;
    updateMachine(ctx.fs, (machine) => {
      process = jobTarget(ctx, machine);
      if (process) process.state = 'S';
    });
    if (!process) return fail(ctx, `${ctx.args[0] ?? 'current'}: no such job`);
    ctx.stdout.write(`[${process.job}]+ ${process.command} &\n`);
    return 0;
  },
};

export const nohupCommand: Command = {
  name: 'nohup',
  category: 'procesos',
  summary: 'Ejecuta un comando que sobrevive al cerrar la sesión',
  async execute(ctx) {
    if (ctx.args.length === 0) return fail(ctx, 'missing operand', 125);
    ctx.stderr.write("nohup: ignoring input and appending output to 'nohup.out'\n");
    const out = { isTTY: false, write: (t: string) => ctx.fs.writeFile(ctx.resolve('nohup.out'), t, true) };
    if (!ctx.fs.exists(ctx.resolve('nohup.out'))) ctx.fs.writeFile(ctx.resolve('nohup.out'), '');
    const code = await ctx.shell.spawn(ctx.args, { stdout: out, stderr: out });
    if (ctx.backgroundPid) {
      updateMachine(ctx.fs, (machine) => {
        const p = machine.processes.find((x) => x.pid === ctx.backgroundPid);
        if (p) {
          p.command = ctx.args.join(' ');
          if (p.endsAt === undefined) p.persistent = true;
        }
      });
    }
    return code;
  },
};

export const niceCommand: Command = {
  name: 'nice',
  category: 'procesos',
  summary: 'Ejecuta un comando con otra prioridad (-n 10 = más amable)',
  async execute(ctx) {
    let adjustment = 10;
    let i = 0;
    if (ctx.args[0] === '-n') {
      adjustment = Number(ctx.args[1]);
      i = 2;
    } else if (/^-\d+$/.test(ctx.args[0] ?? '')) {
      adjustment = Number(ctx.args[0].slice(1));
      i = 1;
    }
    if (ctx.args.length <= i) {
      ctx.stdout.write('0\n');
      return 0;
    }
    if (adjustment < 0 && ctx.session.username !== 'root') {
      ctx.stderr.write('nice: cannot set niceness: Permission denied\n');
      adjustment = 0;
    }
    const code = await ctx.shell.spawn(ctx.args.slice(i));
    if (ctx.backgroundPid) {
      updateMachine(ctx.fs, (machine) => {
        const p = machine.processes.find((x) => x.pid === ctx.backgroundPid);
        if (p) p.nice = Math.max(-20, Math.min(19, adjustment));
      });
    }
    return code;
  },
};

export const reniceCommand: Command = {
  name: 'renice',
  category: 'procesos',
  summary: 'Cambia la prioridad de un proceso en marcha',
  execute(ctx) {
    const nIndex = ctx.args.indexOf('-n');
    const value = Number(nIndex !== -1 ? ctx.args[nIndex + 1] : ctx.args[0]);
    const pids = ctx.args.filter((a, i) => /^\d+$/.test(a) && i !== nIndex + 1 && !(nIndex === -1 && i === 0)).map(Number);
    if (Number.isNaN(value) || pids.length === 0) return fail(ctx, 'usage: renice [-n] priority [-p|--pid] pid...', EXIT_USAGE);
    let exitCode = 0;
    updateMachine(ctx.fs, (machine) => {
      for (const pid of pids) {
        const p = machine.processes.find((x) => x.pid === pid);
        if (!p) {
          ctx.stderr.write(`renice: failed to get priority for ${pid} (process ID): No such process\n`);
          exitCode = 1;
          continue;
        }
        if (ctx.session.username !== 'root' && (p.user !== ctx.session.username || value < p.nice)) {
          ctx.stderr.write(`renice: failed to set priority for ${pid} (process ID): Permission denied\n`);
          exitCode = 1;
          continue;
        }
        ctx.stdout.write(`${pid} (process ID) old priority ${p.nice}, new priority ${value}\n`);
        p.nice = value;
      }
    });
    return exitCode;
  },
};

export const freeCommand: Command = {
  name: 'free',
  category: 'procesos',
  summary: 'Muestra el uso de memoria RAM y swap (-h legible)',
  execute(ctx) {
    const machine = readMachine(ctx.fs);
    const mem = memoryStats(machine);
    const human = ctx.args.some((a) => a.includes('h'));
    const fmt = (mb: number): string => (human ? (mb >= 1024 ? `${(mb / 1024).toFixed(1)}Gi` : `${Math.round(mb)}Mi`) : String(Math.round(mb * 1024)));
    const w = 11;
    ctx.stdout.write(`${''.padEnd(7)}${'total'.padStart(w)}${'used'.padStart(w)}${'free'.padStart(w)}${'shared'.padStart(w)}${'buff/cache'.padStart(w)}${'available'.padStart(w)}\n`);
    ctx.stdout.write(`${'Mem:'.padEnd(7)}${fmt(mem.total).padStart(w)}${fmt(mem.used).padStart(w)}${fmt(mem.free).padStart(w)}${fmt(12).padStart(w)}${fmt(mem.cache).padStart(w)}${fmt(mem.available).padStart(w)}\n`);
    ctx.stdout.write(`${'Swap:'.padEnd(7)}${fmt(machine.swapMB).padStart(w)}${fmt(0).padStart(w)}${fmt(machine.swapMB).padStart(w)}\n`);
    return 0;
  },
};

export const uptimeCommand: Command = {
  name: 'uptime',
  category: 'procesos',
  summary: 'Tiempo encendido y carga media del sistema',
  execute(ctx) {
    const machine = readMachine(ctx.fs);
    const now = ctx.fs.now();
    const [l1, l5, l15] = loadAverage(machine);
    if (ctx.args.includes('-p')) {
      ctx.stdout.write(`up ${uptimeText(machine, now)}\n`);
      return 0;
    }
    ctx.stdout.write(` ${new Date(now).toTimeString().slice(0, 8)} up ${uptimeText(machine, now)},  1 user,  load average: ${l1.toFixed(2)}, ${l5.toFixed(2)}, ${l15.toFixed(2)}\n`);
    return 0;
  },
};

export const vmstatCommand: Command = {
  name: 'vmstat',
  category: 'procesos',
  summary: 'Estadísticas de memoria, CPU y disco',
  execute(ctx) {
    const machine = readMachine(ctx.fs);
    const mem = memoryStats(machine);
    const cpu = Math.min(100, Math.round(machine.processes.reduce((s, p) => s + p.cpu, 0) / 2));
    const running = machine.processes.filter((p) => p.cpu > 50).length;
    ctx.stdout.write('procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----\n');
    ctx.stdout.write(' r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st\n');
    ctx.stdout.write(`${String(running).padStart(2)}  0      0 ${String(mem.free * 1024).padStart(6)}  52340 ${String(mem.cache * 1024).padStart(6)}    0    0     3    12   95  180 ${String(cpu).padStart(2)}  1 ${String(99 - cpu).padStart(2)}  0  0\n`);
    return 0;
  },
};

export const iostatCommand: Command = {
  name: 'iostat',
  category: 'procesos',
  summary: 'Estadísticas de entrada/salida de los discos',
  package: 'sysstat',
  execute(ctx) {
    const machine = readMachine(ctx.fs);
    const heavy = machine.processes.some((p) => p.command.includes('--disk-heavy'));
    ctx.stdout.write(`Linux 6.8.0-devops (${ctx.session.hostname}) \t${new Date(ctx.fs.now()).toLocaleDateString('en-US')} \t_x86_64_\t(2 CPU)\n\n`);
    ctx.stdout.write('Device             tps    kB_read/s    kB_wrtn/s    kB_read    kB_wrtn\n');
    ctx.stdout.write(`sda              ${heavy ? '812.40' : '  3.21'}        ${heavy ? '102.10' : '  4.53'}     ${heavy ? '48210.77' : '   21.08'}     412311    ${heavy ? '9812340' : '1922811'}\n`);
    ctx.stdout.write('sdb                0.01         0.02         0.00        512          0\n');
    return 0;
  },
};

export const lsofCommand: Command = {
  name: 'lsof',
  category: 'procesos',
  summary: 'Lista archivos y puertos abiertos por los procesos',
  execute(ctx) {
    const machine = readMachine(ctx.fs);
    const iIndex = ctx.args.findIndex((a) => a.startsWith('-i'));
    const userIndex = ctx.args.indexOf('-u');
    const deleted = ctx.args.includes('+L1');
    const path = ctx.args.find((a, i) => !a.startsWith('-') && !a.startsWith('+') && i !== userIndex + 1 && !(iIndex !== -1 && i === iIndex + 1 && !ctx.args[iIndex].slice(2)));
    if (ctx.session.username !== 'root' && (iIndex !== -1 || deleted)) {
      // Sin root solo se ven los procesos propios.
    }
    const rows: string[] = [];
    const visible = machine.processes.filter((p) => ctx.session.username === 'root' || p.user === ctx.session.username);
    if (iIndex !== -1) {
      const spec = ctx.args[iIndex].slice(2) || ctx.args[iIndex + 1] || '';
      const port = Number(/:(\d+)/.exec(spec)?.[1] ?? NaN);
      for (const p of visible) {
        for (const listening of p.ports ?? []) {
          if (!Number.isNaN(port) && listening !== port) continue;
          rows.push(`${processName(p).padEnd(9)} ${String(p.pid).padStart(6)} ${p.user.padEnd(8)}    6u  IPv4  ${20000 + listening}      0t0  TCP *:${listening} (LISTEN)`);
        }
      }
    } else {
      for (const p of visible) {
        if (userIndex !== -1 && p.user !== ctx.args[userIndex + 1]) continue;
        for (const file of p.files ?? []) {
          const isDeleted = file.endsWith(' (deleted)');
          if (deleted && !isDeleted) continue;
          if (path && !file.startsWith(ctx.resolve(path))) continue;
          const size = isDeleted ? 9_663_676_416 : 4096;
          rows.push(`${processName(p).padEnd(9)} ${String(p.pid).padStart(6)} ${p.user.padEnd(8)}    3w   REG    8,1 ${String(size).padStart(10)} ${isDeleted ? '0' : '131'} ${file}`);
        }
      }
    }
    if (rows.length === 0) return 1;
    ctx.stdout.write(`COMMAND      PID USER      FD   TYPE ${iIndex !== -1 ? 'DEVICE SIZE/OFF NODE NAME' : 'DEVICE   SIZE/OFF NLINK NAME'}\n`);
    for (const row of rows) ctx.stdout.write(row + '\n');
    return 0;
  },
};
