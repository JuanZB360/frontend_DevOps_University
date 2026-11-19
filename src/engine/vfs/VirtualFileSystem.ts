/**
 * Sistema de archivos virtual en memoria.
 *
 * Responsabilidad única: almacenar el árbol de nodos y aplicar sobre él las
 * operaciones primitivas de un kernel (crear, leer, escribir, borrar, mover...)
 * respetando permisos, propietarios y enlaces simbólicos.
 *
 * NO interpreta opciones de comandos (eso lo hace cada comando) ni conoce el
 * directorio actual: todas las rutas que recibe deben ser ABSOLUTAS.
 */
import { FsError } from './errors';
import { basename, dirname, isSameOrDescendant, joinPath, normalize, splitPath } from './path';
import { hasAccess, STICKY, type Access } from './permissions';
import { SUPERUSER, type DirNode, type FileNode, type FsNode, type Identity } from './types';

/** Máximo de enlaces simbólicos encadenados antes de lanzar ELOOP (igual que Linux). */
const MAX_SYMLINK_DEPTH = 40;

/** Rutas especiales que se comportan como dispositivos. */
const DEV_NULL = '/dev/null';

export interface VfsOptions {
  /** Devuelve la identidad actual (cambia con `su`/`sudo`). */
  identity: () => Identity;
  /** Reloj inyectable para tests deterministas. */
  clock?: () => number;
}

export class VirtualFileSystem {
  private readonly root: DirNode;
  private readonly currentIdentity: () => Identity;
  private readonly clock: () => number;
  /** Identidad forzada temporalmente (operaciones internas del "kernel"). */
  private override: Identity | null = null;

  constructor(root: DirNode, options: VfsOptions) {
    this.root = root;
    this.currentIdentity = options.identity;
    this.clock = options.clock ?? Date.now;
  }

  private identity(): Identity {
    return this.override ?? this.currentIdentity();
  }

  /**
   * Ejecuta `fn` con privilegios de root. Lo usan los servicios simulados
   * (apt, systemd, cron...) para leer y escribir su estado interno aunque el
   * usuario no tenga permisos, igual que hace el sistema real.
   */
  privileged<T>(fn: () => T): T {
    const previous = this.override;
    this.override = { user: SUPERUSER, groups: [SUPERUSER], umask: 0o022 };
    try {
      return fn();
    } finally {
      this.override = previous;
    }
  }

  /** Hora actual del sistema simulado. */
  now(): number {
    return this.clock();
  }

  // ────────────────────────────── Serialización ──────────────────────────────

  /** Copia profunda del árbol, lista para JSON.stringify. */
  snapshot(): DirNode {
    return structuredClone(this.root);
  }

  // ──────────────────────────────── Consultas ────────────────────────────────

  /** ¿Existe la ruta? (sigue enlaces simbólicos; un enlace roto devuelve false). */
  exists(path: string): boolean {
    return this.tryStat(path) !== null;
  }

  /** Igual que `stat` pero devuelve null en lugar de lanzar error. */
  tryStat(path: string, followLinks = true): FsNode | null {
    try {
      return this.stat(path, followLinks);
    } catch {
      return null;
    }
  }

  /**
   * Devuelve el nodo de una ruta.
   * @param followLinks si es false y la ruta final es un enlace, devuelve el enlace (lstat).
   * @throws FsError ENOENT | ENOTDIR | EACCES | ELOOP
   */
  stat(path: string, followLinks = true): FsNode {
    return this.walk(normalize(path), followLinks, 0);
  }

  isDirectory(path: string): boolean {
    return this.tryStat(path)?.type === 'dir';
  }

  isFile(path: string): boolean {
    return this.tryStat(path)?.type === 'file';
  }

  /** Lee el contenido de un archivo. */
  readFile(path: string): string {
    if (normalize(path) === DEV_NULL) return '';
    const node = this.stat(path);
    if (node.type === 'dir') throw new FsError('EISDIR', path);
    this.assertAccess(node as FileNode, 'r', path);
    return (node as FileNode).content;
  }

  /** Lista los hijos de un directorio ordenados alfabéticamente (como `ls`). */
  readDir(path: string): FsNode[] {
    const dir = this.requireDir(path);
    this.assertAccess(dir, 'r', path);
    return Object.values(dir.children).sort((a, b) =>
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
    );
  }

