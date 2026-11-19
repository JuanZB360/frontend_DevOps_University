/**
 * Conecta los eventos del juego con los efectos de sonido.
 * Es el único sitio que decide "qué suena cuándo" (igual que MascotDirector
 * decide qué dice N0X): para cambiar un sonido no hay que tocar el juego.
 */
import type { GameEvents } from '../../game/session/GameEvents';
import type { EventBus, Unsubscribe } from '../../shared/EventBus';
import type { SoundEngine } from './SoundEngine';

/** Código de salida de bash para "comando no ejecutable" (en el juego: bloqueado). */
const EXIT_LOCKED = 126;

export function connectGameSounds(events: EventBus<GameEvents>, sounds: SoundEngine): Unsubscribe {
  const subscriptions = [
    events.on('commandExecuted', ({ report, success }) => {
      if (success) return;
      sounds.play(report.exitCode === EXIT_LOCKED ? 'denied' : 'error');
    }),
    events.on('missionCompleted', () => sounds.play('success')),
    // La subida de nivel suena después del arpegio de misión completada.
    events.on('levelUp', () => setTimeout(() => sounds.play('levelUp'), 450)),
    events.on('commandsUnlocked', () => sounds.play('unlock')),
    events.on('hintRevealed', () => sounds.play('hint')),
    events.on('missionRestarted', () => sounds.play('boot')),
    events.on('hintRejected', () => sounds.play('denied')),
  ];
  return () => subscriptions.forEach((unsubscribe) => unsubscribe());
}
