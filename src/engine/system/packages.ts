/**
 * Catálogo de paquetes del repositorio simulado de Ubuntu y servicios que
 * instalan. Los módulos (Nginx, Docker, bases de datos...) añaden aquí lo suyo
 * con `registerPackages`.
 */
import type { VirtualFileSystem } from '../vfs/VirtualFileSystem';
import type { MachineState } from './machine';
import { sshServiceCheck } from './sshd';

export interface ServiceDefinition {
  /** Nombre de la unidad sin ".service". */
  name: string;
  description: string;
  command: string;
  user: string;
  ports?: number[];
  memMB?: number;
  /** Se arranca y habilita al instalar (lo normal en Debian/Ubuntu). */
  autoStart?: boolean;
  /** Puertos calculados a partir de su configuración (nginx escucha donde digan sus `listen`). */
  portsFrom?: (fs: VirtualFileSystem, machine: MachineState) => number[];
  /** Comprueba la configuración antes de arrancar. Devuelve el error o null. */
  check?: (fs: VirtualFileSystem, machine: MachineState) => string | null;
  /** Al parar el servicio (ej. docker para sus contenedores). */
  onStop?: (fs: VirtualFileSystem, machine: MachineState) => void;
}

export interface PackageDefinition {
  name: string;
  version: string;
  section: string;
  description: string;
  /** Tamaño instalado en KB. */
  sizeKB: number;
  depends?: string[];
  /** Comandos que aporta (se crean en /usr/bin). */
  binaries?: string[];
  /** Archivos de configuración y datos que instala. */
  files?: Record<string, string>;
  /** Directorios a crear: [ruta, modo, dueño]. */
  dirs?: [string, number, string][];
  service?: ServiceDefinition;
  /** Usuario de sistema que crea (www-data, postgres, redis...). */
  systemUser?: string;
  /** Versión más nueva disponible (para apt list --upgradable). */
  upgradeTo?: string;
}

const catalog = new Map<string, PackageDefinition>();

export function registerPackages(...packages: PackageDefinition[]): void {
  for (const p of packages) catalog.set(p.name, p);
}

export function findPackage(name: string): PackageDefinition | undefined {
  return catalog.get(name);
}