  /** Resuelve la ruta real de un enlace simbólico (como `readlink -f`). */
  realPath(path: string): string {
    return this.walkWithPath(normalize(path), true, 0).path;
  }

  /** Comprueba un permiso sin lanzar error (útil para `test -r`, `cd`, etc.). */
  canAccess(path: string, access: Access): boolean {
    const node = this.tryStat(path);
    return node !== null && hasAccess(node, this.identity(), access);
  }

  // ─────────────────────────────── Mutaciones ────────────────────────────────

  /**
   * Escribe (o añade) contenido en un archivo, creándolo si no existe.
   * Escribir en /dev/null descarta el contenido.
   */
  writeFile(path: string, content: string, append = false): void {
    const abs = normalize(path);
    if (abs === DEV_NULL) return;

    const existing = this.tryStat(abs);
    if (existing) {
      if (existing.type === 'dir') throw new FsError('EISDIR', path);
      this.assertAccess(existing, 'w', path);
      const file = existing as FileNode;
      if (append && file.size !== undefined) file.size += content.length;
      else delete file.size; // Sobrescribir un archivo "enorme" libera su espacio.
      file.content = append ? file.content + content : content;
      file.mtime = this.clock();
      return;
    }
    const { dir, name } = this.parentForCreate(abs, path);
    dir.children[name] = this.inherit(dir, this.newFile(name, content));
    dir.mtime = this.clock();
  }

  /** Crea un archivo vacío o actualiza su fecha si ya existe (`touch`). */
  touch(path: string): void {
    const existing = this.tryStat(path);
    if (existing) {
      this.assertAccess(existing, 'w', path);
      existing.mtime = this.clock();
      return;
    }
    this.writeFile(path, '');
  }

  /**
   * Crea un directorio.
   * @param parents equivalente a `mkdir -p`: crea los padres y no falla si ya existe.
   */
  mkdir(path: string, parents = false): void {
    const abs = normalize(path);
    if (!parents) {
      if (this.tryStat(abs, false)) throw new FsError('EEXIST', path);
      const { dir, name } = this.parentForCreate(abs, path);
      dir.children[name] = this.inherit(dir, this.newDir(name));
      dir.mtime = this.clock();
      return;
    }
    let current = '/';
    for (const segment of splitPath(abs)) {
      const next = joinPath(current, segment);
      const node = this.tryStat(next);
      if (!node) {
        const { dir } = this.parentForCreate(next, next);
        dir.children[segment] = this.inherit(dir, this.newDir(segment));
      } else if (node.type !== 'dir') {
        throw new FsError('ENOTDIR', next);
      }
      current = next;
    }
  }

  /** Elimina un directorio vacío (`rmdir`). */
  rmdir(path: string): void {
    const node = this.stat(path, false);
    if (node.type !== 'dir') throw new FsError('ENOTDIR', path);
    if (Object.keys(node.children).length > 0) throw new FsError('ENOTEMPTY', path);
    this.unlink(path, node);
  }

  /**
   * Elimina un archivo, enlace o (con `recursive`) un directorio completo.
   * Nunca sigue el enlace final: borrar un enlace no borra su destino.
   */
  remove(path: string, recursive = false): void {
    const abs = normalize(path);
    if (abs === '/') throw new FsError('EBUSY', path);
    const node = this.stat(abs, false);
    if (node.type === 'dir' && !recursive) throw new FsError('EISDIR', path);
    if (node.type === 'dir') this.assertTreeRemovable(node, abs);
    this.unlink(abs, node);
  }

  /**
   * Copia `src` exactamente en `dest` (ruta final, no el directorio contenedor).
   * Decidir si `dest` es un directorio destino es tarea del comando `cp`.
   */
  copy(src: string, dest: string, recursive = false): void {
    const source = this.stat(src);
    if (source.type === 'dir' && !recursive) throw new FsError('EISDIR', src);
    if (source.type === 'dir' && isSameOrDescendant(this.realPath(src), normalize(dest))) {
      throw new FsError('EINVAL', dest);
    }
    this.assertReadableTree(source, src);
    this.copyNode(source, normalize(dest), dest);
  }

