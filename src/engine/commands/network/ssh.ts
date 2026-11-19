/**
 * SSH:
 *   ssh-keygen  ssh-copy-id  ssh  scp  rsync  sshd (-t comprueba la configuración)
 *
 * El servidor SSH aplica la configuración que tenía al último (re)arranque del
 * servicio, como en la realidad: editar sshd_config no basta, hay que
 * reiniciarlo (y antes comprobarlo con `sshd -t`).
 */
import { checkPassword, findUser, groupsOf, passwordStatus } from '../../system/accounts';
import { readMachine } from '../../system/machine';
import { activeSshdConfig, checkSshdConfig, parseSshdConfig } from '../../system/sshd';
import { isLocal, resolveHost } from '../../system/network';
import { ShellSession } from '../../system/ShellSession';
import { isFsError } from '../../vfs/errors';
import { basename, dirname, joinPath } from '../../vfs/path';
import type { VirtualFileSystem } from '../../vfs/VirtualFileSystem';
import type { Command, CommandContext } from '../Command';
import { EXIT_USAGE, fail } from '../helpers';

function randomKey(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export const sshKeygenCommand: Command = {
  name: 'ssh-keygen',
  category: 'red',
  summary: 'Crea un par de claves SSH (privada + pública)',
  async execute(ctx) {
    const value = (flag: string): string | undefined => {
      const i = ctx.args.indexOf(flag);
      return i !== -1 ? ctx.args[i + 1] : undefined;
    };
    const type = value('-t') ?? 'ed25519';
    if (!['ed25519', 'rsa', 'ecdsa'].includes(type)) return fail(ctx, `unknown key type ${type}`);
    const comment = value('-C') ?? `${ctx.session.username}@${ctx.session.hostname}`;
    let file = value('-f');
    let passphrase = value('-N');
    const defaultFile = `${ctx.session.home}/.ssh/id_${type}`;
    ctx.stdout.write(`Generating public/private ${type} key pair.\n`);
    if (!file) {
      const answer = ctx.terminal.readLine ? await ctx.terminal.readLine(`Enter file in which to save the key (${defaultFile}): `) : '';
      if (answer === null) return 1;
      file = answer.trim() || defaultFile;
    }
    const abs = ctx.resolve(file);
    if (ctx.fs.exists(abs)) {
      const overwrite = ctx.terminal.readLine ? await ctx.terminal.readLine(`${file} already exists.\nOverwrite (y/n)? `) : 'n';
      if (overwrite?.trim().toLowerCase() !== 'y') return 1;
    }
    if (passphrase === undefined) {
      const first = ctx.terminal.readLine ? await ctx.terminal.readLine('Enter passphrase (empty for no passphrase): ', { secret: true }) : '';
      const second = ctx.terminal.readLine ? await ctx.terminal.readLine('Enter same passphrase again: ', { secret: true }) : '';
      if (first === null || second === null) return 1;
      if (first !== second) return fail(ctx, 'Passphrases do not match.  Try again.');
      passphrase = first;
    }
    const body = randomKey(type === 'rsa' ? 360 : 68);
    const prefix = type === 'ed25519' ? 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI' : type === 'rsa' ? 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQ' : 'ecdsa-sha2-nistp256 AAAAE2VjZHNh';
    try {
      const dir = dirname(abs);
      if (!ctx.fs.exists(dir)) {
        ctx.fs.mkdir(dir, true);
        ctx.fs.chmod(dir, 0o700);
        ctx.stdout.write(`Created directory '${dir}'.\n`);
      }
      ctx.fs.writeFile(abs, `-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA${passphrase ? 'ENCRYPTED' : ''}${randomKey(180)}\n-----END OPENSSH PRIVATE KEY-----\n`);
      ctx.fs.chmod(abs, 0o600);
      ctx.fs.writeFile(abs + '.pub', `${prefix}${body} ${comment}\n`);
      ctx.fs.chmod(abs + '.pub', 0o644);
    } catch (error) {
      if (!isFsError(error)) throw error;
      return fail(ctx, `Saving key "${file}" failed: ${error.reason}`);
    }
    ctx.stdout.write(`Your identification has been saved in ${file}\nYour public key has been saved in ${file}.pub\nThe key fingerprint is:\nSHA256:${randomKey(43)} ${comment}\nThe key's randomart image is:\n+--[${type.toUpperCase()} 256]--+\n|   .o+*=+.       |\n|    o=.Bo.       |\n|   . .*.=o       |\n|    o. +.        |\n+----[SHA256]-----+\n`);
    return 0;
  },
};

/** "usuario@host" → partes. Sin usuario, el actual. */
function parseTarget(ctx: CommandContext, target: string): { user: string; host: string; path?: string } {
  const [userHost, path] = target.includes(':') ? [target.slice(0, target.indexOf(':')), target.slice(target.indexOf(':') + 1)] : [target, undefined];
  const at = userHost.lastIndexOf('@');
  return { user: at === -1 ? ctx.session.username : userHost.slice(0, at), host: at === -1 ? userHost : userHost.slice(at + 1), path };
}

/** Claves públicas del usuario actual. */
function myPublicKeys(ctx: CommandContext, identity?: string): string[] {
  const files = identity ? [identity.endsWith('.pub') ? identity : identity + '.pub'] : ['id_ed25519.pub', 'id_rsa.pub', 'id_ecdsa.pub'].map((f) => `${ctx.session.home}/.ssh/${f}`);
  return files.flatMap((f) => {
    try {
      return [ctx.fs.readFile(ctx.resolve(f)).trim()];
    } catch {
      return [];
    }
  });
}

/** ¿El authorized_keys de `user` acepta alguna de estas claves (y con permisos correctos)? */
function keyAccepted(fs: VirtualFileSystem, user: string, keys: string[]): 'ok' | 'missing' | 'bad-perms' {
  const entry = findUser(fs, user);
  if (!entry || keys.length === 0) return 'missing';
  const sshDir = `${entry.home}/.ssh`;
  const file = `${sshDir}/authorized_keys`;
  return fs.privileged(() => {
    if (!fs.exists(file)) return 'missing';
    const content = fs.readFile(file);
    const bodies = keys.map((k) => k.split(/\s+/)[1]);
    if (!content.split('\n').some((line) => bodies.includes(line.trim().split(/\s+/)[1]))) return 'missing';
    // StrictModes: ni .ssh ni authorized_keys pueden ser modificables por otros.
    const dirNode = fs.stat(sshDir);
    const fileNode = fs.stat(file);
    if ((dirNode.mode & 0o022) !== 0 || (fileNode.mode & 0o022) !== 0 || fileNode.owner !== user) return 'bad-perms';
    return 'ok';
  });
}

async function authenticate(ctx: CommandContext, user: string, host: string, identity?: string): Promise<boolean> {
  const config = activeSshdConfig(ctx.fs);
  const entry = findUser(ctx.fs, user);
  const deny = (): boolean => {
    ctx.stderr.write(`${user}@${host}: Permission denied (publickey${config.passwordAuthentication ? ',password' : ''}).\n`);
    return false;
  };
  if (!entry || entry.shell.endsWith('nologin')) return deny();
  if (user === 'root' && config.permitRootLogin === 'no') return deny();
  if (config.allowUsers && !config.allowUsers.includes(user)) return deny();
  if (config.allowGroups && !groupsOf(ctx.fs, user).some((g) => config.allowGroups!.includes(g))) return deny();
  if (config.pubkeyAuthentication && keyAccepted(ctx.fs, user, myPublicKeys(ctx, identity)) === 'ok') return true;
  if (!config.passwordAuthentication || (user === 'root' && config.permitRootLogin !== 'yes')) return deny();
  for (let attempt = 0; attempt < 3; attempt++) {
    const password = ctx.terminal.readLine ? await ctx.terminal.readLine(`${user}@${host}'s password: `, { secret: true }) : null;
    if (password === null) return deny();
    if (passwordStatus(ctx.fs, user) === 'P' && checkPassword(ctx.fs, user, password)) return true;
    ctx.stderr.write('Permission denied, please try again.\n');
  }
  return deny();
}

/** Comprueba que el host existe y escucha SSH. */
function connect(ctx: CommandContext, host: string, port: number): string | null {
  const ip = resolveHost(ctx.fs, host);
  if (!ip) {
    ctx.stderr.write(`ssh: Could not resolve hostname ${host}: Name or service not known\n`);
    return null;
  }
  if (!isLocal(ip)) {
    ctx.stderr.write(`ssh: connect to host ${host} port ${port}: Connection timed out\n\x1b[2m(en el simulador solo puedes conectarte a este servidor: localhost)\x1b[0m\n`);
    return null;
  }
  const machine = readMachine(ctx.fs);
  const config = activeSshdConfig(ctx.fs);
  if (!machine.services.ssh?.active || port !== config.port) {
    ctx.stderr.write(`ssh: connect to host ${host} port ${port}: Connection refused\n`);
    return null;
  }
  return ip;
}

export const sshCommand: Command = {
  name: 'ssh',
  category: 'red',
  summary: 'Se conecta a otro servidor (o usuario) de forma segura',
  async execute(ctx) {
    let port = 22;
    let identity: string | undefined;
    const rest: string[] = [];
    for (let i = 0; i < ctx.args.length; i++) {
      const arg = ctx.args[i];
      if (arg === '-p') port = Number(ctx.args[++i]);
      else if (arg === '-i') identity = ctx.args[++i];
      else if (arg === '-o' || arg === '-l') i++;
      else if (arg.startsWith('-') && rest.length === 0) continue;
      else rest.push(arg);
    }
    const [target, ...command] = rest;
    if (!target) return fail(ctx, 'usage: ssh [-p port] [-i identity_file] destination [command]', 255);
    const { user, host } = parseTarget(ctx, target);
    if (!connect(ctx, host, port)) return 255;
    if (!(await authenticate(ctx, user, host, identity))) return 255;
    if (command.length) {
      const groups = groupsOf(ctx.fs, user);
      return ctx.session.runAsAsync({ user, groups }, () => ctx.shell.runScript(command.join(' '), { newProcess: true }));
    }
    const entry = findUser(ctx.fs, user)!;
    ctx.stdout.write(`Welcome to Ubuntu 24.04 LTS (GNU/Linux 6.8.0-devops x86_64)\n\nLast login: ${new Date(ctx.fs.now() - 86_400_000).toUTCString()} from 10.0.0.5\n`);
    const snapshot = ShellSession.loginSnapshot(user, groupsOf(ctx.fs, user), ctx.session.hostname, entry.home);
    if (!ctx.fs.isDirectory(entry.home)) snapshot.cwd = '/';
    ctx.session.pushSession(snapshot);
    return 0;
  },
};

export const sshCopyIdCommand: Command = {
  name: 'ssh-copy-id',
  category: 'red',
  summary: 'Copia tu clave pública al servidor para entrar sin contraseña',
  async execute(ctx) {
    const iIndex = ctx.args.indexOf('-i');
    const identity = iIndex !== -1 ? ctx.args[iIndex + 1] : undefined;
    const target = ctx.args.find((a, i) => !a.startsWith('-') && (iIndex === -1 || i !== iIndex + 1));
    if (!target) return fail(ctx, 'Usage: /usr/bin/ssh-copy-id [-h|-?|-f|-n|-s|-x] [-i [identity_file]] [-p port] [user@]hostname', 1);
    const keys = myPublicKeys(ctx, identity);
    if (keys.length === 0) return fail(ctx, 'ERROR: No identities found\n\x1b[2m(primero crea tu par de claves con ssh-keygen)\x1b[0m');
    const { user, host } = parseTarget(ctx, target);
    ctx.stderr.write(`/usr/bin/ssh-copy-id: INFO: Source of key(s) to be installed: "${identity ?? `${ctx.session.home}/.ssh/id_ed25519.pub`}"\n`);
    if (!connect(ctx, host, 22)) return 1;
    if (keyAccepted(ctx.fs, user, keys) === 'ok') {
      ctx.stderr.write('/usr/bin/ssh-copy-id: WARNING: All keys were skipped because they already exist on the remote system.\n');
      return 0;
    }
    ctx.stderr.write('/usr/bin/ssh-copy-id: INFO: 1 key(s) remain to be installed -- if you are prompted now it is to install the new keys\n');
    if (!(await authenticate(ctx, user, host, identity))) return 1;
    const entry = findUser(ctx.fs, user)!;
    ctx.fs.privileged(() => {
      const dir = `${entry.home}/.ssh`;
      if (!ctx.fs.exists(dir)) ctx.fs.mkdir(dir, true);
      ctx.fs.chmod(dir, 0o700);
      ctx.fs.chown(dir, user, groupsOf(ctx.fs, user)[0]);
      const file = `${dir}/authorized_keys`;
      ctx.fs.writeFile(file, keys.join('\n') + '\n', true);
      ctx.fs.chmod(file, 0o600);
      ctx.fs.chown(file, user, groupsOf(ctx.fs, user)[0]);
    });
    ctx.stdout.write(`\nNumber of key(s) added: ${keys.length}\n\nNow try logging into the machine, with:   "ssh '${user}@${host}'"\nand check to make sure that only the key(s) you wanted were added.\n\n`);
    return 0;
  },
};

/** Copia local o "remota" (a otro usuario de esta máquina) para scp y rsync. */
async function copyTo(ctx: CommandContext, sources: string[], dest: string, recursive: boolean, verbose: boolean): Promise<number> {
  const remote = dest.includes(':') ? parseTarget(ctx, dest) : null;
  let destPath = dest;
  let runAs: { user: string; groups: string[] } | null = null;
  if (remote) {
    if (!connect(ctx, remote.host, 22)) return 255;
    if (!(await authenticate(ctx, remote.user, remote.host))) return 255;
    const home = findUser(ctx.fs, remote.user)!.home;
    destPath = !remote.path ? home : remote.path.startsWith('/') ? remote.path : joinPath(home, remote.path.replace(/^~\/?/, ''));
    runAs = { user: remote.user, groups: groupsOf(ctx.fs, remote.user) };
  }
  // Se leen los orígenes como el usuario actual y se escriben como el destino.
  const payload: { name: string; node: ReturnType<VirtualFileSystem['snapshot']> | string; isDir: boolean }[] = [];
  for (const source of sources) {
    const abs = ctx.resolve(source);
    try {
      const node = ctx.fs.stat(abs);
      if (node.type === 'dir' && !recursive) {
        ctx.stderr.write(`${ctx.name}: ${source}: not a regular file\n`);
        return 1;
      }
      payload.push({ name: basename(abs), node: node.type === 'dir' ? structuredClone(node) : ctx.fs.readFile(abs), isDir: node.type === 'dir' });
    } catch (error) {
      if (!isFsError(error)) throw error;
      ctx.stderr.write(`${ctx.name}: ${source}: ${error.reason}\n`);
      return 1;
    }
  }
  const write = (): void => {
    const base = remote ? destPath : ctx.resolve(destPath);
    const intoDir = ctx.fs.isDirectory(base) || sources.length > 1 || base.endsWith('/');
    for (const item of payload) {
      const target = intoDir ? joinPath(base, item.name) : base;
      if (verbose) ctx.stdout.write(`${item.name}${item.isDir ? '/' : ''}\n`);
      if (!item.isDir) {
        ctx.fs.writeFile(target, item.node as string);
        continue;
      }
      const copyDir = (node: ReturnType<VirtualFileSystem['snapshot']>, path: string): void => {
        ctx.fs.mkdir(path, true);
        for (const child of Object.values(node.children)) {
          if (child.type === 'dir') copyDir(child, joinPath(path, child.name));
          else if (child.type === 'file') ctx.fs.writeFile(joinPath(path, child.name), child.content);
        }
      };
      copyDir(item.node as ReturnType<VirtualFileSystem['snapshot']>, target);
    }
  };
  try {
    if (runAs) await ctx.session.runAsAsync(runAs, async () => write());
    else write();
  } catch (error) {
    if (!isFsError(error)) throw error;
    ctx.stderr.write(`${ctx.name}: ${dest}: ${error.reason}\n`);
    return 1;
  }
  return 0;
}

export const scpCommand: Command = {
  name: 'scp',
  category: 'red',
  summary: 'Copia archivos a otro servidor por SSH',
  execute(ctx) {
    const recursive = ctx.args.some((a) => /^-[a-zA-Z]*r/.test(a));
    const operands = ctx.args.filter((a) => !a.startsWith('-'));
    if (operands.length < 2) return fail(ctx, 'usage: scp [-r] source ... target', 1);
    return copyTo(ctx, operands.slice(0, -1), operands.at(-1)!, recursive, false);
  },
};

export const rsyncCommand: Command = {
  name: 'rsync',
  category: 'red',
  summary: 'Sincroniza directorios (local o por SSH): rsync -av origen destino',
  package: 'rsync',
  async execute(ctx) {
    const flags = ctx.args.filter((a) => a.startsWith('-')).join('');
    const recursive = /[ar]/.test(flags);
    const verbose = /v/.test(flags);
    const operands = ctx.args.filter((a) => !a.startsWith('-'));
    if (operands.length < 2) return fail(ctx, 'rsync: missing destination\nUsage: rsync [OPTION]... SRC [SRC]... DEST', 1);
    if (verbose) ctx.stdout.write('sending incremental file list\n');
    // rsync: "dir/" copia el CONTENIDO de dir; "dir" copia el directorio.
    const sources = operands.slice(0, -1);
    const dest = operands.at(-1)!;
    let code = 0;
    for (const source of sources) {
      if (source.endsWith('/') && ctx.fs.isDirectory(ctx.resolve(source))) {
        const children = ctx.fs.readDir(ctx.resolve(source)).map((n) => joinPath(ctx.resolve(source), n.name));
        if (!dest.includes(':')) ctx.fs.mkdir(ctx.resolve(dest), true);
        code = (await copyTo(ctx, children, dest.endsWith('/') ? dest : dest + '/', recursive, verbose)) || code;
      } else code = (await copyTo(ctx, [source], dest, recursive, verbose)) || code;
    }
    if (verbose && code === 0) ctx.stdout.write('\nsent 1,284 bytes  received 92 bytes  2,752.00 bytes/sec\ntotal size is 1,024  speedup is 0.74\n');
    return code;
  },
};

export const sshdCommand: Command = {
  name: 'sshd',
  category: 'red',
  summary: 'Servidor SSH (sshd -t comprueba la configuración antes de reiniciar)',
  execute(ctx) {
    if (ctx.session.username !== 'root') return fail(ctx, 'sshd re-exec requires execution with an absolute path', 1);
    const content = ctx.fs.readFile('/etc/ssh/sshd_config');
    if (ctx.args.includes('-t') || ctx.args.includes('-T')) {
      const errors = checkSshdConfig(content);
      if (errors.length) {
        ctx.stderr.write(errors.join('\n') + `\n/etc/ssh/sshd_config: terminating, ${errors.length} bad configuration options\n`);
        return 255;
      }
      if (ctx.args.includes('-T')) {
        const c = parseSshdConfig(content);
        ctx.stdout.write(`port ${c.port}\npermitrootlogin ${c.permitRootLogin}\npubkeyauthentication ${c.pubkeyAuthentication ? 'yes' : 'no'}\npasswordauthentication ${c.passwordAuthentication ? 'yes' : 'no'}\n${c.allowUsers ? `allowusers ${c.allowUsers.join(' ')}\n` : ''}`);
      }
      return 0;
    }
    return fail(ctx, 'usa: sudo sshd -t   (comprobar la configuración)', EXIT_USAGE);
  },
};

