/**
 * Une una sesión de usuario (token del backend) con una partida en marcha.
 *
 * Es parte de la raíz de composición: aquí se decide que la partida se guarda
 * en el servidor (RemoteSaveRepository + authApi). El juego no sabe nada de
 * HTTP ni de tokens.
 */
import { ApiError } from '../auth/apiClient';
import { authApi, type PlayerDto } from '../auth/authApi';
import { tokenStore } from '../auth/tokenStore';
import { coreBinaryNames } from '../engine/commands/index';
import { createSession } from '../game/bootstrap';
import type { GameSession } from '../game/session/GameSession';
import { createNewSave } from '../game/session/newGame';
import { parseSave } from '../game/storage/LocalStorageSaveRepository';
import {
  ProgressPushError,
  RemoteSaveRepository,
  progressSummary,
  type ProgressGateway,
} from '../game/storage/RemoteSaveRepository';
import type { SaveGame } from '../game/storage/SaveGame';

/** Partida en curso de un usuario con la sesión iniciada. */
export interface ActiveGame {
  token: string;
  username: string;
  session: GameSession;
  repository: RemoteSaveRepository;
  isNewPlayer: boolean;
}

/** Gateway hacia PUT /me/progress, ligado SIEMPRE al token de esta sesión. */
function createGateway(token: string): ProgressGateway {
  return {
    async push(save, replace, keepalive) {
      try {
        await authApi.saveProgress(token, { ...progressSummary(save), saveSnapshot: save, replace }, keepalive);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) throw new ProgressPushError('unauthorized');
        // 409 = el servidor tiene más progreso; otros 4xx tampoco se arreglan reintentando.
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          throw new ProgressPushError('conflict', error.message);
        }
        throw new ProgressPushError('network');
      }
    },
  };
}

/** Partida guardada en el servidor, si existe y pertenece de verdad a este usuario. */
function savedGame(player: PlayerDto): SaveGame | null {
  const snapshot = player.progress.saveSnapshot;
  if (snapshot === null || snapshot === undefined) return null;
  try {
    const save = parseSave(JSON.stringify(snapshot));
    return save.player.username === player.username ? save : null;
  } catch (error) {
    console.warn('[save] La partida del servidor está dañada; se empieza una nueva.', error);
    return null;
  }
}

/** Partida nueva para el usuario (el nombre visible es su propio usuario). */
export function freshSave(username: string): SaveGame {
  return createNewSave(username, coreBinaryNames());
}

/**
 * Abre la partida del jugador recién autenticado.
 * @param onSessionLost se llama si la sesión deja de ser válida mientras se juega
 */
export function openGame(token: string, player: PlayerDto, onSessionLost: () => void): ActiveGame {
  const restored = savedGame(player);
  const save = restored ?? freshSave(player.username);
  const repository = new RemoteSaveRepository(createGateway(token), save, {
    // Si el token guardado cambia (logout, otra cuenta en otra pestaña, DevTools),
    // esta partida deja de guardar: nunca se escribe en la cuenta equivocada.
    isSessionAlive: () => tokenStore.currentToken() === token,
    onSessionLost,
  });
  // Primera partida: se sube ya, para que exista en la base de datos desde el principio.
  if (!restored) repository.replace(save);
  return {
    token,
    username: player.username,
    session: createSession(save, repository),
    repository,
    isNewPlayer: !restored,
  };
}

/**
 * Sustituye la partida actual por otra (reiniciar o importar) en el mismo
 * repositorio: el servidor la reemplaza aunque tenga menos progreso.
 */
export function replaceGame(game: ActiveGame, save: SaveGame, isNewPlayer: boolean): ActiveGame {
  game.repository.replace(save);
  return { ...game, session: createSession(save, game.repository), isNewPlayer };
}

/** Mensaje legible para cualquier error de la API. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Algo salió mal. Inténtalo de nuevo.';
}
