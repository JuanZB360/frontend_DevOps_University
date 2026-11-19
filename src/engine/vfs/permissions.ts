/**
 * Lógica de permisos Unix (rwx para propietario, grupo y otros + bits especiales).
 *
 * Está aislada del VFS para poder reutilizarla en comandos como `ls -l`, `chmod`
 * o `stat`, y para testear la semántica de permisos sin construir un árbol.
 */
import { SUPERUSER, type FsNode, type Identity } from './types';

export type Access = 'r' | 'w' | 'x';

const ACCESS_BIT: Record<Access, number> = { r: 4, w: 2, x: 1 };

/** Bits especiales. */
export const SETUID = 0o4000;
export const SETGID = 0o2000;
export const STICKY = 0o1000;

/**
 * Comprueba si `identity` tiene el permiso `access` sobre `node`.
 * Reglas (como en Linux):
 *  - root puede leer/escribir todo; para ejecutar un archivo necesita que
 *    al menos un bit x esté activo.
 *  - Si eres el propietario se evalúan SOLO los bits de propietario,
 *    aunque los de grupo u otros sean más permisivos.
 */
export function hasAccess(node: FsNode, identity: Identity, access: Access): boolean {
  if (identity.user === SUPERUSER) {
    return access !== 'x' || node.type === 'dir' || (node.mode & 0o111) !== 0;
  }
  const bit = ACCESS_BIT[access];
  if (node.owner === identity.user) return ((node.mode >> 6) & bit) !== 0;
  if (identity.groups.includes(node.group)) return ((node.mode >> 3) & bit) !== 0;
  return (node.mode & bit) !== 0;
}

/** Carácter de tipo usado por `ls -l`. */
function typeChar(node: FsNode): string {
  if (node.type === 'dir') return 'd';
  if (node.type === 'symlink') return 'l';
  return '-';
}

/**
 * Convierte el modo numérico en la cadena de `ls -l`.
 * @example formatMode(dir 0o755) // 'drwxr-xr-x'
 * @example formatMode(dir 0o1777) // 'drwxrwxrwt'
 */
export function formatMode(node: FsNode): string {
  const m = node.mode;
  const triplet = (shift: number, special: boolean, specialChar: string): string => {
    const r = m & (4 << shift) ? 'r' : '-';
    const w = m & (2 << shift) ? 'w' : '-';
    const hasX = (m & (1 << shift)) !== 0;
    let x = hasX ? 'x' : '-';
    if (special) x = hasX ? specialChar : specialChar.toUpperCase();
    return r + w + x;
  };
  return (
    typeChar(node) +
    triplet(6, (m & SETUID) !== 0, 's') +
    triplet(3, (m & SETGID) !== 0, 's') +
    triplet(0, (m & STICKY) !== 0, 't')
  );
}

/** Representación octal de 3 o 4 dígitos (ej. '755', '1777'). */
export function formatOctal(mode: number): string {
  const special = (mode >> 9) & 0o7;
  const base = (mode & 0o777).toString(8).padStart(3, '0');
  return special ? `${special}${base}` : base;
}
