/**
 * Usuarios, grupos y privilegios:
 *   id groups who w last
 *   useradd adduser usermod userdel groupadd groupdel gpasswd
 *   passwd chpasswd su sudo visudo newgrp
 */
import {
  addGroup, addUser, checkPassword, deleteGroup, deleteUser, findGroup, findUser, groupsOf, hasFullSudo, listGroups,
  lockPassword, parseSudoersLine, passwordStatus, setGroupMembers, setPassword, sudoPermission, sudoRules, updateUser,
} from '../../system/accounts';
import { ShellSession } from '../../system/ShellSession';
import type { Command, CommandContext } from '../Command';
import { EXIT_USAGE, fail } from '../helpers';

const USERNAME = /^[a-z_][a-z0-9_-]{0,31}$/;

/** Los comandos de administración de cuentas exigen ser root. */
function requireRoot(ctx: CommandContext): boolean {
  if (ctx.session.username === 'root') return true;
  ctx.stderr.write(`${ctx.name}: Permission denied.\n${ctx.name}: cannot lock /etc/passwd; try again later.\n`);
  return false;
}

/** Parser mínimo de opciones que admite valores pegados o separados. */
function options(args: readonly string[], withValue: string): { flags: Set<string>; values: Map<string, string>; operands: string[] } {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const operands: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const [name, value] = arg.slice(2).split('=');
      if (value !== undefined) values.set(name, value);
      else flags.add(name);
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      for (let j = 1; j < arg.length; j++) {
        const letter = arg[j];
        if (withValue.includes(letter)) {
          values.set(letter, arg.slice(j + 1) || args[++i] || '');
          break;
        }
        flags.add(letter);
      }
      continue;
    }
    operands.push(arg);
  }
  return { flags, values, operands };
}

export const idCommand: Command = {
  name: 'id',
  category: 'usuarios',
  summary: 'Muestra el UID, GID y los grupos de un usuario',
  execute(ctx) {
    const o = options(ctx.args, '');
    const name = o.operands[0] ?? ctx.session.username;
    const user = findUser(ctx.fs, name);
    if (!user) return fail(ctx, `'${name}': no such user`);
    const groups = name === ctx.session.username && !o.operands[0] ? [...ctx.session.userGroups] : groupsOf(ctx.fs, name);
    const all = listGroups(ctx.fs);
    const gidOf = (g: string): number => all.find((x) => x.name === g)?.gid ?? 0;
    if (o.flags.has('u')) ctx.stdout.write(`${o.flags.has('n') ? user.name : user.uid}\n`);
    else if (o.flags.has('g')) ctx.stdout.write(`${o.flags.has('n') ? groups[0] : gidOf(groups[0])}\n`);
    else if (o.flags.has('G')) ctx.stdout.write(`${groups.map((g) => (o.flags.has('n') ? g : gidOf(g))).join(' ')}\n`);
    else ctx.stdout.write(`uid=${user.uid}(${user.name}) gid=${gidOf(groups[0])}(${groups[0]}) groups=${groups.map((g) => `${gidOf(g)}(${g})`).join(',')}\n`);
    return 0;
  },
};

export const groupsCommand: Command = {
  name: 'groups',
  category: 'usuarios',
  summary: 'Muestra los grupos a los que pertenece un usuario',
  execute(ctx) {
    if (ctx.args.length === 0) {
      ctx.stdout.write(ctx.session.userGroups.join(' ') + '\n');
      return 0;
    }
    for (const name of ctx.args) {
      if (!findUser(ctx.fs, name)) return fail(ctx, `'${name}': no such user`);
      ctx.stdout.write(`${name} : ${groupsOf(ctx.fs, name).join(' ')}\n`);
    }
    return 0;
  },
};

export const whoCommand: Command = {
  name: 'who',
  category: 'usuarios',
  summary: 'Muestra quién está conectado',
  execute(ctx) {
    const date = new Date(ctx.fs.now() - 3_600_000).toISOString().slice(0, 16).replace('T', ' ');
    ctx.stdout.write(`${ctx.session.username.padEnd(8)} pts/0        ${date} (10.0.0.5)\n`);
    return 0;
  },
};

