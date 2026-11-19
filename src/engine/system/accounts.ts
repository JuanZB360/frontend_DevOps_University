/**
 * Cuentas de usuario y grupos, leídas y escritas en los archivos reales:
 *   /etc/passwd   usuario:x:UID:GID:comentario:home:shell
 *   /etc/group    grupo:x:GID:miembro1,miembro2
 *   /etc/shadow   usuario:hash:...   (! o * = sin contraseña / bloqueada)
 *   /etc/sudoers y /etc/sudoers.d/*  quién puede usar sudo y para qué
 *
 * Todas las escrituras se hacen con privilegios (como haría useradd), pero
 * los comandos comprueban antes que quien las pide es root.
 */
import { joinPath } from '../vfs/path';
import type { VirtualFileSystem } from '../vfs/VirtualFileSystem';

export interface UserEntry {
  name: string;
  uid: number;
  gid: number;
  comment: string;
  home: string;
  shell: string;
}

export interface GroupEntry {
  name: string;
  gid: number;
  members: string[];
}

const PASSWD = '/etc/passwd';
const GROUP = '/etc/group';
const SHADOW = '/etc/shadow';

function readLines(fs: VirtualFileSystem, path: string): string[] {
  return fs.privileged(() => (fs.exists(path) ? fs.readFile(path) : '')).split('\n').filter((l) => l.trim() !== '');
}

function writeLines(fs: VirtualFileSystem, path: string, lines: string[]): void {
  fs.privileged(() => fs.writeFile(path, lines.join('\n') + '\n'));
}

export function listUsers(fs: VirtualFileSystem): UserEntry[] {
  return readLines(fs, PASSWD).map((line) => {
    const [name, , uid, gid, comment, home, shell] = line.split(':');
    return { name, uid: Number(uid), gid: Number(gid), comment: comment ?? '', home: home ?? `/home/${name}`, shell: shell ?? '/bin/bash' };
  });
}

export function listGroups(fs: VirtualFileSystem): GroupEntry[] {
  return readLines(fs, GROUP).map((line) => {
    const [name, , gid, members] = line.split(':');
    return { name, gid: Number(gid), members: members ? members.split(',').filter(Boolean) : [] };
  });
}

export function findUser(fs: VirtualFileSystem, name: string): UserEntry | undefined {
  return listUsers(fs).find((u) => u.name === name);
}

export function findGroup(fs: VirtualFileSystem, name: string): GroupEntry | undefined {
  return listGroups(fs).find((g) => g.name === name);
}

/** Grupo principal + grupos secundarios del usuario (lo que muestra `id`). */
export function groupsOf(fs: VirtualFileSystem, user: string): string[] {
  const entry = findUser(fs, user);
  const groups = listGroups(fs);
  const primary = entry ? groups.find((g) => g.gid === entry.gid)?.name ?? user : user;
  const secondary = groups.filter((g) => g.members.includes(user) && g.name !== primary).map((g) => g.name);
  return [primary, ...secondary];
}

function writeUsers(fs: VirtualFileSystem, users: UserEntry[]): void {
  writeLines(fs, PASSWD, users.map((u) => `${u.name}:x:${u.uid}:${u.gid}:${u.comment}:${u.home}:${u.shell}`));
}

function writeGroups(fs: VirtualFileSystem, groups: GroupEntry[]): void {
  writeLines(fs, GROUP, groups.map((g) => `${g.name}:x:${g.gid}:${g.members.join(',')}`));
}

function nextId(used: number[], start: number): number {
  let id = start;
  while (used.includes(id)) id++;
  return id;
}

export function addGroup(fs: VirtualFileSystem, name: string, system = false): GroupEntry {
  const groups = listGroups(fs);
  const gid = nextId(groups.map((g) => g.gid), system ? 100 : 1000);
  const group = { name, gid, members: [] };
  writeGroups(fs, [...groups, group]);
  return group;
}

export function deleteGroup(fs: VirtualFileSystem, name: string): void {
  writeGroups(fs, listGroups(fs).filter((g) => g.name !== name));
}

export function setGroupMembers(fs: VirtualFileSystem, name: string, members: string[]): void {
  writeGroups(fs, listGroups(fs).map((g) => (g.name === name ? { ...g, members: [...new Set(members)] } : g)));
}

