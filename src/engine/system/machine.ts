/**
 * Estado del "hardware y kernel" simulado: procesos, paquetes, servicios,
 * discos, red y cortafuegos.
 *
 * Se guarda como JSON dentro del propio sistema de archivos virtual
 * (/var/lib/devops-u/machine.json, solo root). Así se persiste junto con la
 * partida sin cambiar su formato, y las misiones pueden prepararlo y validarlo.
 *
 * Los usuarios y grupos NO están aquí: viven en /etc/passwd, /etc/group y
 * /etc/shadow, como en un Linux real (ver accounts.ts).
 */
import type { VirtualFileSystem } from '../vfs/VirtualFileSystem';

export const MACHINE_FILE = '/var/lib/devops-u/machine.json';

export interface Process {
  pid: number;
  ppid: number;
  user: string;
  /** Línea de comandos completa (lo que muestra ps aux). */
  command: string;
  cpu: number;
  mem: number;
  /** Memoria residente en KB. */
  rss: number;
  state: 'S' | 'R' | 'T' | 'Z';
  nice: number;
  start: number;
  tty: string;
  /** Puertos TCP en escucha. */
  ports?: number[];
  /** Servicio de systemd al que pertenece. */
  service?: string;
  /** Trabajo del shell (jobs) si se lanzó con &. */
  job?: number;
  /** Momento en que termina solo (sleep 300 &). */
  endsAt?: number;
  /** Sigue en marcha indefinidamente (servidores lanzados con &). */
  persistent?: boolean;
  /** Contenedor de Docker al que pertenece (o al que reenvía, si es docker-proxy). */
  container?: string;
  /** Archivos abiertos (para lsof). */
  files?: string[];
}

export type PackageStatus = 'installed' | 'half-configured' | 'config-files';

export interface InstalledPackage {
  version: string;
  status: PackageStatus;
  /** Instalado como dependencia de otro (apt autoremove lo puede quitar). */
  auto?: boolean;
}

export interface ServiceState {
  active: boolean;
  enabled: boolean;
  /** Motivo si el último arranque falló. */
  failed?: string;
  since: number;
  /** Proviene de un archivo .service del usuario (/etc/systemd/system). */
  custom?: boolean;
}

export interface UfwRule {
  action: 'allow' | 'deny' | 'reject' | 'limit';
  /** "22/tcp", "80", "OpenSSH", "Nginx Full"... */
  to: string;
  from: string;
  direction: 'in' | 'out';
}

export interface Disk {
  name: string;
  sizeGB: number;
  model: string;
  partitions: { name: string; sizeGB: number; fstype: string | null; uuid: string }[];
}

export interface Mount {
  device: string;
  target: string;
  fstype: string;
  options: string;
}

export interface JournalEntry {
  time: number;
  unit: string;
  priority: number; // 0 emerg ... 3 err, 4 warning, 6 info
  message: string;
}

export interface MachineState {
  version: 1;
  bootTime: number;
  nextPid: number;
  nextJob: number;
  processes: Process[];
  packages: Record<string, InstalledPackage>;
  aptUpdatedAt: number | null;
  services: Record<string, ServiceState>;
  disks: Disk[];
  mounts: Mount[];
  /** GB usados en / por el sistema base (además de los archivos del VFS). */
  baseUsedGB: number;
  firewall: {
    ufwEnabled: boolean;
    defaultIncoming: 'allow' | 'deny' | 'reject';
    defaultOutgoing: 'allow' | 'deny' | 'reject';
    rules: UfwRule[];
    iptables: string[];
    banned: Record<string, string[]>;
  };
  /** Memoria total en MB. */
  memoryMB: number;
  swapMB: number;
  journal: JournalEntry[];
  /** Hosts remotos a los que el jugador ha copiado su clave (ssh-copy-id). */
  remoteKeys: Record<string, string[]>;
  /** Archivos de configuración de nginx cargados en su último arranque/reload. */
  nginxFiles?: Record<string, string>;
  /** sshd_config que aplica el servidor SSH (el de su último arranque). */
  sshdConfig?: string;
  /** Contenido de las unidades propias en el último daemon-reload. */
  loadedUnits?: Record<string, string>;
}

