/**
 * Estado de una sesión de shell: quién eres, dónde estás y tus variables.
 *
 * Equivale a lo que mantiene un proceso bash: usuario efectivo, directorio de
 * trabajo, variables (y cuáles están exportadas al entorno), alias y el código
 * de salida del último comando ($?).
 *
 * `su`, `sudo -i` y `ssh` abren una sesión "encima" de la actual; `exit`
 * vuelve a la anterior. Esa pila también se guarda.
 */
import type { Identity } from '../vfs/types';

/** Forma serializable de una sesión. */
export interface SessionSnapshot {
  user: string;
  groups: string[];
  hostname: string;
  cwd: string;
  vars: Record<string, string>;
  /** Variables exportadas al entorno. Si falta (partidas antiguas), todas lo están. */
  exported?: string[];
  aliases?: Record<string, string>;
  umask?: number;
  /** Sesiones anteriores (de la más antigua a la más reciente) a las que vuelve `exit`. */
  parents?: Omit<SessionSnapshot, 'parents'>[];
}

export class ShellSession {
  private user: string;
  private groups: string[];
  private cwdPath: string;
  private host: string;
  private vars: Map<string, string>;
  private exported: Set<string>;
  private aliasMap: Map<string, string>;
  private parents: Omit<SessionSnapshot, 'parents'>[];
  /** Máscara de permisos para archivos nuevos. */
  umask: number;
  /** Sesión del proceso padre (si esta es una copia para un script o subshell). */
  private processParent: ShellSession | null = null;
  /** Código de salida del último comando, expuesto como `$?`. */
  lastExitCode = 0;

  constructor(snapshot: SessionSnapshot) {
    this.user = snapshot.user;
    this.groups = [...snapshot.groups];
    this.host = snapshot.hostname;
    this.cwdPath = snapshot.cwd;
    this.vars = new Map(Object.entries(snapshot.vars));
    this.exported = new Set(snapshot.exported ?? Object.keys(snapshot.vars));
    this.aliasMap = new Map(Object.entries(snapshot.aliases ?? {}));
    this.parents = (snapshot.parents ?? []).map((p) => structuredClone(p));
    this.umask = snapshot.umask ?? 0o022;
  }

  /** Crea la sesión inicial de un usuario recién registrado. */
  static forNewUser(user: string, hostname: string): ShellSession {
    return new ShellSession(ShellSession.loginSnapshot(user, [user], hostname, `/home/${user}`));
  }

  /** Entorno de una sesión de login recién abierta (lo que preparan login/su -/ssh). */
  static loginSnapshot(user: string, groups: string[], hostname: string, home: string): SessionSnapshot {
    return {
      user,
      groups,
      hostname,
      cwd: home,
      vars: {
        HOME: home,
        USER: user,
        LOGNAME: user,
        SHELL: '/bin/bash',
        PATH: user === 'root' ? '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' : '/usr/local/bin:/usr/bin:/bin',
        PWD: home,
        LANG: 'es_ES.UTF-8',
        TERM: 'xterm-256color',
      },
      aliases: { ll: 'ls -alF', la: 'ls -A' },
    };
  }

  snapshot(): SessionSnapshot {
    return { ...this.ownSnapshot(), parents: this.parents.map((p) => structuredClone(p)) };
  }

  private ownSnapshot(): Omit<SessionSnapshot, 'parents'> {
    return {
      user: this.user,
      groups: [...this.groups],
      hostname: this.host,
      cwd: this.cwdPath,
      vars: Object.fromEntries(this.vars),
      exported: [...this.exported],
      aliases: Object.fromEntries(this.aliasMap),
      umask: this.umask,
    };
  }

  /**
   * Copia independiente para un proceso hijo (`bash script.sh`, subshell).
   * @param exportedOnly un script nuevo solo hereda las variables exportadas.
   */
  fork(exportedOnly: boolean): ShellSession {
    const own = this.ownSnapshot();
    const vars = exportedOnly
      ? Object.fromEntries(Object.entries(own.vars).filter(([k]) => this.exported.has(k)))
      : own.vars;
    const child = new ShellSession({ ...own, vars, aliases: exportedOnly ? {} : own.aliases });
    child.processParent = this;
    child.lastExitCode = this.lastExitCode;
    return child;
  }

  /** Identidad usada por el VFS para comprobar permisos. */
  identity(): Identity {
    return { user: this.user, groups: this.groups, umask: this.umask };
  }

  get username(): string {
    return this.user;
  }

  get userGroups(): readonly string[] {
    return this.groups;
  }

  get hostname(): string {
    return this.host;
  }

  get home(): string {
    return this.vars.get('HOME') ?? `/home/${this.user}`;
  }

  get cwd(): string {
    return this.cwdPath;
  }

  /** Cuántas sesiones hay abiertas por debajo (su, ssh...). 0 = sesión original. */
  get depth(): number {
    return this.parents.length;
  }