export const wCommand: Command = {
  name: 'w',
  category: 'usuarios',
  summary: 'Muestra quién está conectado y qué hace',
  execute(ctx) {
    ctx.stdout.write(` ${new Date(ctx.fs.now()).toTimeString().slice(0, 8)} up 3 days,  4:02,  1 user,  load average: 0.08, 0.03, 0.01\n`);
    ctx.stdout.write('USER     TTY      FROM             LOGIN@   IDLE   JCPU   PCPU WHAT\n');
    ctx.stdout.write(`${ctx.session.username.padEnd(8)} pts/0    10.0.0.5         09:14    0.00s  0.04s  0.00s w\n`);
    return 0;
  },
};

export const lastCommand: Command = {
  name: 'last',
  category: 'usuarios',
  summary: 'Muestra los últimos inicios de sesión',
  execute(ctx) {
    ctx.stdout.write(
      `${ctx.session.username.padEnd(8)} pts/0        10.0.0.5         Sat Nov 16 09:14   still logged in\n` +
      'deploy   pts/1        10.0.0.5         Sat Nov 16 03:11 - 03:40  (00:29)\n' +
      'reboot   system boot  6.8.0-devops     Wed Nov 13 05:00   still running\n\nwtmp begins Wed Nov 13 05:00:01 2024\n',
    );
    return 0;
  },
};

export const useraddCommand: Command = {
  name: 'useradd',
  category: 'usuarios',
  summary: 'Crea un usuario (-m crea su home, -s su shell, -G sus grupos)',
  execute(ctx) {
    if (!requireRoot(ctx)) return 1;
    const o = options(ctx.args, 'sGgdcu');
    const [name] = o.operands;
    if (!name) return fail(ctx, 'missing username\nUsage: useradd [options] LOGIN', EXIT_USAGE);
    if (!USERNAME.test(name)) return fail(ctx, `invalid user name '${name}'`, 3);
    if (findUser(ctx.fs, name)) return fail(ctx, `user '${name}' already exists`, 9);
    const groups = (o.values.get('G') ?? '').split(',').filter(Boolean);
    for (const group of groups) if (!findGroup(ctx.fs, group)) return fail(ctx, `group '${group}' does not exist`, 6);
    const primary = o.values.get('g');
    if (primary && !findGroup(ctx.fs, primary)) return fail(ctx, `group '${primary}' does not exist`, 6);
    addUser(ctx.fs, {
      name,
      createHome: o.flags.has('m') || o.flags.has('create-home'),
      shell: o.values.get('s') ?? o.values.get('shell'),
      home: o.values.get('d'),
      comment: o.values.get('c'),
      groups,
      primaryGroup: primary,
      system: o.flags.has('r') || o.flags.has('system'),
    });
    return 0;
  },
};

export const adduserCommand: Command = {
  name: 'adduser',
  category: 'usuarios',
  summary: 'Forma amigable de crear un usuario (pide la contraseña)',
  async execute(ctx) {
    if (!requireRoot(ctx)) return 1;
    const o = options(ctx.args, '');
    const [name, group] = o.operands;
    if (!name) return fail(ctx, 'Only one or two names allowed.');
    // "adduser usuario grupo" añade un usuario existente a un grupo.
    if (group) {
      const entry = findGroup(ctx.fs, group);
      if (!findUser(ctx.fs, name)) return fail(ctx, `The user \`${name}' does not exist.`);
      if (!entry) return fail(ctx, `The group \`${group}' does not exist.`);
      setGroupMembers(ctx.fs, group, [...entry.members, name]);
      ctx.stdout.write(`Adding user \`${name}' to group \`${group}' ...\nDone.\n`);
      return 0;
    }
    if (findUser(ctx.fs, name)) return fail(ctx, `The user \`${name}' already exists.`);
    const user = addUser(ctx.fs, { name, createHome: true, shell: '/bin/bash' });
    ctx.stdout.write(`info: Adding user \`${name}' ...\ninfo: Adding new group \`${name}' (${user.gid}) ...\ninfo: Adding new user \`${name}' (${user.uid}) with group \`${name}' ...\ninfo: Creating home directory \`/home/${name}' ...\ninfo: Copying files from \`/etc/skel' ...\n`);
    const password = await askNewPassword(ctx);
    if (password) setPassword(ctx.fs, name, password);
    return 0;
  },
};

