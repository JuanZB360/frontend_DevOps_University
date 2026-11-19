/**
 * Director de N0X: traduce los eventos del juego en estados de ánimo y frases.
 *
 * Es lógica pura sin React: la interfaz solo se suscribe y pinta el estado.
 * Así se puede cambiar el aspecto de la mascota sin tocar su "personalidad".
 */
import type { EventBus, Unsubscribe } from '../../shared/EventBus';
import { DIALOGUES, type DialogueKey } from '../content/mascot/dialogues';
import type { GameEvents } from '../session/GameEvents';

export type MascotMood = 'idle' | 'talking' | 'happy' | 'thinking' | 'worried' | 'excited';

export interface MascotState {
  mood: MascotMood;
  message: string;
  /** Cambia en cada frase nueva (permite reiniciar animaciones aunque el texto se repita). */
  id: number;
}

export interface MascotDirectorOptions {
  displayName: string;
  /** Milisegundos sin actividad antes de dar un consejo. */
  idleMs?: number;
  random?: () => number;
}

/** Tras cuántos errores seguidos N0X sugiere pedir ayuda. */
const ERROR_STREAK = 3;
/** Probabilidad de comentar un comando correcto (para no saturar). */
const SUCCESS_COMMENT_CHANCE = 0.15;

export class MascotDirector {
  private state: MascotState;
  private readonly listeners = new Set<(state: MascotState) => void>();
  private readonly unsubscribers: Unsubscribe[] = [];
  private readonly options: Required<MascotDirectorOptions>;
  private errorStreak = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private calmTimer: ReturnType<typeof setTimeout> | null = null;
  private nextId = 1;
  /** Mientras se celebra algo importante, los comentarios menores se ignoran. */
  private priorityUntil = 0;

  constructor(events: EventBus<GameEvents>, options: MascotDirectorOptions) {
    this.options = { idleMs: 45_000, random: Math.random, ...options };
    this.state = { mood: 'idle', message: '', id: 0 };

    this.unsubscribers.push(
      events.on('missionStarted', ({ location, resumed }) => {
        if (resumed) return;
        const key = location.mission.boss ? 'bossStarted' : 'missionStarted';
        this.say(location.mission.boss ? 'worried' : 'talking', key, { title: location.mission.title });
      }),
      events.on('missionCompleted', ({ stars }) => {
        this.errorStreak = 0;
        this.say('happy', stars === 3 && this.options.random() < 0.5 ? 'perfectMission' : 'missionCompleted', {}, 4000);
      }),
      events.on('chapterCompleted', () => this.say('excited', 'chapterCompleted', {}, 5000)),
      events.on('levelUp', ({ level, rank, rankChanged }) => {
        this.say('excited', rankChanged ? 'rankUp' : 'levelUp', { level: String(level), rank }, 6000);
      }),
      events.on('commandsUnlocked', ({ commands }) => this.say('talking', 'commandsUnlocked', { commands: commands.join(', ') })),
      events.on('hintRevealed', () => this.say('thinking', 'hintRevealed')),
      events.on('missionRestarted', () => this.say('talking', 'missionRestarted')),
      events.on('hintRejected', ({ reason }) => {
        if (reason === 'no-points') this.say('worried', 'noPoints');
      }),
      events.on('allMissionsCompleted', () => this.say('excited', 'allCompleted', {}, 8000)),
      events.on('commandExecuted', ({ report, success }) => this.onCommand(report.exitCode, success)),
    );
    this.resetIdleTimer();
  }

  getState = (): MascotState => this.state;

  subscribe = (listener: (state: MascotState) => void): Unsubscribe => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Saludo inicial (nuevo jugador o regreso). */
  greet(isNewPlayer: boolean): void {
    this.say('talking', isNewPlayer ? 'welcomeNew' : 'welcomeBack', {}, 3000);
  }

  dispose(): void {
    this.unsubscribers.forEach((u) => u());
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.calmTimer) clearTimeout(this.calmTimer);
    this.listeners.clear();
  }

  private onCommand(exitCode: number, success: boolean): void {
    this.resetIdleTimer();
    if (success) {
      this.errorStreak = 0;
      if (this.options.random() < SUCCESS_COMMENT_CHANCE) this.say('happy', 'commandSuccess', {}, 0, true);
      return;
    }
    this.errorStreak++;
    if (exitCode === 126) this.say('thinking', 'locked', {}, 0, true);
    else if (this.errorStreak >= ERROR_STREAK) {
      this.errorStreak = 0;
      this.say('worried', 'errorStreak');
    } else this.say('worried', 'commandError', {}, 0, true);
  }

  /**
   * Cambia de estado y elige una frase al azar del grupo.
   * @param priorityMs tiempo durante el que esta frase no puede ser pisada por comentarios menores.
   * @param minor si es un comentario menor (se descarta durante una prioridad).
   */
  private say(mood: MascotMood, key: DialogueKey, vars: Record<string, string> = {}, priorityMs = 0, minor = false): void {
    const now = Date.now();
    if (minor && now < this.priorityUntil) return;
    if (priorityMs) this.priorityUntil = now + priorityMs;

    const pool = DIALOGUES[key];
    const template = pool[Math.floor(this.options.random() * pool.length)];
    const message = Object.entries({ name: this.options.displayName, ...vars })
      .reduce((text, [k, v]) => text.replaceAll(`{${k}}`, v), template as string);

    this.state = { mood, message, id: this.nextId++ };
    this.listeners.forEach((l) => l(this.state));

    // Tras un rato vuelve a la calma (manteniendo el último mensaje visible).
    if (this.calmTimer) clearTimeout(this.calmTimer);
    this.calmTimer = setTimeout(() => {
      this.state = { ...this.state, mood: 'idle' };
      this.listeners.forEach((l) => l(this.state));
    }, Math.max(4000, priorityMs));
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.say('thinking', 'idle', {}, 0, true);
      this.resetIdleTimer();
    }, this.options.idleMs);
  }
}
