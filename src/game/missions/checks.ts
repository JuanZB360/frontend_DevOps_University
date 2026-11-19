/**
 * Validadores reutilizables para misiones (pequeñas funciones combinables).
 *
 * Filosofía: validar el ESTADO del sistema siempre que sea posible
 * ("¿existe el directorio?") en lugar del texto exacto del comando. Así el
 * alumno puede resolver el reto de distintas formas, como en la vida real.
 *
 * Las rutas pueden empezar por `~`, que se resuelve al home del jugador.
 */
import { findGroup, findUser, groupsOf, hasFullSudo, passwordStatus, sudoPermission } from '../../engine/system/accounts';
import { readMachine, type MachineState } from '../../engine/system/machine';
import type { ExecutedCommand } from '../../engine/shell/Shell';
import { normalize } from '../../engine/vfs/path';
import type { MissionCheck, ValidationContext } from '../domain/curriculum';

/** Resuelve `~` al home del jugador. */
export function homePath(ctx: Pick<ValidationContext, 'session'>, path: string): string {
  if (path === '~') return ctx.session.home;
  if (path.startsWith('~/')) return normalize(ctx.session.home + path.slice(1));
  return normalize(path);
}

/** ¿Los argumentos incluyen la opción? Acepta letras agrupadas (-la contiene -a) y opciones largas. */
export function hasFlag(args: readonly string[], short: string, long?: string): boolean {
  return args.some((a) => (a.startsWith('-') && !a.startsWith('--') && a.slice(1).includes(short)) || (long !== undefined && a === `--${long}`));
}

/** Busca, en la última línea ejecutada, un comando que cumpla la condición. */
function findCommand(ctx: ValidationContext, name: string, extra: (c: ExecutedCommand) => boolean = () => true): ExecutedCommand | undefined {
  return ctx.report.commands.find((c) => c.name === name && c.exitCode === 0 && extra(c));
}

// ───────────────────────────── Sobre comandos ejecutados ─────────────────────────────

/** Se ejecutó `name` con éxito (y opcionalmente cumpliendo una condición sobre sus argumentos). */
export const ran = (name: string, argsMatch?: (args: readonly string[]) => boolean): MissionCheck =>
  (ctx) => findCommand(ctx, name, (c) => !argsMatch || argsMatch(c.args)) !== undefined;

/** Se ejecutó `name` con la opción indicada. */
export const ranWithFlag = (name: string, short: string, long?: string): MissionCheck =>
  ran(name, (args) => hasFlag(args, short, long));

/** La salida de `name` cumple la expresión regular. */
export const outputMatches = (name: string, pattern: RegExp): MissionCheck =>
  (ctx) => findCommand(ctx, name, (c) => pattern.test(c.stdout)) !== undefined;

/** La salida de `name`, sin el salto final, es exactamente `text`. */
export const outputEquals = (name: string, text: string): MissionCheck =>
  (ctx) => findCommand(ctx, name, (c) => c.stdout.replace(/\n$/, '') === text) !== undefined;

// ───────────────────────────── Sobre el estado del sistema ─────────────────────────────

export const cwdIs = (path: string): MissionCheck =>
  (ctx) => ctx.session.cwd === homePath(ctx, path);

export const exists = (path: string): MissionCheck =>
  (ctx) => ctx.fs.exists(homePath(ctx, path));

export const notExists = (path: string): MissionCheck =>
  (ctx) => !ctx.fs.tryStat(homePath(ctx, path), false);

export const isDirectory = (path: string): MissionCheck =>
  (ctx) => ctx.fs.isDirectory(homePath(ctx, path));

export const isFile = (path: string): MissionCheck =>
  (ctx) => ctx.fs.isFile(homePath(ctx, path));

export const fileContains = (path: string, pattern: RegExp): MissionCheck =>
  (ctx) => {
    const abs = homePath(ctx, path);
    return ctx.fs.isFile(abs) && pattern.test(ctx.fs.readFile(abs));
  };

/** El directorio contiene exactamente estos nombres (sin importar el orden). */
export const dirContainsExactly = (path: string, names: readonly string[]): MissionCheck =>
  (ctx) => {
    const abs = homePath(ctx, path);
    if (!ctx.fs.isDirectory(abs)) return false;
    const actual = ctx.fs.readDir(abs).map((n) => n.name).sort();
    return JSON.stringify(actual) === JSON.stringify([...names].sort());
  };

/** El archivo existe y su contenido, sin espacios sobrantes, es exactamente `text`. */
export const fileEquals = (path: string, text: string): MissionCheck =>
  (ctx) => {
    const abs = homePath(ctx, path);
    return ctx.fs.privileged(() => ctx.fs.isFile(abs) && ctx.fs.readFile(abs).trim() === text.trim());
  };

/** Las líneas no vacías del archivo son exactamente estas (en este orden si `ordered`). */
export const fileLinesAre = (path: string, lines: readonly string[], ordered = true): MissionCheck =>
  (ctx) => {
    const abs = homePath(ctx, path);
    if (!ctx.fs.privileged(() => ctx.fs.isFile(abs))) return false;
    const actual = ctx.fs.privileged(() => ctx.fs.readFile(abs)).split('\n').map((l) => l.trim()).filter(Boolean);
    const a = ordered ? actual : [...actual].sort();
    const b = ordered ? [...lines] : [...lines].sort();
    return JSON.stringify(a) === JSON.stringify(b);
  };