export interface NewUser {
  name: string;
  home?: string;
  shell?: string;
  comment?: string;
  createHome: boolean;
  /** Grupos secundarios. */
  groups?: string[];
  /** Grupo principal existente (por defecto, uno con su nombre). */
  primaryGroup?: string;
  system?: boolean;
}

/** Crea el usuario (y su grupo, su home y su entrada en shadow). */
export function addUser(fs: VirtualFileSystem, spec: NewUser): UserEntry {
  const users = listUsers(fs);
  const uid = nextId(users.map((u) => u.uid), spec.system ? 100 : 1000);
  let gid: number;
  if (spec.primaryGroup) {
    gid = findGroup(fs, spec.primaryGroup)!.gid;
  } else {
    const existing = findGroup(fs, spec.name);
    gid = existing ? existing.gid : addGroup(fs, spec.name, spec.system).gid;
  }
  const user: UserEntry = {
    name: spec.name,
    uid,
    gid,
    comment: spec.comment ?? '',
    home: spec.home ?? `/home/${spec.name}`,
    shell: spec.shell ?? (spec.system ? '/usr/sbin/nologin' : '/bin/sh'),
  };
  writeUsers(fs, [...listUsers(fs), user]);
  for (const group of spec.groups ?? []) {
    const entry = findGroup(fs, group);
    if (entry) setGroupMembers(fs, group, [...entry.members, spec.name]);
  }
  writeLines(fs, SHADOW, [...readLines(fs, SHADOW).filter((l) => !l.startsWith(spec.name + ':')), `${spec.name}:!:19700:0:99999:7:::`]);
  if (spec.createHome) {
    fs.privileged(() => {
      fs.mkdir(user.home, true);
      // /etc/skel: archivos que recibe todo usuario nuevo.
      for (const [name, content] of [['.bashrc', '# ~/.bashrc\nalias ll=\'ls -alF\'\n'], ['.profile', '# ~/.profile\n']]) {
        fs.writeFile(joinPath(user.home, name), content);
        fs.chown(joinPath(user.home, name), user.name, groupName(fs, gid));
      }
      fs.chown(user.home, user.name, groupName(fs, gid));
      fs.chmod(user.home, 0o750);
    });
  }
  return user;
}

export function groupName(fs: VirtualFileSystem, gid: number): string {
  return listGroups(fs).find((g) => g.gid === gid)?.name ?? String(gid);
}

export function updateUser(fs: VirtualFileSystem, name: string, change: Partial<UserEntry>): void {
  writeUsers(fs, listUsers(fs).map((u) => (u.name === name ? { ...u, ...change } : u)));
}

export function deleteUser(fs: VirtualFileSystem, name: string, removeHome: boolean): void {
  const user = findUser(fs, name);
  writeUsers(fs, listUsers(fs).filter((u) => u.name !== name));
  writeGroups(fs, listGroups(fs)
    .map((g) => ({ ...g, members: g.members.filter((m) => m !== name) }))
    // El grupo personal se borra con el usuario si nadie más lo usa.
    .filter((g) => !(g.name === name && g.members.length === 0)));
  writeLines(fs, SHADOW, readLines(fs, SHADOW).filter((l) => !l.startsWith(name + ':')));
  if (removeHome && user) fs.privileged(() => fs.tryStat(user.home) && fs.remove(user.home, true));
}

/** Estado de la contraseña: P (tiene), L (bloqueada), NP (sin contraseña). */
export function passwordStatus(fs: VirtualFileSystem, name: string): 'P' | 'L' | 'NP' {
  const line = readLines(fs, SHADOW).find((l) => l.startsWith(name + ':'));
  const hash = line?.split(':')[1] ?? '!';
  if (hash === '' ) return 'NP';
  if (hash.startsWith('!') || hash === '*') return 'L';
  return 'P';
}

