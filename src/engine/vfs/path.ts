/**
 * Utilidades puras para manipular rutas POSIX.
 *
 * No conocen el sistema de archivos: solo operan sobre texto. Mantenerlas
 * separadas del VFS (Single Responsibility) permite testearlas de forma aislada
 * y reutilizarlas en el shell, el autocompletado y los validadores de misiones.
 */

/** Ruta de la raíz del sistema de archivos. */
export const ROOT_PATH = '/';

/**
 * Normaliza una ruta absoluta: elimina barras duplicadas y resuelve `.` y `..`.
 * Igual que en Linux, `..` en la raíz se queda en la raíz.
 *
 * @example normalize('/home//neo/../neo/./docs') // '/home/neo/docs'
 */
export function normalize(path: string): string {
  const parts: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return '/' + parts.join('/');
}

/**
 * Convierte cualquier ruta (absoluta o relativa) en una ruta absoluta normalizada.
 * La expansión de `~` NO se hace aquí: es responsabilidad del expansor del shell,
 * igual que en bash (`cd "~"` no te lleva a tu home).
 */
export function resolvePath(cwd: string, input: string): string {
  if (input === '') return normalize(cwd);
  return normalize(input.startsWith('/') ? input : `${cwd}/${input}`);
}

/** Devuelve los segmentos de una ruta absoluta: '/a/b' → ['a', 'b']. */
export function splitPath(path: string): string[] {
  return normalize(path).split('/').filter(Boolean);
}

/** Directorio padre: '/a/b' → '/a'. El padre de '/' es '/'. */
export function dirname(path: string): string {
  const parts = splitPath(path);
  parts.pop();
  return '/' + parts.join('/');
}

/** Último segmento: '/a/b.txt' → 'b.txt'. El basename de '/' es '/'. */
export function basename(path: string): string {
  return splitPath(path).at(-1) ?? '/';
}

/** Une segmentos y normaliza el resultado. */
export function joinPath(...segments: string[]): string {
  return normalize(segments.join('/'));
}

/**
 * Indica si `child` está dentro de `parent` (o es el mismo).
 * Útil para impedir operaciones como `mv dir dir/sub`.
 */
export function isSameOrDescendant(parent: string, child: string): boolean {
  const p = normalize(parent);
  const c = normalize(child);
  return c === p || c.startsWith(p === '/' ? '/' : p + '/');
}

/**
 * Representa una ruta absoluta de forma amigable sustituyendo el home por `~`.
 * Se usa en el prompt: /home/neo/docs → ~/docs
 */
export function prettifyPath(path: string, home: string): string {
  if (path === home) return '~';
  if (path.startsWith(home + '/')) return '~' + path.slice(home.length);
  return path;
}