const BASE_PROCESSES: Omit<Process, 'pid' | 'ppid' | 'start'>[] = [
  { user: 'root', command: '/sbin/init', cpu: 0, mem: 0.3, rss: 12_400, state: 'S', nice: 0, tty: '?' },
  { user: 'root', command: '/lib/systemd/systemd-journald', cpu: 0, mem: 0.4, rss: 16_800, state: 'S', nice: 0, tty: '?', service: 'systemd-journald' },
  { user: 'syslog', command: '/usr/sbin/rsyslogd -n -iNONE', cpu: 0, mem: 0.1, rss: 5_200, state: 'S', nice: 0, tty: '?', service: 'rsyslog' },
  { user: 'root', command: '/usr/sbin/cron -f -P', cpu: 0, mem: 0.1, rss: 2_800, state: 'S', nice: 0, tty: '?', service: 'cron' },
  { user: 'root', command: 'sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups', cpu: 0, mem: 0.2, rss: 7_900, state: 'S', nice: 0, tty: '?', service: 'ssh', ports: [22] },
];

export function defaultMachine(now: number): MachineState {
  const bootTime = now - 3 * 86_400_000 - 4 * 3_600_000;
  let pid = 1;
  const processes: Process[] = BASE_PROCESSES.map((p, i) => ({ ...p, pid: i === 0 ? 1 : (pid += 300 + i * 17), ppid: i === 0 ? 0 : 1, start: bootTime }));
  return {
    version: 1,
    bootTime,
    nextPid: 2000,
    nextJob: 1,
    processes,
    packages: {
      'openssh-server': { version: '1:9.6p1-3ubuntu13', status: 'installed' },
      cron: { version: '3.0pl1-184ubuntu2', status: 'installed' },
      rsyslog: { version: '8.2312.0-3ubuntu9', status: 'installed' },
      ufw: { version: '0.36.2-6', status: 'installed' },
      curl: { version: '8.5.0-2ubuntu10', status: 'installed' },
      nano: { version: '7.2-2build1', status: 'installed' },
      tar: { version: '1.35+dfsg-3build1', status: 'installed' },
      gzip: { version: '1.12-1ubuntu3', status: 'installed' },
      git: { version: '1:2.43.0-1ubuntu7', status: 'installed' },
      python3: { version: '3.12.3-0ubuntu1', status: 'installed' },
      logrotate: { version: '3.21.0-2build1', status: 'installed' },
      tree: { version: '2.1.1-2ubuntu3', status: 'installed' },
      'iproute2': { version: '6.1.0-1ubuntu6', status: 'installed' },
      'dnsutils': { version: '1:9.18.24-0ubuntu5', status: 'installed' },
      'mlocate': { version: '1.1.18-1ubuntu1', status: 'installed' },
    },
    aptUpdatedAt: null,
    services: {
      ssh: { active: true, enabled: true, since: bootTime },
      cron: { active: true, enabled: true, since: bootTime },
      rsyslog: { active: true, enabled: true, since: bootTime },
      'systemd-journald': { active: true, enabled: true, since: bootTime },
      ufw: { active: true, enabled: true, since: bootTime },
    },
    disks: [
      {
        name: 'sda', sizeGB: 20, model: 'QEMU HARDDISK',
        partitions: [
          { name: 'sda1', sizeGB: 19, fstype: 'ext4', uuid: '6f1c2a9e-1b7d-4c0e-9a41-2f6d1e0b7c11' },
          { name: 'sda15', sizeGB: 1, fstype: 'vfat', uuid: '7A1B-2C3D' },
        ],
      },
      { name: 'sdb', sizeGB: 50, model: 'QEMU HARDDISK', partitions: [] },
    ],
    mounts: [
      { device: '/dev/sda1', target: '/', fstype: 'ext4', options: 'rw,relatime' },
      { device: '/dev/sda15', target: '/boot/efi', fstype: 'vfat', options: 'rw,relatime' },
    ],
    baseUsedGB: 6.8,
    firewall: { ufwEnabled: false, defaultIncoming: 'deny', defaultOutgoing: 'allow', rules: [], iptables: [], banned: {} },
    memoryMB: 3_916,
    swapMB: 0,
    journal: [
      { time: bootTime, unit: 'kernel', priority: 6, message: 'Linux version 6.8.0-devops (buildd@devops-u) #1 SMP PREEMPT_DYNAMIC' },
      { time: bootTime + 2_000, unit: 'systemd', priority: 6, message: 'Started ssh.service - OpenBSD Secure Shell server.' },
      { time: bootTime + 2_100, unit: 'systemd', priority: 6, message: 'Started cron.service - Regular background program processing daemon.' },
    ],
    remoteKeys: {},
  };
}

