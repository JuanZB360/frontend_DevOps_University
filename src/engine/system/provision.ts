/**
 * Aprovisionamiento del sistema simulado.
 *
 * Completa (sin pisar lo que el jugador haya cambiado) los archivos de
 * sistema que necesitan los capítulos avanzados: sudoers, grupos, logs,
 * configuración de SSH, cron, systemd, apt... Es idempotente: se ejecuta
 * en cada arranque, así las partidas antiguas reciben lo nuevo.
 */
import type { VirtualFileSystem } from '../vfs/VirtualFileSystem';
import { findGroup, listGroups, setGroupMembers } from './accounts';
import { loadMachine } from './machine';
import { SSHD_CONFIG } from './sshd';
import { findPackage } from './packages';

/** sshd_config antiguo de las primeras versiones (se sustituye por el completo). */
const LEGACY_SSHD = '#Port 22\nPermitRootLogin prohibit-password\nPasswordAuthentication yes\n';


const SUDOERS = `#
# Este archivo DEBE editarse con el comando 'visudo' como root.
# Mejor aún: añade tus reglas en /etc/sudoers.d/ (un archivo por regla).
#
Defaults	env_reset
Defaults	secure_path="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# Usuario  host=(como_quien)  comandos
root	ALL=(ALL:ALL) ALL

# Los miembros del grupo sudo pueden ejecutar cualquier comando
%sudo	ALL=(ALL:ALL) ALL

@includedir /etc/sudoers.d
`;

function unit(description: string, exec: string, extra = ''): string {
  return `[Unit]\nDescription=${description}\nAfter=network.target\n\n[Service]\nExecStart=${exec}\n${extra}Restart=on-failure\n\n[Install]\nWantedBy=multi-user.target\n`;
}

function syslogLines(host: string): string {
  return [
    `Nov 15 06:25:01 ${host} CRON[2211]: (root) CMD (test -x /usr/sbin/anacron || run-parts --report /etc/cron.daily)`,
    `Nov 15 06:25:03 ${host} systemd[1]: Starting logrotate.service - Rotate log files...`,
    `Nov 15 06:25:03 ${host} systemd[1]: logrotate.service: Deactivated successfully.`,
    `Nov 15 09:14:22 ${host} systemd[1]: Started ssh.service - OpenBSD Secure Shell server.`,
    `Nov 15 12:00:01 ${host} CRON[3120]: (root) CMD (/usr/local/bin/limpieza.sh)`,
    `Nov 15 23:59:59 ${host} kernel: [86399.120443] EXT4-fs (sda1): mounted filesystem with ordered data mode.`,
  ].join('\n') + '\n';
}

function authLogLines(host: string): string {
  const lines: string[] = [];
  const attackers = ['185.220.101.47', '45.155.205.233', '185.220.101.47', '103.152.118.12'];
  let t = 0;
  for (let i = 0; i < 24; i++) {
    const ip = i % 3 === 0 ? attackers[1] : i % 5 === 0 ? attackers[3] : attackers[0];
    const user = ['root', 'admin', 'test', 'oracle', 'ubuntu'][i % 5];
    const mm = String(10 + Math.floor(t / 60)).padStart(2, '0');
    const ss = String(t % 60).padStart(2, '0');
    lines.push(`Nov 16 03:${mm}:${ss} ${host} sshd[${4100 + i}]: Failed password for ${user === 'root' ? 'root' : `invalid user ${user}`} from ${ip} port ${40000 + i * 37} ssh2`);
    t += 7;
  }
  lines.splice(5, 0, `Nov 16 03:11:02 ${host} sshd[4011]: Accepted publickey for deploy from 10.0.0.5 port 51122 ssh2: ED25519 SHA256:q1w2e3`);
  lines.push(`Nov 16 08:30:12 ${host} sudo:   deploy : TTY=pts/0 ; PWD=/home/deploy ; USER=root ; COMMAND=/usr/bin/systemctl restart nginx`);
  return lines.join('\n') + '\n';
}

/** Escribe el archivo solo si no existe (o si tiene exactamente el contenido antiguo). */
function ensureFile(fs: VirtualFileSystem, path: string, content: string, mode = 0o644, owner = 'root', group = owner, legacy?: string): void {
  const node = fs.tryStat(path);
  if (node && !(legacy !== undefined && node.type === 'file' && node.content === legacy)) return;
  fs.mkdir(path.slice(0, path.lastIndexOf('/')) || '/', true);
  fs.writeFile(path, content);
  fs.chmod(path, mode);
  fs.chown(path, owner, group);
}

