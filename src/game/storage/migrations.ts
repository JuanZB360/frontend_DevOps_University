/**
 * Migraciones del formato de guardado.
 *
 * Cada entrada transforma una partida de la versión N a la N+1.
 * Ejemplo para el futuro:
 *   2: (save) => ({ ...save, version: 2, achievements: [] }),
 */
import { SAVE_VERSION } from './SaveGame';

type RawSave = Record<string, unknown> & { version: number };

const MIGRATIONS: Record<number, (save: RawSave) => RawSave> = {
  // Aún no hay migraciones: la versión actual es la 1.
};

/** Aplica en orden todas las migraciones pendientes. */
export function migrate(save: RawSave): RawSave {
  let current = save;
  while (current.version < SAVE_VERSION) {
    const step = MIGRATIONS[current.version + 1];
    if (!step) throw new Error(`No existe migración a la versión ${current.version + 1}`);
    current = step(current);
  }
  return current;
}
