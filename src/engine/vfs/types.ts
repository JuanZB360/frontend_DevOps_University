/**
 * Tipos del sistema de archivos virtual (VFS).
 *
 * Los nodos son objetos planos (sin clases ni métodos) para que el árbol completo
 * se pueda serializar con JSON y guardar en localStorage o enviar al backend.
 */

/** Tipos de nodo soportados, equivalentes a los de un sistema de archivos Unix. */
export type NodeType = 'file' | 'dir' | 'symlink';

/** Metadatos comunes a cualquier nodo (lo que mostraría `stat`). */
interface BaseNode {
  /** Nombre del nodo dentro de su directorio padre. */
  name: string;
  /** Permisos en octal, incluidos los bits especiales (ej. 0o755, 0o1777). */
  mode: number;
  /** Usuario propietario. */
  owner: string;
  /** Grupo propietario. */
  group: string;
  /** Fecha de última modificación (epoch en milisegundos). */
  mtime: number;
}

/** Archivo regular con contenido de texto. */
export interface FileNode extends BaseNode {
  type: 'file';
  content: string;
  /**
   * Tamaño simulado en bytes, para archivos "enormes" (logs de varios GB,
   * discos llenos...) sin guardar su contenido real. Si falta, el tamaño es
   * el del contenido.
   */
  size?: number;
}

/** Tamaño de un nodo tal como lo verían ls -l, du o find -size. */
export function nodeSize(node: FsNode): number {
  if (node.type === 'file') return node.size ?? new TextEncoder().encode(node.content).length;
  if (node.type === 'symlink') return node.target.length;
  return 4096;
}

/** Directorio: sus hijos se indexan por nombre. */
export interface DirNode extends BaseNode {
  type: 'dir';
  children: Record<string, FsNode>;
}

/** Enlace simbólico (ln -s). `target` puede ser relativo o absoluto. */
export interface SymlinkNode extends BaseNode {
  type: 'symlink';
  target: string;
}

/** Cualquier nodo del árbol. */
export type FsNode = FileNode | DirNode | SymlinkNode;

/**
 * Identidad con la que se realizan las operaciones (usuario efectivo y sus grupos).
 * Se usa para comprobar permisos y asignar propietario a los archivos nuevos.
 */
export interface Identity {
  user: string;
  groups: readonly string[];
  /** Máscara de permisos para archivos nuevos (umask). Por defecto 022. */
  umask?: number;
}

/** Nombre del superusuario: se salta las comprobaciones de permisos. */
export const SUPERUSER = 'root';
