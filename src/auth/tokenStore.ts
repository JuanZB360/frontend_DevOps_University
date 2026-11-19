/**
 * Dónde guarda el navegador la sesión iniciada.
 *
 * En localStorage solo se guarda el token de sesión (no la contraseña ni la
 * partida): la partida vive en la base de datos del servidor. Si se borra
 * esta clave, la sesión se da por cerrada y se vuelve a la pantalla de acceso.
 */

export const AUTH_STORAGE_KEY = 'devops-university:auth';

export interface StoredSession {
  token: string;
  username: string;
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export const tokenStore = {
  load(): StoredSession | null {
    try {
      const raw = storage()?.getItem(AUTH_STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw) as Partial<StoredSession>;
      return typeof data.token === 'string' && typeof data.username === 'string'
        ? { token: data.token, username: data.username }
        : null;
    } catch {
      return null;
    }
  },

  save(session: StoredSession): void {
    try {
      storage()?.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
    } catch {
      /* sin almacenamiento (modo incógnito estricto): la sesión dura lo que la pestaña */
    }
  },

  clear(): void {
    try {
      storage()?.removeItem(AUTH_STORAGE_KEY);
    } catch {
      /* nada que borrar */
    }
  },

  /** Token actual, o null si alguien borró la sesión (otra pestaña, DevTools…). */
  currentToken(): string | null {
    return this.load()?.token ?? null;
  },
};
