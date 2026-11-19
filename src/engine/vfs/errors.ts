/**
 * Errores del sistema de archivos con códigos equivalentes a los `errno` de Linux.
 * Los comandos los capturan y los convierten en mensajes idénticos a los reales,
 * para que el alumno se familiarice con lo que verá en un servidor de verdad.
 */

export type FsErrorCode =
  | 'ENOENT'
  | 'EEXIST'
  | 'ENOTDIR'
  | 'EISDIR'
  | 'EACCES'
  | 'EPERM'
  | 'ENOTEMPTY'
  | 'EINVAL'
  | 'ELOOP'
  | 'EBUSY';

/** Mensaje estándar de Linux (en inglés, como en un servidor real) por código. */
const MESSAGES: Record<FsErrorCode, string> = {
  ENOENT: 'No such file or directory',
  EEXIST: 'File exists',
  ENOTDIR: 'Not a directory',
  EISDIR: 'Is a directory',
  EACCES: 'Permission denied',
  EPERM: 'Operation not permitted',
  ENOTEMPTY: 'Directory not empty',
  EINVAL: 'Invalid argument',
  ELOOP: 'Too many levels of symbolic links',
  EBUSY: 'Device or resource busy',
};

export class FsError extends Error {
  readonly code: FsErrorCode;
  /** Ruta (tal como la verá el usuario) que provocó el error. */
  readonly path: string;

  constructor(code: FsErrorCode, path: string) {
    super(MESSAGES[code]);
    this.name = 'FsError';
    this.code = code;
    this.path = path;
  }

  /** Devuelve el texto del error sin la ruta (ej. "Permission denied"). */
  get reason(): string {
    return MESSAGES[this.code];
  }
}

/** Type guard para distinguir errores del VFS de errores de programación. */
export function isFsError(error: unknown): error is FsError {
  return error instanceof FsError;
}
