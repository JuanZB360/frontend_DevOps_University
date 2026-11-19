/**
 * Puerto de persistencia (Inversión de Dependencias).
 *
 * El juego depende de esta interfaz, no de localStorage. Hoy se implementa
 * con localStorage; mañana se puede añadir una implementación que sincronice
 * con el backend Spring Boot sin tocar la lógica del juego.
 */
import type { SaveGame } from './SaveGame';

export interface SaveRepository {
  load(): SaveGame | null;
  save(game: SaveGame): void;
  clear(): void;
}