export function allPackages(): PackageDefinition[] {
  return [...catalog.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Servicios definidos por paquetes (por nombre de unidad). */
export function packageService(name: string): { pkg: PackageDefinition; service: ServiceDefinition } | undefined {
  for (const pkg of catalog.values()) if (pkg.service?.name === name) return { pkg, service: pkg.service };
  return undefined;
}

// ─────────────────────────────── Paquetes base ───────────────────────────────

registerPackages(
  { name: 'openssh-server', version: '1:9.6p1-3ubuntu13', section: 'net', description: 'secure shell (SSH) server, for secure access from remote machines', sizeKB: 1_890, binaries: ['sshd'],
    service: { name: 'ssh', description: 'OpenBSD Secure Shell server', command: 'sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups', user: 'root', ports: [22], memMB: 8, check: sshServiceCheck } },
  { name: 'cron', version: '3.0pl1-184ubuntu2', section: 'admin', description: 'process scheduling daemon', sizeKB: 240,
    service: { name: 'cron', description: 'Regular background program processing daemon', command: '/usr/sbin/cron -f -P', user: 'root', memMB: 3 } },
  { name: 'rsyslog', version: '8.2312.0-3ubuntu9', section: 'admin', description: 'reliable system and kernel logging daemon', sizeKB: 1_680,
    service: { name: 'rsyslog', description: 'System Logging Service', command: '/usr/sbin/rsyslogd -n -iNONE', user: 'syslog', memMB: 5 } },
  { name: 'ufw', version: '0.36.2-6', section: 'admin', description: 'program for managing a Netfilter firewall', sizeKB: 870, binaries: ['ufw'] },
  { name: 'curl', version: '8.5.0-2ubuntu10', section: 'web', description: 'command line tool for transferring data with URL syntax', sizeKB: 510, binaries: ['curl'] },
  { name: 'wget', version: '1.21.4-1ubuntu4', section: 'web', description: 'retrieves files from the web', sizeKB: 960, binaries: ['wget'] },
  { name: 'nano', version: '7.2-2build1', section: 'editors', description: 'small, friendly text editor inspired by Pico', sizeKB: 880, binaries: ['nano'] },
  { name: 'vim', version: '2:9.1.0016-1ubuntu7', section: 'editors', description: 'Vi IMproved - enhanced vi editor', sizeKB: 4_100, binaries: ['vim'] },
  { name: 'tar', version: '1.35+dfsg-3build1', section: 'utils', description: 'GNU version of the tar archiving utility', sizeKB: 960, binaries: ['tar'] },
  { name: 'gzip', version: '1.12-1ubuntu3', section: 'utils', description: 'GNU compression utilities', sizeKB: 250, binaries: ['gzip', 'gunzip', 'zcat'] },
  { name: 'zip', version: '3.0-13build1', section: 'utils', description: 'Archiver for .zip files', sizeKB: 600, binaries: ['zip'] },
  { name: 'unzip', version: '6.0-28ubuntu4', section: 'utils', description: 'De-archiver for .zip files', sizeKB: 390, binaries: ['unzip'] },
  { name: 'git', version: '1:2.43.0-1ubuntu7', section: 'vcs', description: 'fast, scalable, distributed revision control system', sizeKB: 21_000, binaries: ['git'], upgradeTo: '1:2.43.0-1ubuntu7.1' },
  { name: 'python3', version: '3.12.3-0ubuntu1', section: 'python', description: 'interactive high-level object-oriented language', sizeKB: 90, binaries: ['python3'] },
  { name: 'logrotate', version: '3.21.0-2build1', section: 'admin', description: 'Log rotation utility', sizeKB: 200, binaries: ['logrotate'] },
  { name: 'tree', version: '2.1.1-2ubuntu3', section: 'utils', description: 'displays an indented directory tree, in color', sizeKB: 120, binaries: ['tree'] },
  { name: 'iproute2', version: '6.1.0-1ubuntu6', section: 'net', description: 'networking and traffic control tools', sizeKB: 3_200, binaries: ['ip', 'ss'] },
  { name: 'dnsutils', version: '1:9.18.24-0ubuntu5', section: 'net', description: 'Clients provided with BIND 9 (dig, nslookup)', sizeKB: 150, binaries: ['dig', 'nslookup', 'host'] },
  { name: 'mlocate', version: '1.1.18-1ubuntu1', section: 'utils', description: 'quickly find files on the filesystem based on their name', sizeKB: 200, binaries: ['locate', 'updatedb'] },
  { name: 'htop', version: '3.3.0-4build1', section: 'utils', description: 'interactive processes viewer', sizeKB: 400, binaries: ['htop'] },
  { name: 'sysstat', version: '12.6.1-2', section: 'admin', description: 'system performance tools for Linux (iostat, sar)', sizeKB: 1_700, binaries: ['iostat'] },
  { name: 'net-tools', version: '2.10-0.1ubuntu4', section: 'net', description: 'NET-3 networking toolkit (ifconfig, netstat) — obsoleto, usa ip y ss', sizeKB: 800, binaries: ['ifconfig', 'netstat'] },
  { name: 'rsync', version: '3.2.7-1ubuntu1', section: 'net', description: 'fast, versatile, remote (and local) file-copying tool', sizeKB: 760, binaries: ['rsync'] },
  { name: 'fail2ban', version: '1.0.2-3ubuntu0.1', section: 'net', description: 'ban hosts that cause multiple authentication errors', sizeKB: 2_100, binaries: ['fail2ban-client'], depends: ['python3'],
    files: {
      '/etc/fail2ban/jail.conf': '# NO edites este archivo: copia lo que quieras cambiar a jail.local\n[DEFAULT]\nbantime  = 10m\nfindtime = 10m\nmaxretry = 5\n\n[sshd]\nport    = ssh\nlogpath = %(sshd_log)s\n',
      '/etc/fail2ban/jail.d/defaults-debian.conf': '[sshd]\nenabled = true\n',
    },
    service: { name: 'fail2ban', description: 'Fail2Ban Service', command: '/usr/bin/python3 /usr/bin/fail2ban-server -xf start', user: 'root', memMB: 22, autoStart: true } },
  { name: 'build-essential', version: '12.10ubuntu1', section: 'devel', description: 'Informational list of build-essential packages (gcc, make...)', sizeKB: 20, depends: ['make'] },
  { name: 'make', version: '4.3-4.1build2', section: 'devel', description: 'utility for directing compilation', sizeKB: 410, binaries: ['make'] },
  { name: 'jq', version: '1.7.1-3build1', section: 'utils', description: 'lightweight and flexible command-line JSON processor', sizeKB: 100, binaries: ['jq'] },
  { name: 'cowsay', version: '3.03+dfsg2-8', section: 'games', description: 'configurable talking cow', sizeKB: 90, binaries: ['cowsay'] },
);