  /** Cambia de directorio actualizando PWD y OLDPWD (lo que hace `cd`). */
  changeDirectory(path: string): void {
    this.vars.set('OLDPWD', this.cwdPath);
    this.cwdPath = path;
    this.vars.set('PWD', path);
  }

  /** Cambia el usuario efectivo sin abrir sesión nueva (`su` sin guion). */
  switchUser(user: string, groups: string[], home: string): void {
    this.user = user;
    this.groups = groups;
    this.vars.set('USER', user);
    this.vars.set('LOGNAME', user);
    this.vars.set('HOME', home);
  }

  /** Actualiza los grupos del usuario actual (tras `usermod -aG` + `newgrp`). */
  setGroups(groups: string[]): void {
    this.groups = [...groups];
  }

  /**
   * Abre una sesión encima de la actual (su -, sudo -i, ssh).
   * @param keepEnv `su` sin guion conserva el entorno y el directorio.
   */
  pushSession(next: SessionSnapshot, keepEnv = false): void {
    this.parents.push(this.ownSnapshot());
    if (keepEnv) {
      this.switchUser(next.user, next.groups, next.vars.HOME ?? this.home);
      this.host = next.hostname;
      return;
    }
    this.load(next);
  }

  /** Cierra la sesión actual y vuelve a la anterior. @returns false si no había ninguna. */
  popSession(): boolean {
    const previous = this.parents.pop();
    if (!previous) return false;
    this.load(previous);
    return true;
  }

  private load(snapshot: Omit<SessionSnapshot, 'parents'>): void {
    this.user = snapshot.user;
    this.groups = [...snapshot.groups];
    this.host = snapshot.hostname;
    this.cwdPath = snapshot.cwd;
    this.vars = new Map(Object.entries(snapshot.vars));
    this.exported = new Set(snapshot.exported ?? Object.keys(snapshot.vars));
    this.aliasMap = new Map(Object.entries(snapshot.aliases ?? {}));
    this.umask = snapshot.umask ?? 0o022;
  }

  /**
   * Ejecuta `fn` con otra identidad y la restaura al terminar (incluso si falla).
   * Lo usa el juego para preparar escenarios como root sin cambiar el entorno del jugador.
   */
  runAs<T>(identity: Identity, fn: () => T): T {
    const previous = { user: this.user, groups: this.groups, umask: this.umask };
    this.user = identity.user;
    this.groups = [...identity.groups];
    // Las preparaciones del sistema usan la máscara estándar, no la del jugador.
    this.umask = identity.umask ?? 0o022;
    try {
      return fn();
    } finally {
      this.user = previous.user;
      this.groups = previous.groups;
      this.umask = previous.umask;
    }
  }

  /**
   * Versión asíncrona de runAs (para `sudo comando`). Si esta sesión es la
   * copia de un script, también cambia la del proceso padre: el sistema de
   * archivos comprueba los permisos con la identidad de la sesión principal.
   */
  async runAsAsync<T>(identity: Identity, fn: () => Promise<T>): Promise<T> {
    if (this.processParent) return this.processParent.runAsAsync(identity, () => this.runAsLocal(identity, fn));
    return this.runAsLocal(identity, fn);
  }

  private async runAsLocal<T>(identity: Identity, fn: () => Promise<T>): Promise<T> {
    const previous = { user: this.user, groups: this.groups };
    this.user = identity.user;
    this.groups = [...identity.groups];
    try {
      return await fn();
    } finally {
      this.user = previous.user;
      this.groups = previous.groups;
    }
  }

  /** Lee una variable, incluidas las especiales `$?` y `$$`. */
  getVar(name: string): string | undefined {
    if (name === '?') return String(this.lastExitCode);
    if (name === '$') return '1337';
    if (name === 'RANDOM') return String(Math.floor(Math.random() * 32768));
    return this.vars.get(name);
  }

  setVar(name: string, value: string): void {
    this.vars.set(name, value);
  }

  unsetVar(name: string): void {
    this.vars.delete(name);
    this.exported.delete(name);
  }

  /** Marca una variable para que la hereden los procesos hijos (`export`). */
  exportVar(name: string): void {
    this.exported.add(name);
  }

  unexportVar(name: string): void {
    this.exported.delete(name);
  }

  isExported(name: string): boolean {
    return this.exported.has(name);
  }

  /** Todas las variables ordenadas (para `set`). */
  allVars(): [string, string][] {
    return [...this.vars.entries()].sort(([a], [b]) => a.localeCompare(b));
  }

  /** Variables de entorno: solo las exportadas (para `env` / `printenv`). */
  environment(): [string, string][] {
    return this.allVars().filter(([k]) => this.exported.has(k));
  }

  // ─────────────────────────────── Alias ───────────────────────────────

  getAlias(name: string): string | undefined {
    return this.aliasMap.get(name);
  }

  setAlias(name: string, value: string): void {
    this.aliasMap.set(name, value);
  }

  removeAlias(name: string): boolean {
    return this.aliasMap.delete(name);
  }

  allAliases(): [string, string][] {
    return [...this.aliasMap.entries()].sort(([a], [b]) => a.localeCompare(b));
  }
}
