/**
 * Gestor de servicios (el "systemd" del simulador).
 *
 * Un servicio puede venir de un paquete (nginx, ssh...) o de un archivo
 * .service escrito por el jugador en /etc/systemd/system. Arrancarlo crea su
 * proceso (con sus puertos); pararlo lo elimina.
 */
import type { VirtualFileSystem } from '../vfs/VirtualFileSystem';
import { findUser } from './accounts';
import { addJournal, isInstalled, spawnProcess, type MachineState } from './machine';
import { packageService } from './packages';

export interface UnitFile {
  name: string;
  path: string;
  description: string;
  execStart: string;
  user: string;
  workingDirectory?: string;
  wantedBy?: string;
  restart?: string;
  onCalendar?: string;
  env: Record<string, string>;
  errors: string[];
}

/** Interpreta un archivo de unidad de systemd. */
export function parseUnit(name: string, path: string, content: string): UnitFile {
  const unit: UnitFile = { name, path, description: name, execStart: '', user: 'root', env: {}, errors: [] };
  let section = '';
  content.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) return;
    const header = /^\[(\w+)\]$/.exec(line);
    if (header) {
      section = header[1];
      if (!['Unit', 'Service', 'Install', 'Timer'].includes(section)) unit.errors.push(`${path}:${index + 1}: Unknown section '${section}'. Ignoring.`);
      return;
    }
    const kv = /^([A-Za-z]+)\s*=\s*(.*)$/.exec(line);
    if (!kv) {
      unit.errors.push(`${path}:${index + 1}: Missing '=', ignoring line.`);
      return;
    }
    const [, key, value] = kv;
    if (section === 'Unit' && key === 'Description') unit.description = value;
    if (section === 'Service' && key === 'ExecStart') unit.execStart = value;
    if (section === 'Service' && key === 'User') unit.user = value;
    if (section === 'Service' && key === 'WorkingDirectory') unit.workingDirectory = value;
    if (section === 'Service' && key === 'Restart') unit.restart = value;
    if (section === 'Service' && key === 'Environment') {
      for (const pair of value.replace(/"/g, '').split(/\s+/)) {
        const [k, ...v] = pair.split('=');
        if (k) unit.env[k] = v.join('=');
      }
    }
    if (section === 'Install' && key === 'WantedBy') unit.wantedBy = value;
    if (section === 'Timer' && key === 'OnCalendar') unit.onCalendar = value;
  });
  if (name.endsWith('.timer') && !unit.onCalendar) unit.errors.push(`${path}: Timer unit lacks value setting. Refusing.`);
  if (!unit.execStart && name.endsWith('.service')) unit.errors.push(`${path}: Service has no ExecStart=, ExecStop=, or SuccessAction=. Refusing.`);
  return unit;
}

/** Unidades escritas por el administrador en /etc/systemd/system. */
export function customUnits(fs: VirtualFileSystem): UnitFile[] {
  return fs.privileged(() => {
    if (!fs.isDirectory('/etc/systemd/system')) return [];
    return fs.readDir('/etc/systemd/system')
      .filter((n) => n.type === 'file' && /\.(service|timer)$/.test(n.name))
      .map((n) => parseUnit(n.name, `/etc/systemd/system/${n.name}`, fs.readFile(`/etc/systemd/system/${n.name}`)));
  });
}

/** Normaliza "nginx", "nginx.service" → "nginx". */
export function unitName(name: string): string {
  return name.replace(/\.service$/, '');
}

export type ServiceInfo =
  | { kind: 'package'; name: string; description: string; command: string; user: string; ports: number[]; memMB: number; check?: (fs: VirtualFileSystem, machine: MachineState) => string | null; portsFrom?: (fs: VirtualFileSystem, machine: MachineState) => number[] }
  | { kind: 'custom'; name: string; description: string; unit: UnitFile };

/** Busca la definición de un servicio instalado. */
export function findService(fs: VirtualFileSystem, machine: MachineState, rawName: string): ServiceInfo | null {
  const name = unitName(rawName);
  if (name.endsWith('.timer')) {
    const timer = customUnits(fs).find((u) => u.name === name);
    return timer ? { kind: 'custom', name, description: timer.description, unit: timer } : null;
  }
  const custom = customUnits(fs).find((u) => u.name === `${name}.service`);
  if (custom) return { kind: 'custom', name, description: custom.description, unit: custom };
  const fromPackage = packageService(name);
  if (fromPackage && isInstalled(machine, fromPackage.pkg.name)) {
    const s = fromPackage.service;
    return { kind: 'package', name, description: s.description, command: s.command, user: s.user, ports: s.ports ?? [], memMB: s.memMB ?? 10, check: s.check, portsFrom: s.portsFrom };
  }
  // Servicios del sistema base que no tienen paquete propio.
  if (name === 'systemd-journald' || name === 'ufw') return { kind: 'package', name, description: name, command: `/lib/systemd/${name}`, user: 'root', ports: [], memMB: 2 };
  return null;
}

