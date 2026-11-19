/**
 * Ayudantes para que las misiones preparen su escenario de forma declarativa.
 *
 * Ejemplo:
 *   setup: (world) => plantFiles(world, { '~/caos/foto.jpg': '', '~/caos/notas.txt': 'hola' })
 */
import { dirname, normalize } from '../../engine/vfs/path';
import type { MissionWorld } from '../domain/curriculum';

function expandHome(world: MissionWorld, path: string): string {
  if (path === '~') return world.session.home;
  if (path.startsWith('~/')) return normalize(world.session.home + path.slice(1));
  return normalize(path);
}

/**
 * Elemento del home que contiene la ruta (su "raíz de escenario"):
 *   ~/caos/fotos/a.jpg → ~/caos      ~/notas.txt → ~/notas.txt
 * Devuelve null para rutas fuera del home (nunca se borran al reiniciar).
 */
function scenarioRoot(world: MissionWorld, path: string): string | null {
  const home = world.session.home;
  if (!path.startsWith(home + '/')) return null;
  const first = path.slice(home.length + 1).split('/')[0];
  return first ? `${home}/${first}` : null;
}

/**
 * Crea archivos (y sus directorios) si no existen. Las rutas que terminan en `/`
 * se crean como directorios vacíos. Fuera del home se crean como root.
 *
 * Al reiniciar el escenario (`world.resetting`), primero se borra cada raíz
 * de escenario del home (ej. ~/caos entero) para deshacer lo que hizo el
 * jugador, y después se recrea tal como estaba al empezar la misión.
 */
export function plantFiles(world: MissionWorld, files: Record<string, string>): void {
  if (world.resetting) {
    const roots = new Set(
      Object.keys(files)
        .map((raw) => scenarioRoot(world, expandHome(world, raw)))
        .filter((root): root is string => root !== null),
    );
    for (const root of roots) {
      if (world.fs.tryStat(root, false)) world.fs.remove(root, true);
    }
  }
  for (const [rawPath, content] of Object.entries(files)) {
    const path = expandHome(world, rawPath);
    const create = (): void => {
      if (rawPath.endsWith('/')) {
        world.fs.mkdir(path, true);
        return;
      }
      if (world.fs.exists(path)) return;
      world.fs.mkdir(dirname(path), true);
      world.fs.writeFile(path, content);
    };
    if (path.startsWith(world.session.home)) create();
    else world.asRoot(create);
  }
}

/** Mueve al jugador a un directorio (lo crea si hace falta). */
export function teleport(world: MissionWorld, path: string): void {
  const abs = expandHome(world, path);
  if (!world.fs.isDirectory(abs)) plantFiles(world, { [abs + '/']: '' });
  world.session.changeDirectory(abs);
}

/** Cambia la fecha de modificación de archivos (para misiones con find -mtime). */
export function setAge(world: MissionWorld, paths: string[], daysAgo: number): void {
  const when = world.fs.now() - daysAgo * 86_400_000;
  world.fs.privileged(() => {
    for (const raw of paths) {
      const node = world.fs.tryStat(expandHome(world, raw), false);
      if (node) node.mtime = when;
    }
  });
}

/** Da un tamaño simulado a un archivo (logs gigantes, descargas...). */
export function setSize(world: MissionWorld, path: string, bytes: number): void {
  world.fs.privileged(() => {
    const node = world.fs.tryStat(expandHome(world, path), false);
    if (node?.type === 'file') node.size = bytes;
  });
}

/** Expande ~ en una ruta (para usar en setups). */
export function worldPath(world: MissionWorld, path: string): string {
  return expandHome(world, path);
}

// ─────────────────────── Usuarios, procesos y servicios ───────────────────────

import { addGroup, addUser, deleteUser, findGroup, findUser, setGroupMembers, setPassword } from '../../engine/system/accounts';
import { spawnProcess, updateMachine, type MachineState, type Process } from '../../engine/system/machine';

/** Garantiza que existe el usuario (con home, contraseña y grupos opcionales). */
export function ensureUser(world: MissionWorld, name: string, options: { password?: string; groups?: string[]; shell?: string } = {}): void {
  for (const group of options.groups ?? []) ensureGroup(world, group);
  if (!findUser(world.fs, name)) {
    addUser(world.fs, { name, createHome: true, shell: options.shell ?? '/bin/bash', groups: options.groups });
  } else {
    for (const group of options.groups ?? []) {
      const entry = findGroup(world.fs, group)!;
      if (!entry.members.includes(name)) setGroupMembers(world.fs, group, [...entry.members, name]);
    }
  }
  if (options.password) setPassword(world.fs, name, options.password);
}

export function ensureGroup(world: MissionWorld, name: string): void {
  if (!findGroup(world.fs, name)) addGroup(world.fs, name);
}

/** Elimina un usuario si existe (para que la misión empiece limpia). */
export function removeUser(world: MissionWorld, name: string): void {
  if (findUser(world.fs, name)) deleteUser(world.fs, name, true);
}

/** Modifica el estado de la máquina (procesos, servicios, paquetes...). */
export function withMachine(world: MissionWorld, fn: (machine: MachineState) => void): void {
  updateMachine(world.fs, fn);
}

/**
 * Garantiza que hay un proceso cuyo comando coincide con `command`
 * (lo crea si no existe; al reiniciar el escenario lo recrea).
 */
export function ensureProcess(world: MissionWorld, process: Omit<Process, 'pid' | 'start' | 'ppid' | 'state' | 'nice' | 'tty'> & Partial<Process>): void {
  updateMachine(world.fs, (machine) => {
    if (machine.processes.some((p) => p.command === process.command)) return;
    spawnProcess(machine, world.fs.now(), process);
  });
}

/** Marca el índice de apt como actualizado (para que apt install funcione sin update). */
export function aptReady(world: MissionWorld): void {
  updateMachine(world.fs, (machine) => {
    machine.aptUpdatedAt ??= world.fs.now();
  });
}
