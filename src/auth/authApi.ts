/**
 * Endpoints de cuentas y progreso. Es el único módulo que conoce las URLs y
 * la forma de los JSON del backend.
 */
import type { SaveGame } from '../game/storage/SaveGame';
import { apiRequest } from './apiClient';

/** Jugador tal como lo devuelve el backend (PlayerResponse.java). */
export interface PlayerDto {
  id: string;
  displayName: string;
  username: string;
  createdAt: string;
  progress: {
    xp: number;
    level: number;
    points: number;
    completedMissions: number;
    /** Partida completa guardada; null si aún no ha jugado. */
    saveSnapshot: unknown;
    updatedAt: string;
  };
}

/** Respuesta al registrarse o iniciar sesión (AuthResponse.java). */
export interface AuthResponse {
  token: string;
  expiresAt: string;
  player: PlayerDto;
}

/** Cuerpo de PUT /me/progress (SyncProgressRequest.java). */
export interface ProgressPayload {
  xp: number;
  level: number;
  points: number;
  completedMissions: number;
  saveSnapshot: SaveGame;
  /** true para sustituir aunque tenga menos XP (reiniciar o importar). */
  replace?: boolean;
}

export const authApi = {
  register: (username: string, password: string) =>
    apiRequest<AuthResponse>('/auth/register', { method: 'POST', body: { username, password } }),

  login: (username: string, password: string) =>
    apiRequest<AuthResponse>('/auth/login', { method: 'POST', body: { username, password } }),

  logout: (token: string) => apiRequest<void>('/auth/logout', { method: 'POST', token }),

  me: (token: string) => apiRequest<PlayerDto>('/me', { token }),

  saveProgress: (token: string, payload: ProgressPayload, keepalive = false) =>
    apiRequest<PlayerDto>('/me/progress', { method: 'PUT', body: payload, token, keepalive }),
};
