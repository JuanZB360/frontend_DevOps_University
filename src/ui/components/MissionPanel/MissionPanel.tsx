/**
 * Panel derecho: misión actual, pistas y mapa de la universidad.
 */
import type { CurriculumModule } from '../../../game/domain/curriculum';
import type { PlayerView } from '../../../game/session/PlayerView';
import styles from './MissionPanel.module.css';

interface Props {
  view: PlayerView;
  modules: readonly CurriculumModule[];
  onHint: () => void;
  onRestart: () => void;
}

const HINT_LABELS = ['Concepto', 'Comando', 'Solución'];

/** Resalta `código` en los textos de misión. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/g).map((part, i) =>
        part.startsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : <span key={i}>{part}</span>,
      )}
    </>
  );
}

export function MissionPanel({ view, modules, onHint, onRestart }: Props) {
  const mission = view.currentMission;

  return (
    <section className={styles.panel} aria-label="Misión actual">
      {mission ? (
        <>
          <p className={styles.breadcrumb}>
            {mission.moduleTitle} › Cap. {mission.chapterNumber}: {mission.chapterTitle}
          </p>
          <h2 className={`${styles.title} ${mission.boss ? styles.boss : ''}`}>
            {mission.boss && <span className={styles.bossTag}>JEFE</span>}
            {mission.title}
          </h2>
          <div className={styles.meta}>
            <span title={`Dificultad ${mission.difficulty}/5`}>
              {'◆'.repeat(mission.difficulty)}
              <span className={styles.dim}>{'◇'.repeat(5 - mission.difficulty)}</span>
            </span>
            <span className={styles.dim}>Misión {mission.missionNumber}/{mission.chapterMissionCount}</span>
          </div>
          <div className={styles.chapterProgress} aria-hidden="true">
            {Array.from({ length: mission.chapterMissionCount }, (_, i) => (
              <i key={i} className={i < mission.missionNumber - 1 ? styles.done : i === mission.missionNumber - 1 ? styles.current : ''} />
            ))}
          </div>

          <div className={styles.objective}>
            <span className={styles.label}>◎ OBJETIVO</span>
            <p><Rich text={mission.objective} /></p>
          </div>

          {mission.revealedHints.length > 0 && (
            <ol className={styles.hints}>
              {mission.revealedHints.map((hint, i) => (
                <li key={i}>
                  <span className={styles.hintLabel}>💡 {HINT_LABELS[i]}</span>
                  <Rich text={hint} />
                </li>
              ))}
            </ol>
          )}

          <div className={styles.actions}>
            <button
              type="button"
              className="btn btn--amber"
              onClick={onHint}
              disabled={mission.nextHintCost === null || view.points < mission.nextHintCost}
              title={mission.nextHintCost === null ? 'No quedan pistas' : `Cuesta ${mission.nextHintCost} puntos`}
            >
              {mission.nextHintCost === null ? 'Sin más pistas' : `Pista · ${mission.nextHintCost} pts`}
            </button>
            <button type="button" className="btn btn--ghost" onClick={onRestart} title="Vuelve a crear los archivos de la misión">
              ↺ Reiniciar escenario
            </button>
          </div>
        </>
      ) : (
        <div className={styles.objective}>
          <span className={styles.label}>◎ CONTENIDO COMPLETADO</span>
          <p>Has superado todas las misiones disponibles. Los siguientes capítulos están en desarrollo: sigue practicando en la terminal.</p>
        </div>
      )}

      <details className={styles.map}>
        <summary>Mapa de la universidad</summary>
        <ol className={styles.modules}>
          {modules.map((module, index) => {
            const missions = module.chapters.flatMap((c) => c.missions);
            const done = missions.filter((m) => view.completedMissions[m.id]).length;
            const total = missions.length + module.upcoming.length;
            const previousIncomplete = index > 0 && modules[index - 1].chapters.flatMap((c) => c.missions).some((m) => !view.completedMissions[m.id]);
            const locked = previousIncomplete || missions.length === 0;
            return (
              <li key={module.id} className={locked ? styles.lockedModule : ''}>
                <span>{locked ? '🔒' : '▣'} {module.title}</span>
                <small>{missions.length ? `${done}/${missions.length} misiones · ${total - missions.length} temas próximos` : 'Próximamente'}</small>
              </li>
            );
          })}
        </ol>
      </details>
    </section>
  );
}