export const usermodCommand: Command = {
  name: 'usermod',
  category: 'usuarios',
  summary: 'Modifica un usuario (-aG añade grupos, -s shell, -L bloquea)',
  execute(ctx) {
    if (!requireRoot(ctx)) return 1;
    const o = options(ctx.args, 'sGgdcl');
    const [name] = o.operands;
    if (!name) return fail(ctx, 'no options\nUsage: usermod [options] LOGIN', EXIT_USAGE);
    const user = findUser(ctx.fs, name);
    if (!user) return fail(ctx, `user '${name}' does not exist`, 6);
    const groupList = o.values.get('G');
    if (groupList !== undefined) {
      const groups = groupList.split(',').filter(Boolean);
      for (const group of groups) if (!findGroup(ctx.fs, group)) return fail(ctx, `group '${group}' does not exist`, 6);
      if (!o.flags.has('a')) {
        // ⚠ Sin -a, -G SUSTITUYE todos los grupos secundarios.
        for (const g of listGroups(ctx.fs)) if (g.members.includes(name) && !groups.includes(g.name)) setGroupMembers(ctx.fs, g.name, g.members.filter((m) => m !== name));
      }
      for (const group of groups) setGroupMembers(ctx.fs, group, [...findGroup(ctx.fs, group)!.members, name]);
    } else if (o.flags.has('a')) {
      return fail(ctx, '-a flag is ONLY allowed with the -G flag', EXIT_USAGE);
    }
    const shell = o.values.get('s');
    if (shell) updateUser(ctx.fs, name, { shell });
    const home = o.values.get('d');
    if (home) updateUser(ctx.fs, name, { home });
    const comment = o.values.get('c');
    if (comment !== undefined) updateUser(ctx.fs, name, { comment });
    const primary = o.values.get('g');
    if (primary) {
      const group = findGroup(ctx.fs, primary);
      if (!group) return fail(ctx, `group '${primary}' does not exist`, 6);
      updateUser(ctx.fs, name, { gid: group.gid });
    }
    if (o.flags.has('L')) lockPassword(ctx.fs, name, true);
    if (o.flags.has('U')) lockPassword(ctx.fs, name, false);
    return 0;
  },
};

export const userdelCommand: Command = {
  name: 'userdel',
  category: 'usuarios',
  summary: 'Elimina un usuario (-r borra también su home)',
  execute(ctx) {
    if (!requireRoot(ctx)) return 1;
    const o = options(ctx.args, '');
    const [name] = o.operands;
    if (!name) return fail(ctx, 'Usage: userdel [options] LOGIN', EXIT_USAGE);
    if (!findUser(ctx.fs, name)) return fail(ctx, `user '${name}' does not exist`, 6);
    if (name === 'root') return fail(ctx, 'user root is currently used by process 1', 8);
    deleteUser(ctx.fs, name, o.flags.has('r') || o.flags.has('remove'));
    return 0;
  },
};

export const groupaddCommand: Command = {
  name: 'groupadd',
  category: 'usuarios',
  summary: 'Crea un grupo',
  execute(ctx) {
    if (!requireRoot(ctx)) return 1;
    const o = options(ctx.args, 'g');
    const [name] = o.operands;
    if (!name) return fail(ctx, 'Usage: groupadd [options] GROUP', EXIT_USAGE);
    if (!USERNAME.test(name)) return fail(ctx, `'${name}' is not a valid group name`, 3);
    if (findGroup(ctx.fs, name)) return fail(ctx, `group '${name}' already exists`, 9);
    addGroup(ctx.fs, name, o.flags.has('r'));
    return 0;
  },
};

export const groupdelCommand: Command = {
  name: 'groupdel',
  category: 'usuarios',
  summary: 'Elimina un grupo',
  execute(ctx) {
    if (!requireRoot(ctx)) return 1;
    const [name] = ctx.args;
    if (!name) return fail(ctx, 'Usage: groupdel [options] GROUP', EXIT_USAGE);
    if (!findGroup(ctx.fs, name)) return fail(ctx, `group '${name}' does not exist`, 6);
    deleteGroup(ctx.fs, name);
    return 0;
  },
};

