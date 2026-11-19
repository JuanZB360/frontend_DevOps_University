/**
 * "Imagen de instalación" del sistema operativo simulado.
 *
 * Construye el árbol de directorios estándar (FHS) de un Ubuntu Server recién
 * instalado. Se usa una sola vez al crear un jugador; a partir de ahí el árbol
 * evoluciona con lo que haga el alumno y se persiste.
 */
import type { DirNode, FileNode, FsNode, SymlinkNode } from '../vfs/types';

interface NodeOptions {
  mode?: number;
  owner?: string;
  group?: string;
}

const NOW = Date.now();

function file(name: string, content: string, opts: NodeOptions = {}): FileNode {
  return {
    type: 'file', name, content,
    mode: opts.mode ?? 0o644, owner: opts.owner ?? 'root', group: opts.group ?? opts.owner ?? 'root', mtime: NOW,
  };
}

function dir(name: string, children: FsNode[] = [], opts: NodeOptions = {}): DirNode {
  return {
    type: 'dir', name, children: Object.fromEntries(children.map((c) => [c.name, c])),
    mode: opts.mode ?? 0o755, owner: opts.owner ?? 'root', group: opts.group ?? opts.owner ?? 'root', mtime: NOW,
  };
}

function link(name: string, target: string): SymlinkNode {
  return { type: 'symlink', name, target, mode: 0o777, owner: 'root', group: 'root', mtime: NOW };
}

/** Binarios "instalados": solo sirven para que `ls /usr/bin` y `which` sean realistas. */
function binaries(names: readonly string[]): FileNode[] {
  return names.map((n) => file(n, `#!ELF binario simulado: ${n}\n`, { mode: 0o755 }));
}

/**
 * Crea el sistema de archivos inicial para `user`.
 * @param commandNames comandos registrados en el shell (aparecerán en /usr/bin).
 */
export function createBaseFilesystem(user: string, hostname: string, commandNames: readonly string[]): DirNode {
  const userOpts = { owner: user, group: user };

  return dir('', [
    link('bin', 'usr/bin'), // En Ubuntu moderno /bin es un enlace a /usr/bin
    dir('boot', [file('vmlinuz-6.8.0-devops', '')]),
    dir('dev', [file('null', '', { mode: 0o666 })]),
    dir('etc', [
      file('hostname', `${hostname}\n`),
      file('hosts', `127.0.0.1\tlocalhost\n127.0.1.1\t${hostname}\n`),
      file('os-release', 'NAME="Ubuntu"\nVERSION="24.04 LTS (Noble Numbat)"\nID=ubuntu\nPRETTY_NAME="Ubuntu 24.04 LTS"\n'),
      file('passwd',
        'root:x:0:0:root:/root:/bin/bash\n' +
        'daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin\n' +
        'www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin\n' +
        `${user}:x:1000:1000:${user}:/home/${user}:/bin/bash\n`),
      file('group', `root:x:0:\nsudo:x:27:\nwww-data:x:33:\n${user}:x:1000:\n`),
      file('shadow', 'root:*:19000:0:99999:7:::\n', { mode: 0o640, group: 'shadow' }),
      file('motd', 'Bienvenido a DevOps University. Nadie sale de aquí sin dominar la terminal.\n'),
      dir('ssh', [file('sshd_config', '#Port 22\nPermitRootLogin prohibit-password\nPasswordAuthentication yes\n')]),
      dir('cron.d'),
      dir('systemd', [dir('system')]),
    ]),
    dir('home', [
      dir(user, [
        file('.bashrc', '# ~/.bashrc: se ejecuta en cada shell interactiva\nalias ll=\'ls -alF\'\nexport EDITOR=nano\n', userOpts),
        file('.profile', '# ~/.profile: se ejecuta al iniciar sesión\n', userOpts),
      ], { ...userOpts, mode: 0o750 }),
    ]),
    dir('opt'),
    dir('root', [file('.bashrc', '# bashrc de root\n')], { mode: 0o700 }),
    dir('srv'),
    dir('tmp', [], { mode: 0o1777 }),
    dir('usr', [
      dir('bin', binaries(commandNames)),
      dir('local', [dir('bin')]),
      dir('share', [dir('doc')]),
    ]),
    dir('var', [
      dir('log', [
        file('syslog', 'Nov 11 08:00:01 devops-u systemd[1]: Started Daily apt download activities.\n'),
        file('auth.log', 'Nov 11 08:02:13 devops-u sshd[812]: Accepted publickey for root from 10.0.0.5 port 51122\n', { mode: 0o640, group: 'adm' }),
      ]),
      dir('www'),
      dir('tmp', [], { mode: 0o1777 }),
    ]),
  ]);
}
