/**
 * Cliente HTTP mínimo para la API de DevOps University (backend Spring Boot).
 *
 * - Todas las rutas cuelgan de /api/v1 (en desarrollo Vite las redirige al
 *   backend, ver vite.config.ts).
 * - Los errores del backend llegan como Problem Details (RFC 9457) y se
 *   convierten en `ApiError` con el `code` estable que manda el servidor.
 */

export const API_BASE = '/api/v1';

/** Error devuelto por el servidor (4xx/5xx). */
export class ApiError extends Error {
  readonly status: number;
  /** Código estable del backend: INVALID_CREDENTIALS, USERNAME_TAKEN, STALE_PROGRESS… */
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** No se pudo contactar con el servidor (apagado, sin red…). */
export class NetworkError extends Error {
  constructor() {
    super('No se pudo conectar con el servidor. ¿Está arrancado el backend?');
    this.name = 'NetworkError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  token?: string | null;
  /** Permite que la petición termine aunque se cierre la pestaña (máx. 64 KB de cuerpo). */
  keepalive?: boolean;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      keepalive: options.keepalive,
    });
  } catch {
    throw new NetworkError();
  }

  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw toApiError(response.status, data);
  return data as T;
}

function toApiError(status: number, data: unknown): ApiError {
  const problem = (data ?? {}) as { code?: unknown; detail?: unknown; errors?: Record<string, string> };
  const fieldErrors = problem.errors ? Object.values(problem.errors).join('. ') : '';
  const detail = fieldErrors || (typeof problem.detail === 'string' ? problem.detail : '');
  // Vite responde 500/502 sin cuerpo JSON cuando el backend está apagado.
  if (!detail && status >= 500) return new ApiError(status, 'SERVER_UNAVAILABLE', new NetworkError().message);
  return new ApiError(status, typeof problem.code === 'string' ? problem.code : 'HTTP_' + status, detail || `Error ${status}`);
}