export const gpasswdCommand: Command = {
  name: 'gpasswd',
  category: 'usuarios',
  summary: 'Añade (-a) o quita (-d) miembros de un grupo',
  execute(ctx) {
    if (!requireRoot(ctx)) return 1;
    const o = options(ctx.args, 'ad');
    const [group] = o.operands;
    const entry = group ? findGroup(ctx.fs, group) : undefined;
    if (!entry) return fail(ctx, `group '${group ?? ''}' does not exist`, 3);
    const add = o.values.get('a');
    const remove = o.values.get('d');
    if (add) {
      if (!findUser(ctx.fs, add)) return fail(ctx, `user '${add}' does not exist`, 3);
      setGroupMembers(ctx.fs, group, [...entry.members, add]);
      ctx.stdout.write(`Adding user ${add} to group ${group}\n`);
    } else if (remove) {
      if (!entry.members.includes(remove)) return fail(ctx, `user '${remove}' is not a member of '${group}'`, 3);
      setGroupMembers(ctx.fs, group, entry.members.filter((m) => m !== remove));
      ctx.stdout.write(`Removing user ${remove} from group ${group}\n`);
    } else return fail(ctx, 'Usage: gpasswd [option] GROUP', EXIT_USAGE);
    return 0;
  },
};

/** Pide la contraseña dos veces. @returns la contraseña o null. */
async function askNewPassword(ctx: CommandContext): Promise<string | null> {
  if (!ctx.terminal.readLine) return null;
  const first = await ctx.terminal.readLine('New password: ', { secret: true });
  if (first === null) return null;
  const second = await ctx.terminal.readLine('Retype new password: ', { secret: true });
  if (second === null) return null;
  if (first !== second) {
    ctx.stderr.write('Sorry, passwords do not match.\npasswd: Authentication token manipulation error\npasswd: password unchanged\n');
    return null;
  }
  if (first.length < 4) {
    ctx.stderr.write('BAD PASSWORD: The password is shorter than 4 characters\npasswd: password unchanged\n');
    return null;
  }
  return first;
}

export const passwdCommand: Command = {
  name: 'passwd',
  category: 'usuarios',
  summary: 'Cambia la contraseña de un usuario (-l bloquea, -S estado)',
  async execute(ctx) {
    const o = options(ctx.args, '');
    const target = o.operands[0] ?? ctx.session.username;
    if (target !== ctx.session.username && ctx.session.username !== 'root') {
      return fail(ctx, `You may not view or modify password information for ${target}.`);
    }
    if (!findUser(ctx.fs, target)) return fail(ctx, `user '${target}' does not exist`);
    if (o.flags.has('S')) {
      ctx.stdout.write(`${target} ${passwordStatus(ctx.fs, target)} 11/16/2024 0 99999 7 -1\n`);
      return 0;
    }
    if (o.flags.has('l') || o.flags.has('u')) {
      if (ctx.session.username !== 'root') return fail(ctx, 'Permission denied.');
      lockPassword(ctx.fs, target, o.flags.has('l'));
      ctx.stdout.write(`passwd: password changed.\n`);
      return 0;
    }
    if (o.flags.has('d')) {
      if (ctx.session.username !== 'root') return fail(ctx, 'Permission denied.');
      setPassword(ctx.fs, target, '');
      ctx.stdout.write('passwd: password changed.\n');
      return 0;
    }
    if (target !== 'root' || ctx.session.username === 'root') ctx.stdout.write(`Changing password for ${target}.\n`);
    const password = await askNewPassword(ctx);
    if (password === null) return 10;
    setPassword(ctx.fs, target, password);
    ctx.stdout.write('passwd: password updated successfully\n');
    return 0;
  },
};

export const chpasswdCommand: Command = {
  name: 'chpasswd',
  category: 'usuarios',
  summary: 'Cambia contraseñas en lote leyendo "usuario:contraseña"',
  execute(ctx) {
    if (!requireRoot(ctx)) return 1;
    let exitCode = 0;
    for (const line of (ctx.stdin ?? '').split('\n').filter(Boolean)) {
      const [name, ...rest] = line.split(':');
      if (!findUser(ctx.fs, name)) {
        ctx.stderr.write(`chpasswd: (user ${name}) pam_chauthtok() failed, error:\nAuthentication token manipulation error\n`);
        exitCode = 1;
        continue;
      }
      setPassword(ctx.fs, name, rest.join(':'));
    }
    return exitCode;
  },
};