function ensureDir(fs: VirtualFileSystem, path: string, mode = 0o755, owner = 'root', group = owner): void {
  if (fs.isDirectory(path)) return;
  fs.mkdir(path, true);
  fs.chmod(path, mode);
  fs.chown(path, owner, group);
}

/** Asegura que existe un grupo con ese GID y miembros. */
function ensureGroup(fs: VirtualFileSystem, name: string, gid: number, members: string[] = []): void {
  const existing = findGroup(fs, name);
  if (!existing) {
    const groups = listGroups(fs);
    const lines = [...groups.map((g) => `${g.name}:x:${g.gid}:${g.members.join(',')}`), `${name}:x:${gid}:${members.join(',')}`];
    fs.writeFile('/etc/group', lines.join('\n') + '\n');
    return;
  }
  const missing = members.filter((m) => !existing.members.includes(m));
  if (missing.length) setGroupMembers(fs, name, [...existing.members, ...missing]);
}

/**
 * Completa el sistema base. `player` es el usuario original (uid 1000), que
 * como en Ubuntu pertenece a los grupos sudo y adm.
 */
export function provisionSystem(fs: VirtualFileSystem, player: string, hostname: string): void {
  fs.privileged(() => {
    // Grupos estándar de Ubuntu.
    ensureGroup(fs, 'adm', 4, ['syslog', player]);
    ensureGroup(fs, 'sudo', 27, [player]);
    ensureGroup(fs, 'shadow', 42);
    ensureGroup(fs, 'users', 100);
    ensureGroup(fs, 'syslog', 110);
    ensureGroup(fs, 'ssh', 111);
    const passwd = fs.readFile('/etc/passwd');
    if (!passwd.includes('\nsyslog:')) {
      fs.writeFile('/etc/passwd', passwd + 'syslog:x:104:110::/home/syslog:/usr/sbin/nologin\nnobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin\n');
    }
    const shadow = fs.readFile('/etc/shadow');
    if (!shadow.includes(`\n${player}:`) && !shadow.startsWith(`${player}:`)) {
      fs.writeFile('/etc/shadow', shadow + `daemon:*:19700:0:99999:7:::\nwww-data:*:19700:0:99999:7:::\n${player}:$y$j9T$devopsu$simulado0000000:19700:0:99999:7:::\n`);
    }
    fs.chmod('/etc/shadow', 0o640);
    fs.chown('/etc/shadow', 'root', 'shadow');

    // sudo
    ensureFile(fs, '/etc/sudoers', SUDOERS, 0o440);
    ensureDir(fs, '/etc/sudoers.d', 0o750);
    ensureFile(fs, '/etc/sudoers.d/README', '# Archivos de reglas para sudo. Los nombres con punto o ~ se ignoran.\n', 0o440);
    ensureDir(fs, '/etc/skel');
    ensureFile(fs, '/etc/skel/.bashrc', "# ~/.bashrc\nalias ll='ls -alF'\n");

    // SSH
    ensureFile(fs, '/etc/ssh/sshd_config', SSHD_CONFIG, 0o644, 'root', 'root', LEGACY_SSHD);
    ensureDir(fs, '/etc/ssh/sshd_config.d');
    ensureFile(fs, '/etc/ssh/ssh_host_ed25519_key.pub', 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHostKeyDevopsU root@devops-u\n');

    // Red
    ensureFile(fs, '/etc/resolv.conf', 'nameserver 127.0.0.53\noptions edns0 trust-ad\nsearch .\n');
    ensureFile(fs, '/etc/fstab', '# <file system>                           <mount point> <type> <options> <dump> <pass>\nUUID=6f1c2a9e-1b7d-4c0e-9a41-2f6d1e0b7c11 /             ext4   defaults  0      1\nUUID=7A1B-2C3D                            /boot/efi     vfat   umask=0077 0     1\n');
    ensureFile(fs, '/etc/apt/sources.list', '# Repositorios de Ubuntu 24.04\ndeb http://archive.ubuntu.com/ubuntu noble main restricted universe multiverse\ndeb http://archive.ubuntu.com/ubuntu noble-updates main restricted universe multiverse\ndeb http://security.ubuntu.com/ubuntu noble-security main restricted universe multiverse\n');
    ensureDir(fs, '/etc/apt/sources.list.d');
    ensureDir(fs, '/var/cache/apt/archives');
    ensureDir(fs, '/var/lib/dpkg');

    // cron
    ensureFile(fs, '/etc/crontab', '# /etc/crontab: crontab del sistema\n# m h dom mon dow user  command\n17 *    * * *   root    cd / && run-parts --report /etc/cron.hourly\n25 6    * * *   root    test -x /usr/sbin/anacron || run-parts --report /etc/cron.daily\n');
    for (const d of ['/etc/cron.d', '/etc/cron.hourly', '/etc/cron.daily', '/etc/cron.weekly', '/etc/cron.monthly']) ensureDir(fs, d);
    ensureDir(fs, '/var/spool/cron/crontabs', 0o1730, 'root', 'crontab');

    // systemd
    ensureDir(fs, '/etc/systemd/system');
    ensureDir(fs, '/lib/systemd/system');
    ensureFile(fs, '/lib/systemd/system/ssh.service', unit('OpenBSD Secure Shell server', '/usr/sbin/sshd -D'));
    ensureFile(fs, '/lib/systemd/system/cron.service', unit('Regular background program processing daemon', '/usr/sbin/cron -f -P'));
    ensureFile(fs, '/lib/systemd/system/rsyslog.service', unit('System Logging Service', '/usr/sbin/rsyslogd -n -iNONE'));

    // logrotate
    ensureFile(fs, '/etc/logrotate.conf', '# Configuración global de logrotate\nweekly\nsu root adm\nrotate 4\ncreate\n#compress\ninclude /etc/logrotate.d\n');
    ensureDir(fs, '/etc/logrotate.d');
    ensureFile(fs, '/etc/logrotate.d/rsyslog', '/var/log/syslog\n/var/log/auth.log\n{\n\trotate 4\n\tweekly\n\tmissingok\n\tnotifempty\n\tcompress\n\tdelaycompress\n}\n');

    // ufw
    ensureDir(fs, '/etc/ufw/applications.d');
    ensureFile(fs, '/etc/ufw/applications.d/openssh-server', '[OpenSSH]\ntitle=Secure shell server\nports=22/tcp\n');
    ensureFile(fs, '/etc/default/ufw', 'IPV6=yes\nDEFAULT_INPUT_POLICY="DROP"\nDEFAULT_OUTPUT_POLICY="ACCEPT"\n');

    // Logs
    ensureFile(fs, '/var/log/syslog', syslogLines(hostname), 0o640, 'syslog', 'adm', 'Nov 11 08:00:01 devops-u systemd[1]: Started Daily apt download activities.\n');
    ensureFile(fs, '/var/log/auth.log', authLogLines(hostname), 0o640, 'syslog', 'adm', 'Nov 11 08:02:13 devops-u sshd[812]: Accepted publickey for root from 10.0.0.5 port 51122\n');
    ensureFile(fs, '/var/log/kern.log', `Nov 15 09:14:20 ${hostname} kernel: [    0.000000] Linux version 6.8.0-devops\n`, 0o640, 'syslog', 'adm');
    ensureFile(fs, '/var/log/dpkg.log', '2024-11-10 10:00:01 startup archives install\n', 0o644);
    ensureDir(fs, '/var/log/apt');
    ensureDir(fs, '/var/log/journal', 0o2755, 'root', 'systemd-journal');

    // Varios
    ensureDir(fs, '/usr/local/sbin');
    ensureDir(fs, '/mnt');
    ensureDir(fs, '/media');
    ensureDir(fs, '/backup');
    ensureFile(fs, '/proc/cpuinfo', 'processor\t: 0\nmodel name\t: Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz\ncpu cores\t: 2\n\nprocessor\t: 1\nmodel name\t: Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz\ncpu cores\t: 2\n', 0o444);
    ensureFile(fs, '/proc/version', 'Linux version 6.8.0-devops (gcc 13.2.0) #1 SMP PREEMPT_DYNAMIC\n', 0o444);
  });
  // Programas de los paquetes instalados (curl, nano, git...) en /usr/bin.
  const machine = loadMachine(fs);
  fs.privileged(() => {
    for (const [name, state] of Object.entries(machine.packages)) {
      if (state.status !== 'installed') continue;
      for (const binary of findPackage(name)?.binaries ?? []) {
        const path = `/usr/bin/${binary}`;
        if (fs.exists(path)) continue;
        fs.writeFile(path, `#!ELF binario simulado: ${binary}\n`);
        fs.chmod(path, 0o755);
      }
    }
  });
}
