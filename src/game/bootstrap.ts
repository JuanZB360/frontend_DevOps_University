/**
 * Raíz de composición del juego: el ÚNICO lugar donde se eligen las
 * implementaciones concretas y se conectan entre sí.
 */
import { coreBinaryNames } from '../engine/commands/index';
import { DEVOPS_DOCS } from './content/manual/devops';
import { LINUX_ADMIN_DOCS } from './content/manual/linuxAdmin';
import { LINUX_BASICS_DOCS } from './content/manual/linuxBasics';
import { LINUX_SERVER_DOCS } from './content/manual/linuxServer';
import { LINUX_TEXT_DOCS } from './content/manual/linuxText';
import { MODULES } from './content/modules';
import { MissionCatalog } from './missions/MissionCatalog';
import { GameSession } from './session/GameSession';
import { createNewSave } from './session/newGame';
import type { SaveGame } from './storage/SaveGame';
import type { SaveRepository } from './storage/SaveRepository';

/** Catálogo único compartido por todas las sesiones. */
export const catalog = new MissionCatalog(MODULES);

/** Toda la documentación disponible (se ampliará con cada módulo). */
export const ALL_DOCS = [...LINUX_BASICS_DOCS, ...LINUX_TEXT_DOCS, ...LINUX_ADMIN_DOCS, ...LINUX_SERVER_DOCS, ...DEVOPS_DOCS];

export function createSession(save: SaveGame, repository: SaveRepository): GameSession {
  return new GameSession({ save, repository, catalog, docs: ALL_DOCS });
}

/** Crea una partida nueva, la guarda y devuelve su sesión. */
export function startNewGame(displayName: string, repository: SaveRepository): GameSession {
  const save = createNewSave(displayName, coreBinaryNames());
  repository.save(save);
  return createSession(save, repository);
}