  /** Mueve o renombra `src` a la ruta exacta `dest`. */
  move(src: string, dest: string): void {
    const absSrc = normalize(src);
    const absDest = normalize(dest);
    if (absSrc === absDest) return;
    const node = this.stat(absSrc, false);
    if (node.type === 'dir' && isSameOrDescendant(absSrc, absDest)) throw new FsError('EINVAL', dest);

    const srcParent = this.requireDir(dirname(absSrc));
    this.assertAccess(srcParent, 'w', dirname(src));
    this.assertStickyAllows(srcParent, node, src);

    const existing = this.tryStat(absDest, false);
    if (existing?.type === 'dir' && node.type !== 'dir') throw new FsError('EISDIR', dest);
    if (existing?.type === 'dir' && Object.keys(existing.children).length > 0) {
      throw new FsError('ENOTEMPTY', dest);
    }
    const destParent = this.requireDir(dirname(absDest));
    this.assertAccess(destParent, 'w', dirname(dest));

    delete srcParent.children[node.name];
    node.name = basename(absDest);
    destParent.children[node.name] = node;
    srcParent.mtime = destParent.mtime = this.clock();
  }

  /** Crea un enlace simbólico en `linkPath` que apunta a `target` (`ln -s`). */
  symlink(target: string, linkPath: string): void {
    const abs = normalize(linkPath);
    if (this.tryStat(abs, false)) throw new FsError('EEXIST', linkPath);
    const { dir, name } = this.parentForCreate(abs, linkPath);
    const { user, groups } = this.identity();
    dir.children[name] = {
      type: 'symlink', name, target, mode: 0o777, owner: user, group: groups[0] ?? user, mtime: this.clock(),
    };
  }

  /** Cambia los permisos. Solo el propietario o root pueden hacerlo. */
  chmod(path: string, mode: number): void {
    const node = this.stat(path);
    this.assertOwnerOrRoot(node, path);
    node.mode = mode & 0o7777;
    node.mtime = this.clock();
  }

  /** Cambia propietario y/o grupo. Solo root puede cambiar el propietario. */
  chown(path: string, owner?: string, group?: string): void {
    const node = this.stat(path);
    const { user } = this.identity();
    if (owner !== undefined && owner !== node.owner && user !== SUPERUSER) throw new FsError('EPERM', path);
    if (group !== undefined) this.assertOwnerOrRoot(node, path);
    if (owner !== undefined) node.owner = owner;
    if (group !== undefined) node.group = group;
  }

  // ─────────────────────────────── Internos ──────────────────────────────────

  /** Recorre el árbol hasta `path` comprobando permisos de travesía (x). */
  private walk(path: string, followFinal: boolean, depth: number): FsNode {
    return this.walkWithPath(path, followFinal, depth).node;
  }

  private walkWithPath(path: string, followFinal: boolean, depth: number): { node: FsNode; path: string } {
    if (depth > MAX_SYMLINK_DEPTH) throw new FsError('ELOOP', path);
    const segments = splitPath(path);
    let current: FsNode = this.root;
    let currentPath = '/';

    for (let i = 0; i < segments.length; i++) {
      if (current.type !== 'dir') throw new FsError('ENOTDIR', path);
      if (!hasAccess(current, this.identity(), 'x')) throw new FsError('EACCES', path);

      const child: FsNode | undefined = current.children[segments[i]];
      if (!child) throw new FsError('ENOENT', path);

      const isLast = i === segments.length - 1;
      if (child.type === 'symlink' && (!isLast || followFinal)) {
        const target = child.target.startsWith('/') ? child.target : joinPath(currentPath, child.target);
        const resolved = this.walkWithPath(normalize(target), true, depth + 1);
        current = resolved.node;
        currentPath = resolved.path;
      } else {
        current = child;
        currentPath = joinPath(currentPath, segments[i]);
      }
    }
    return { node: current, path: currentPath };
  }

  private requireDir(path: string): DirNode {
    const node = this.stat(path);
    if (node.type !== 'dir') throw new FsError('ENOTDIR', path);
    return node;
  }

  /**
   * Devuelve el directorio padre donde se creará `abs`, comprobando que existe,
   * que es un directorio y que tenemos permiso de escritura.
   */
  private parentForCreate(abs: string, shownPath: string): { dir: DirNode; name: string } {
    if (abs === '/') throw new FsError('EEXIST', shownPath);
    const parentPath = dirname(abs);
    const parent = this.tryStat(parentPath);
    if (!parent) throw new FsError('ENOENT', shownPath);
    if (parent.type !== 'dir') throw new FsError('ENOTDIR', shownPath);
    this.assertAccess(parent, 'w', shownPath);
    return { dir: parent, name: basename(abs) };
  }

