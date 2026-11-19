/**
 * Índice ordenado de todas las misiones jugables.
 * Responsabilidad única: responder "¿qué misión va ahora?" y "¿a qué capítulo pertenece?".
 */
import type { Chapter, CurriculumModule, Mission } from '../domain/curriculum';

export interface MissionLocation {
  mission: Mission;
  chapter: Chapter;
  module: CurriculumModule;
  /** Posición global (0 = primera misión de la universidad). */
  index: number;
  isFirstOfChapter: boolean;
  isLastOfChapter: boolean;
}

export class MissionCatalog {
  private readonly ordered: MissionLocation[] = [];
  private readonly byId = new Map<string, MissionLocation>();
  readonly modules: readonly CurriculumModule[];

  constructor(modules: readonly CurriculumModule[]) {
    this.modules = modules;
    for (const module of modules) {
      for (const chapter of module.chapters) {
        chapter.missions.forEach((mission, i) => {
          if (this.byId.has(mission.id)) throw new Error(`ID de misión duplicado: ${mission.id}`);
          const location: MissionLocation = {
            mission, chapter, module, index: this.ordered.length,
            isFirstOfChapter: i === 0, isLastOfChapter: i === chapter.missions.length - 1,
          };
          this.ordered.push(location);
          this.byId.set(mission.id, location);
        });
      }
    }
  }

  get size(): number {
    return this.ordered.length;
  }

  locate(id: string): MissionLocation | undefined {
    return this.byId.get(id);
  }

  /** Primera misión no completada, o undefined si se ha completado todo lo disponible. */
  nextPending(completed: ReadonlySet<string> | Record<string, unknown>): MissionLocation | undefined {
    const isDone = (id: string): boolean => (completed instanceof Set ? completed.has(id) : id in completed);
    return this.ordered.find((l) => !isDone(l.mission.id));
  }

  /** Todos los comandos que enseñan las misiones hasta `index` incluida. */
  commandsTaughtUpTo(index: number): string[] {
    return this.ordered.slice(0, index + 1).flatMap((l) => l.mission.teaches);
  }

  all(): readonly MissionLocation[] {
    return this.ordered;
  }
}