/** Abre una sesión de login como `user` encima de la actual. */
function openLogin(ctx: CommandContext, user: string, keepEnv: boolean): void {
  const entry = findUser(ctx.fs, user)!;
  const snapshot = ShellSession.loginSnapshot(user, groupsOf(ctx.fs, user), ctx.session.hostname, entry.home);
  if (!ctx.fs.isDirectory(entry.home)) snapshot.cwd = '/';
  ctx.session.pushSession(snapshot, keepEnv);
  if (!keepEnv) ctx.session.changeDirectory(snapshot.cwd);
}

export const suCommand: Command = {
  name: 'su',
  category: 'usuarios',
  summary: 'Cambia de usuario (su - usuario abre su sesión completa)',
  async execute(ctx) {
    const login = ctx.args.includes('-') || ctx.args.includes('-l') || ctx.args.includes('--login');
    const commandIndex = ctx.args.indexOf('-c');
    const command = commandIndex !== -1 ? ctx.args[commandIndex + 1] : undefined;
    const target = ctx.args.filter((a, i) => !a.startsWith('-') && (commandIndex === -1 || i !== commandIndex + 1))[0] ?? 'root';
    const user = findUser(ctx.fs, target);
    if (!user) return fail(ctx, `user ${target} does not exist or the user entry does not contain all the required fields`);
    if (user.shell.endsWith('nologin') || user.shell.endsWith('false')) {
      ctx.stdout.write('This account is currently not available.\n');
      return 1;
    }
    if (ctx.session.username !== 'root') {
      const status = passwordStatus(ctx.fs, target);
      const password = ctx.terminal.readLine ? await ctx.terminal.readLine('Password: ', { secret: true }) : null;
      if (password === null || status !== 'P' || !checkPassword(ctx.fs, target, password)) {
        await new Promise((r) => setTimeout(r, 300));
        ctx.stderr.write('su: Authentication failure\n');
        if (target === 'root' && status !== 'P') {
          ctx.stderr.write('\x1b[2m(En Ubuntu root no tiene contraseña: usa `sudo -i` para abrir una sesión de root.)\x1b[0m\n');
        }
        return 1;
      }
    }
    if (command !== undefined) {
      const groups = groupsOf(ctx.fs, target);
      return ctx.session.runAsAsync({ user: target, groups }, () => ctx.shell.runScript(command, { newProcess: true }));
    }
    openLogin(ctx, target, !login);
    return 0;
  },
};

export const sudoCommand: Command = {
  name: 'sudo',
  category: 'usuarios',
  summary: 'Ejecuta un comando como root (u otro usuario con -u)',
  async execute(ctx) {
    let runAs = 'root';
    let i = 0;
    let login = false;
    let shell = false;
    let list = false;
    for (; i < ctx.args.length && ctx.args[i].startsWith('-'); i++) {
      const arg = ctx.args[i];
      if (arg === '-u') runAs = ctx.args[++i] ?? 'root';
      else if (arg === '-i' || arg === '--login') login = true;
      else if (arg === '-s' || arg === '--shell') shell = true;
      else if (arg === '-l' || arg === '--list') list = true;
      else if (arg === '-k' || arg === '-K' || arg === '-E' || arg === '-H') continue;
      else if (arg === '--') {
        i++;
        break;
      } else return fail(ctx, `invalid option -- '${arg.replace(/^-+/, '')}'\nusage: sudo -h | -K | -k | -V`, 1);
    }
    const argv = ctx.args.slice(i);
    const me = ctx.session.username;

    if (list) {
      const rules = sudoRules(ctx.fs).filter((r) => (r.who.startsWith('%') ? groupsOf(ctx.fs, me).includes(r.who.slice(1)) : r.who === me));
      if (rules.length === 0 && me !== 'root') {
        ctx.stdout.write(`Sorry, user ${me} may not run sudo on ${ctx.session.hostname}.\n`);
        return 1;
      }
      ctx.stdout.write(`User ${me} may run the following commands on ${ctx.session.hostname}:\n`);
      for (const rule of rules) ctx.stdout.write(`    (ALL : ALL) ${rule.nopasswd ? 'NOPASSWD: ' : ''}${rule.commands.join(', ')}\n`);
      return 0;
    }

    const isRoot = me === 'root';
    if (login || shell || argv.length === 0) {
      if (!isRoot && !hasFullSudo(ctx.fs, me)) {
        ctx.stderr.write(`${me} is not in the sudoers file.\nThis incident has been reported to the administrator.\n`);
        return 1;
      }
      if (argv.length === 0 && !login && !shell) {
        ctx.stderr.write('usage: sudo -h | -K | -k | -V\nusage: sudo [-u user] command\n');
        return 1;
      }
      if (argv.length === 0) {
        if (!findUser(ctx.fs, runAs)) return fail(ctx, `unknown user ${runAs}`);
        openLogin(ctx, runAs, shell);
        return 0;
      }
    }

    if (!isRoot && !sudoPermission(ctx.fs, me, argv)) {
      const anyRule = sudoRules(ctx.fs).some((r) => (r.who.startsWith('%') ? groupsOf(ctx.fs, me).includes(r.who.slice(1)) : r.who === me));
      if (!anyRule) ctx.stderr.write(`${me} is not in the sudoers file.\nThis incident has been reported to the administrator.\n`);
      else ctx.stderr.write(`Sorry, user ${me} is not allowed to execute '/usr/bin/${argv.join(' ')}' as ${runAs} on ${ctx.session.hostname}.\n`);
      return 1;
    }

    // "sudo su" y "sudo su -" abren una sesión de root.
    if (argv[0] === 'su' && argv.filter((a) => !a.startsWith('-')).length <= 1) {
      const target = argv.filter((a) => !a.startsWith('-'))[1] ?? 'root';
      openLogin(ctx, target, !argv.includes('-'));
      return 0;
    }
    if (!findUser(ctx.fs, runAs)) return fail(ctx, `unknown user ${runAs}`);
    const groups = groupsOf(ctx.fs, runAs);
    return ctx.session.runAsAsync({ user: runAs, groups }, () => ctx.shell.spawn(argv));
  },
};