  /**
   * Copia recursiva. Si el destino es un directorio existente se FUSIONA el
   * contenido (comportamiento de GNU cp), si es un archivo se sobrescribe.
   */
  private copyNode(source: FsNode, abs: string, shown: string): void {
    const existing = this.tryStat(abs);
    if (!existing) {
      const { dir, name } = this.parentForCreate(abs, shown);
      dir.children[name] = this.cloneForCopy(source, name);
      dir.mtime = this.clock();
      return;
    }
    if (source.type !== 'dir') {
      if (existing.type === 'dir') throw new FsError('EISDIR', shown);
      this.assertAccess(existing, 'w', shown);
      if (existing.type === 'file' && source.type === 'file') {
        existing.content = source.content;
        if (source.size !== undefined) existing.size = source.size;
        else delete existing.size;
      }
      existing.mtime = this.clock();
      return;
    }
    if (existing.type !== 'dir') throw new FsError('ENOTDIR', shown);
    this.assertAccess(existing, 'w', shown);
    for (const child of Object.values(source.children)) {
      const childAbs = joinPath(abs, child.name);
      if (child.type === 'symlink') existing.children[child.name] = this.cloneForCopy(child, child.name);
      else this.copyNode(child, childAbs, joinPath(shown, child.name));
    }
    existing.mtime = this.clock();
  }

  private unlink(path: string, node: FsNode): void {
    const parent = this.requireDir(dirname(normalize(path)));
    this.assertAccess(parent, 'w', path);
    this.assertStickyAllows(parent, node, path);
    delete parent.children[node.name];
    parent.mtime = this.clock();
  }

  /** Para borrar un árbol hace falta permiso de escritura en cada subdirectorio. */
  private assertTreeRemovable(dir: DirNode, path: string): void {
    for (const child of Object.values(dir.children)) {
      this.assertAccess(dir, 'w', path);
      if (child.type === 'dir') this.assertTreeRemovable(child, joinPath(path, child.name));
    }
  }

  private assertReadableTree(node: FsNode, path: string): void {
    this.assertAccess(node, 'r', path);
    if (node.type === 'dir') {
      for (const child of Object.values(node.children)) {
        this.assertReadableTree(child, joinPath(path, child.name));
      }
    }
  }

  /** Sticky bit (ej. /tmp): solo el dueño del archivo o del directorio pueden borrarlo. */
  private assertStickyAllows(parent: DirNode, node: FsNode, path: string): void {
    const { user } = this.identity();
    if (user === SUPERUSER || (parent.mode & STICKY) === 0) return;
    if (node.owner !== user && parent.owner !== user) throw new FsError('EPERM', path);
  }

  private assertAccess(node: FsNode, access: Access, path: string): void {
    if (!hasAccess(node, this.identity(), access)) throw new FsError('EACCES', path);
  }

  private assertOwnerOrRoot(node: FsNode, path: string): void {
    const { user } = this.identity();
    if (user !== SUPERUSER && node.owner !== user) throw new FsError('EPERM', path);
  }

  /** Directorios con SGID: lo que se crea dentro hereda su grupo (y los subdirectorios, el bit). */
  private inherit<T extends FsNode>(parent: DirNode, node: T): T {
    if ((parent.mode & 0o2000) !== 0) {
      node.group = parent.group;
      if (node.type === 'dir') node.mode |= 0o2000;
    }
    return node;
  }

  private newFile(name: string, content: string): FileNode {
    const { user, groups, umask = 0o022 } = this.identity();
    return { type: 'file', name, content, mode: 0o666 & ~umask, owner: user, group: groups[0] ?? user, mtime: this.clock() };
  }

  private newDir(name: string): DirNode {
    const { user, groups, umask = 0o022 } = this.identity();
    return { type: 'dir', name, children: {}, mode: 0o777 & ~umask, owner: user, group: groups[0] ?? user, mtime: this.clock() };
  }

  /** Clona un nodo para `cp`: la copia pertenece a quien copia y tiene fecha nueva. */
  private cloneForCopy(node: FsNode, name: string): FsNode {
    const { user, groups } = this.identity();
    const copy = structuredClone(node);
    const stamp = (n: FsNode): void => {
      n.owner = user;
      n.group = groups[0] ?? user;
      n.mtime = this.clock();
      if (n.type === 'dir') Object.values(n.children).forEach(stamp);
    };
    stamp(copy);
    copy.name = name;
    return copy;
  }
}