/** Arranca un servicio. @returns null si arrancó, o el motivo del fallo. */
export function startService(fs: VirtualFileSystem, machine: MachineState, info: ServiceInfo): string | null {
  const now = fs.now();
  const state = (machine.services[info.name] ??= { active: false, enabled: false, since: now });
  if (state.active) return null;

  let command: string;
  let user: string;
  let ports: number[] = [];
  let mem = 10;
  if (info.kind === 'custom' && info.name.endsWith('.timer')) {
    // Un temporizador activa su .service del mismo nombre según OnCalendar.
    const service = info.name.replace(/\.timer$/, '.service');
    if (!customUnits(fs).some((u) => u.name === service)) {
      return `Failed to start ${info.name}: Unit ${service} not found.`;
    }
    state.active = true;
    state.failed = undefined;
    state.since = now;
    addJournal(machine, now, 'systemd', `Started ${info.name} - ${info.description}.`);
    return null;
  }
  if (info.kind === 'custom') {
    const unit = info.unit;
    if (unit.errors.length) {
      state.failed = 'bad-setting';
      addJournal(machine, now, info.name, unit.errors.join('\n'), 3);
      return `Failed to start ${info.name}.service: Unit ${info.name}.service has a bad unit file setting.`;
    }
    const program = unit.execStart.split(/\s+/)[0];
    if (!program.startsWith('/')) {
      state.failed = 'bad-setting';
      addJournal(machine, now, info.name, `${unit.path}: Neither a valid executable name nor an absolute path: ${program}`, 3);
      return `Failed to start ${info.name}.service: Unit ${info.name}.service has a bad unit file setting.`;
    }
    const executable = fs.privileged(() => fs.tryStat(program));
    if (!executable || executable.type !== 'file' || (executable.mode & 0o111) === 0) {
      state.active = false;
      state.failed = `Main process exited, code=exited, status=203/EXEC`;
      addJournal(machine, now, info.name, `${info.name}.service: Failed to execute ${program}: ${executable ? 'Permission denied' : 'No such file or directory'}`, 3);
      addJournal(machine, now, info.name, `${info.name}.service: Main process exited, code=exited, status=203/EXEC`, 3);
      addJournal(machine, now, 'systemd', `${info.name}.service: Failed with result 'exit-code'.`, 3);
      return `Job for ${info.name}.service failed because the control process exited with error code.\nSee "systemctl status ${info.name}.service" and "journalctl -xeu ${info.name}.service" for details.`;
    }
    if (!findUser(fs, unit.user)) {
      state.failed = 'Main process exited, code=exited, status=217/USER';
      addJournal(machine, now, info.name, `${info.name}.service: Failed to determine user credentials: No such process`, 3);
      return `Job for ${info.name}.service failed because the control process exited with error code.\nSee "systemctl status ${info.name}.service" and "journalctl -xeu ${info.name}.service" for details.`;
    }
    command = unit.execStart;
    user = unit.user;
    // Puerto: Environment=PORT=..., un --port en ExecStart, o el que use el script (listen(3000)).
    let port: string | undefined = unit.env.PORT ?? /(?:--port[= ]|-p |:)(\d{2,5})\b/.exec(unit.execStart)?.[1];
    if (!port) {
      const script = unit.execStart.split(/\s+/)[1];
      const source = script ? fs.privileged(() => (fs.isFile(script) ? fs.readFile(script) : '')) : '';
      port = /(?:PORT\s*\|\|\s*|listen\(\s*)(\d{2,5})/.exec(source)?.[1];
    }
    if (port) ports = [Number(port)];
  } else {
    const error = info.check?.(fs, machine) ?? null;
    if (error) {
      state.active = false;
      state.failed = 'Control process exited, code=exited, status=1/FAILURE';
      for (const line of error.split('\n')) addJournal(machine, now, info.name, line, 3);
      addJournal(machine, now, 'systemd', `${info.name}.service: Failed with result 'exit-code'.`, 3);
      return `Job for ${info.name}.service failed because the control process exited with error code.\nSee "systemctl status ${info.name}.service" and "journalctl -xeu ${info.name}.service" for details.`;
    }
    command = info.command;
    user = info.user;
    ports = info.portsFrom?.(fs, machine) ?? info.ports;
    mem = info.memMB;
  }

  // Un puerto solo puede tenerlo un proceso.
  for (const port of ports) {
    const owner = machine.processes.find((p) => p.ports?.includes(port));
    if (owner) {
      state.failed = 'Control process exited, code=exited, status=1/FAILURE';
      addJournal(machine, now, info.name, `bind() to 0.0.0.0:${port} failed (98: Address already in use)`, 3);
      return `Job for ${info.name}.service failed because the control process exited with error code.\nSee "systemctl status ${info.name}.service" and "journalctl -xeu ${info.name}.service" for details.`;
    }
  }

  spawnProcess(machine, now, { user, command, cpu: 0.1, mem: +(mem / machine.memoryMB * 100).toFixed(1), rss: mem * 1024, ports, service: info.name });
  state.active = true;
  state.failed = undefined;
  state.since = now;
  addJournal(machine, now, 'systemd', `Started ${info.name}.service - ${info.description}.`);
  return null;
}

export function stopService(fs: VirtualFileSystem, machine: MachineState, name: string): void {
  const now = fs.now();
  const state = machine.services[name];
  if (state?.active) packageService(name)?.service.onStop?.(fs, machine);
  machine.processes = machine.processes.filter((p) => p.service !== name);
  if (state) {
    if (state.active) addJournal(machine, now, 'systemd', `Stopped ${name}.service.`);
    state.active = false;
    state.failed = undefined;
    state.since = now;
  }
}