/** Lee un archivo con privilegios (para validar archivos de sistema). */
export function readSystemFile(ctx: Pick<ValidationContext, 'fs' | 'session'>, path: string): string | null {
  const abs = homePath(ctx, path);
  return ctx.fs.privileged(() => (ctx.fs.isFile(abs) ? ctx.fs.readFile(abs) : null));
}

export const systemFileMatches = (path: string, pattern: RegExp): MissionCheck =>
  (ctx) => pattern.test(readSystemFile(ctx, path) ?? '');

/** Permisos octales exactos (ej. 0o600). */
export const modeIs = (path: string, mode: number): MissionCheck =>
  (ctx) => {
    const node = ctx.fs.privileged(() => ctx.fs.tryStat(homePath(ctx, path), false));
    return node !== null && (node.mode & 0o7777) === mode;
  };

export const ownedBy = (path: string, owner: string, group?: string): MissionCheck =>
  (ctx) => {
    const node = ctx.fs.privileged(() => ctx.fs.tryStat(homePath(ctx, path), false));
    return node !== null && node.owner === owner && (group === undefined || node.group === group);
  };

/** La salida que vio el jugador: la del último comando de la línea (el final de la tubería). */
export function finalOutput(ctx: ValidationContext): string {
  return ctx.report.commands.at(-1)?.stdout ?? '';
}

export const finalOutputMatches = (pattern: RegExp): MissionCheck => (ctx) => ctx.report.exitCode === 0 && pattern.test(finalOutput(ctx));

/** La salida final, sin espacios al principio/final de cada línea, es exactamente `text`. */
export const finalOutputIs = (text: string | ((ctx: ValidationContext) => string)): MissionCheck =>
  (ctx) => {
    const expected = typeof text === 'string' ? text : text(ctx);
    const normalizeText = (t: string): string => t.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
    return ctx.report.commands.length > 0 && normalizeText(finalOutput(ctx)) === normalizeText(expected);
  };

/** En la línea se usaron todos estos comandos (con éxito). */
export const usedAll = (...names: string[]): MissionCheck =>
  (ctx) => names.every((n) => ctx.report.commands.some((c) => c.name === n && c.exitCode === 0));

/** Se ejecutó `name` como root (con sudo o en una sesión de root). */
export const ranAsRoot = (name: string): MissionCheck =>
  (ctx) => ctx.report.commands.some((c) => c.name === name && c.exitCode === 0 && c.user === 'root');

export const sessionUserIs = (user: string): MissionCheck => (ctx) => ctx.session.username === user;

// ───────────────────────────── Usuarios y sistema ─────────────────────────────

export const userExists = (name: string): MissionCheck => (ctx) => findUser(ctx.fs, name) !== undefined;
export const userMissing = (name: string): MissionCheck => (ctx) => findUser(ctx.fs, name) === undefined;
export const groupExists = (name: string): MissionCheck => (ctx) => findGroup(ctx.fs, name) !== undefined;
export const inGroup = (user: string, group: string): MissionCheck => (ctx) => groupsOf(ctx.fs, user).includes(group);
export const userShellIs = (user: string, shell: string): MissionCheck => (ctx) => findUser(ctx.fs, user)?.shell === shell;
export const hasPassword = (user: string): MissionCheck => (ctx) => passwordStatus(ctx.fs, user) === 'P';
export const passwordLocked = (user: string): MissionCheck => (ctx) => passwordStatus(ctx.fs, user) === 'L';
export const canSudo = (user: string, argv: string[]): MissionCheck => (ctx) => sudoPermission(ctx.fs, user, argv);
export const hasFullSudoRights = (user: string): MissionCheck => (ctx) => hasFullSudo(ctx.fs, user);

/** Condición arbitraria sobre el estado de la máquina (procesos, servicios, paquetes...). */
export const machine = (predicate: (m: MachineState, ctx: ValidationContext) => boolean): MissionCheck =>
  (ctx) => predicate(readMachine(ctx.fs), ctx);

export const serviceActive = (name: string): MissionCheck => machine((m) => m.services[name]?.active === true);
export const serviceEnabled = (name: string): MissionCheck => machine((m) => m.services[name]?.enabled === true);
export const packageInstalled = (name: string): MissionCheck => machine((m) => m.packages[name]?.status === 'installed');
export const packageAbsent = (name: string): MissionCheck => machine((m) => !m.packages[name] || m.packages[name].status !== 'installed');
export const noProcessMatching = (pattern: RegExp): MissionCheck => machine((m) => !m.processes.some((p) => pattern.test(p.command)));
export const processMatching = (pattern: RegExp): MissionCheck => machine((m) => m.processes.some((p) => pattern.test(p.command)));

// ───────────────────────────────── Combinadores ─────────────────────────────────

export const all = (...checks: MissionCheck[]): MissionCheck => (ctx) => checks.every((c) => c(ctx));
export const any = (...checks: MissionCheck[]): MissionCheck => (ctx) => checks.some((c) => c(ctx));
export const not = (check: MissionCheck): MissionCheck => (ctx) => !check(ctx);