/** Guarda una contraseña (hash simulado con el formato de yescrypt). */
export function setPassword(fs: VirtualFileSystem, name: string, password: string): void {
  let hash = 0;
  for (const ch of password) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const encoded = `$y$j9T$${btoa(name).replace(/=/g, '').slice(0, 16)}$${hash.toString(36).padStart(12, 'x')}`;
  const lines = readLines(fs, SHADOW).filter((l) => !l.startsWith(name + ':'));
  writeLines(fs, SHADOW, [...lines, `${name}:${encoded}:19700:0:99999:7:::`]);
}

export function checkPassword(fs: VirtualFileSystem, name: string, password: string): boolean {
  const line = readLines(fs, SHADOW).find((l) => l.startsWith(name + ':'));
  if (!line) return false;
  let hash = 0;
  for (const ch of password) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return line.split(':')[1].endsWith('$' + hash.toString(36).padStart(12, 'x'));
}

export function lockPassword(fs: VirtualFileSystem, name: string, lock: boolean): void {
  writeLines(fs, SHADOW, readLines(fs, SHADOW).map((l) => {
    if (!l.startsWith(name + ':')) return l;
    const parts = l.split(':');
    parts[1] = lock ? (parts[1].startsWith('!') ? parts[1] : '!' + parts[1]) : parts[1].replace(/^!/, '');
    return parts.join(':');
  }));
}

// ─────────────────────────────── sudoers ───────────────────────────────

export interface SudoRule {
  who: string;
  commands: string[];
  nopasswd: boolean;
  source: string;
}

/** Interpreta una línea de sudoers: "usuario ALL=(ALL:ALL) NOPASSWD: /usr/bin/x, /usr/bin/y" */
export function parseSudoersLine(line: string, source: string): SudoRule | null | 'error' {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('Defaults') || trimmed.startsWith('@include')) return null;
  const m = /^(\S+)\s+\S+\s*=\s*(?:\([^)]*\)\s*)?(NOPASSWD:\s*)?(.+)$/.exec(trimmed);
  if (!m) return 'error';
  const commands = m[3].split(',').map((c) => c.trim()).filter(Boolean);
  if (commands.some((c) => c !== 'ALL' && !c.startsWith('/'))) return 'error';
  return { who: m[1], commands, nopasswd: Boolean(m[2]), source };
}

export function sudoRules(fs: VirtualFileSystem): SudoRule[] {
  const files = ['/etc/sudoers'];
  fs.privileged(() => {
    if (fs.isDirectory('/etc/sudoers.d')) {
      for (const node of fs.readDir('/etc/sudoers.d')) {
        // sudo ignora los archivos con punto o que acaban en ~ (como en Linux).
        if (node.type === 'file' && !node.name.includes('.') && !node.name.endsWith('~')) files.push(`/etc/sudoers.d/${node.name}`);
      }
    }
  });
  return files.flatMap((file) => readLines(fs, file)
    .map((line) => parseSudoersLine(line, file))
    .filter((r): r is SudoRule => r !== null && r !== 'error'));
}

/**
 * ¿Puede `user` ejecutar `argv` con sudo?
 * @returns 'all', 'allowed' o false.
 */
export function sudoPermission(fs: VirtualFileSystem, user: string, argv: readonly string[]): boolean {
  if (user === 'root') return true;
  const groups = groupsOf(fs, user);
  const commandLine = [`/usr/bin/${argv[0] ?? ''}`, ...argv.slice(1)].join(' ');
  return sudoRules(fs).some((rule) => {
    const applies = rule.who.startsWith('%') ? groups.includes(rule.who.slice(1)) : rule.who === user;
    if (!applies) return false;
    return rule.commands.some((c) => {
      if (c === 'ALL') return true;
      const normalized = c.replace(/^\/(usr\/)?s?bin\//, '/usr/bin/');
      // Sin argumentos en la regla: se permite con cualquier argumento.
      return normalized.includes(' ') ? commandLine === normalized : commandLine.split(' ')[0] === normalized;
    });
  });
}

/** ¿Tiene el usuario sudo completo? (para mensajes y validaciones). */
export function hasFullSudo(fs: VirtualFileSystem, user: string): boolean {
  const groups = groupsOf(fs, user);
  return sudoRules(fs).some((rule) => (rule.who.startsWith('%') ? groups.includes(rule.who.slice(1)) : rule.who === user) && rule.commands.includes('ALL'));
}