export const visudoCommand: Command = {
  name: 'visudo',
  category: 'usuarios',
  summary: 'Edita /etc/sudoers de forma segura (-c comprueba la sintaxis)',
  async execute(ctx) {
    if (ctx.session.username !== 'root') return fail(ctx, '/etc/sudoers: Permission denied');
    const o = options(ctx.args, 'f');
    const file = o.values.get('f') ?? '/etc/sudoers';
    const check = (path: string): string | null => {
      const content = ctx.fs.readFile(path);
      const lines = content.split('\n');
      for (let n = 0; n < lines.length; n++) {
        if (parseSudoersLine(lines[n], path) === 'error') return `${path}:${n + 1}:${lines[n].length}: syntax error\n${lines[n]}`;
      }
      return null;
    };
    if (o.flags.has('c')) {
      const files = o.values.has('f') ? [file] : ['/etc/sudoers', ...(ctx.fs.isDirectory('/etc/sudoers.d') ? ctx.fs.readDir('/etc/sudoers.d').map((n) => `/etc/sudoers.d/${n.name}`) : [])];
      for (const path of files) {
        const error = check(path);
        if (error) {
          ctx.stderr.write(`${error}\n`);
          return 1;
        }
        ctx.stdout.write(`${path}: parsed OK\n`);
      }
      return 0;
    }
    if (!ctx.terminal.edit) return fail(ctx, 'no editor found (editor path = /usr/bin/nano)');
    const original = ctx.fs.exists(file) ? ctx.fs.readFile(file) : '';
    const edited = await ctx.terminal.edit(file, original);
    if (edited === null) return 0;
    const temp = `${file}.tmp`;
    ctx.fs.writeFile(temp, edited);
    const error = check(temp);
    ctx.fs.remove(temp);
    if (error) {
      ctx.stderr.write(`${error}\n>>> ${file}: syntax error <<<\nLos cambios NO se guardaron (visudo te ha salvado de bloquear sudo).\n`);
      return 1;
    }
    ctx.fs.writeFile(file, edited);
    ctx.fs.chmod(file, 0o440);
    return 0;
  },
};

export const newgrpCommand: Command = {
  name: 'newgrp',
  category: 'usuarios',
  summary: 'Aplica los grupos nuevos sin cerrar sesión',
  execute(ctx) {
    ctx.session.setGroups(groupsOf(ctx.fs, ctx.session.username));
    return 0;
  },
};
