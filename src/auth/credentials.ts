/**
 * Reglas de usuario y contraseña. Son las mismas que aplica el backend
 * (Username.java y RawPassword.java): si cambias una, cambia la otra.
 * Validar aquí solo sirve para avisar antes; quien manda es el servidor.
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 16;
export const PASSWORD_MIN = 8;
const RESERVED = new Set(['root', 'daemon', 'www-data', 'nobody', 'admin']);

/** "  Juan_Dev " → "juan_dev" (igual que Username.of en el backend). */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Devuelve el error o null si el usuario es válido. */
export function validateUsername(raw: string): string | null {
  const username = normalizeUsername(raw);
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    return `El usuario debe tener entre ${USERNAME_MIN} y ${USERNAME_MAX} caracteres.`;
  }
  if (!/^[a-z][a-z0-9_-]*$/.test(username)) {
    return "Solo minúsculas, números, '-' y '_', empezando por una letra (como en Linux).";
  }
  if (RESERVED.has(username)) return `'${username}' es un usuario reservado del sistema.`;
  return null;
}

/** Devuelve el error o null si la contraseña es válida. */
export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`;
  if (new TextEncoder().encode(password).length > 72) return 'La contraseña es demasiado larga (máximo 72 bytes).';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'La contraseña debe combinar letras y números.';
  return null;
}