/** Lee el estado de la máquina (lo crea si no existe). */
export function loadMachine(fs: VirtualFileSystem): MachineState {
  return fs.privileged(() => {
    try {
      return JSON.parse(fs.readFile(MACHINE_FILE)) as MachineState;
    } catch {
      const machine = defaultMachine(fs.now());
      writeMachine(fs, machine);
      return machine;
    }
  });
}

function writeMachine(fs: VirtualFileSystem, machine: MachineState): void {
  fs.privileged(() => {
    if (!fs.isDirectory('/var/lib/devops-u')) {
      fs.mkdir('/var/lib/devops-u', true);
      fs.chmod('/var/lib/devops-u', 0o700);
    }
    fs.writeFile(MACHINE_FILE, JSON.stringify(machine));
    fs.chmod(MACHINE_FILE, 0o600);
  });
}

/** Modifica el estado de la máquina de forma atómica y lo guarda. */
export function updateMachine<T>(fs: VirtualFileSystem, fn: (machine: MachineState) => T): T {
  const machine = loadMachine(fs);
  reapFinished(machine, fs.now());
  const result = fn(machine);
  writeMachine(fs, machine);
  return result;
}

/** Elimina los procesos que ya terminaron solos (sleep N &). */
export function reapFinished(machine: MachineState, now: number): void {
  machine.processes = machine.processes.filter((p) => p.endsAt === undefined || p.endsAt > now);
}

/** Vista de solo lectura actualizada (sin procesos ya terminados). */
export function readMachine(fs: VirtualFileSystem): MachineState {
  const machine = loadMachine(fs);
  reapFinished(machine, fs.now());
  return machine;
}

// ─────────────────────────────── Procesos ───────────────────────────────

export function spawnProcess(machine: MachineState, now: number, process: Omit<Process, 'pid' | 'start' | 'ppid' | 'state' | 'nice' | 'tty'> & Partial<Process>): Process {
  const created: Process = {
    ppid: 1, state: 'S', nice: 0, tty: '?', start: now,
    ...process,
    pid: machine.nextPid,
  };
  machine.nextPid += 1 + Math.floor(Math.random() * 7);
  machine.processes.push(created);
  return created;
}

export function addJournal(machine: MachineState, now: number, unit: string, message: string, priority = 6): void {
  machine.journal.push({ time: now, unit, priority, message });
  if (machine.journal.length > 400) machine.journal.splice(0, machine.journal.length - 400);
}

/** Puertos en escucha: [puerto, proceso]. */
export function listeningSockets(machine: MachineState): { port: number; process: Process }[] {
  return machine.processes.flatMap((process) => (process.ports ?? []).map((port) => ({ port, process })));
}

export function isInstalled(machine: MachineState, name: string): boolean {
  return machine.packages[name]?.status === 'installed';
}
