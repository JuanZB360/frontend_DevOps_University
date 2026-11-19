/**
 * Creación de partidas nuevas.
 */
import { CommandHistory } from '../../engine/system/CommandHistory';
import { createBaseFilesystem } from '../../engine/system/seedFilesystem';
import { ShellSession } from '../../engine/system/ShellSession';
import { STARTING_POINTS } from '../domain/progression';
import { SAVE_VERSION, type SaveGame } from '../storage/SaveGame';

export const HOSTNAME = 'devops-u';

/** Usuarios del sistema con los que no puede coincidir el jugador. */
const RESERVED_USERS = new Set(['root', 'daemon', 'www-data', 'nobody', 'admin']);
const MAX_USERNAME = 16;

/**
 * Convierte el nombre del jugador en un usuario Linux válido:
 * "José Pérez" → "joseperez". Debe empezar por letra.
 */
export function toUsername(displayName: string): string {
  let username = displayName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, MAX_USERNAME);
  if (!username) username = 'neo';
  if (RESERVED_USERS.has(username)) username = `${username}1`;
  return username;
}

/** Valida el nombre introducido en la pantalla de acceso. Devuelve el error o null. */
export function validateDisplayName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 2) return 'El nombre debe tener al menos 2 caracteres.';
  if (trimmed.length > 24) return 'El nombre no puede superar los 24 caracteres.';
  if (!/[a-zA-Z]/.test(trimmed)) return 'El nombre debe contener al menos una letra.';
  return null;
}

/**
 * Crea una partida con un servidor recién instalado.
 * @param binaryNames comandos que aparecerán como instalados en /usr/bin.
 */
export function createNewSave(displayName: string, binaryNames: readonly string[], now = Date.now()): SaveGame {
  const username = toUsername(displayName);
  const session = ShellSession.forNewUser(username, HOSTNAME);
  return {
    version: SAVE_VERSION,
    player: { displayName: displayName.trim(), username, createdAt: now },
    xp: 0,
    points: STARTING_POINTS,
    unlockedCommands: [],
    completedMissions: {},
    activeMission: null,
    world: {
      fs: createBaseFilesystem(username, HOSTNAME, binaryNames),
      session: session.snapshot(),
      history: new CommandHistory().list() as string[],
    },
    stats: { commandsExecuted: 0, commandErrors: 0 },
  };
}
