/**
 * Motor de sonido sintetizado con la Web Audio API.
 *
 * Todos los sonidos se generan con osciladores y ruido: no hay archivos de
 * audio (cero descargas y cero problemas de licencias). Cada sonido es una
 * pequeña "receta" en `RECIPES`; añadir uno nuevo es añadir una entrada.
 *
 * Los navegadores no permiten reproducir audio hasta que el usuario
 * interactúa con la página: el contexto se crea/reanuda en el primer sonido
 * disparado por un clic o una tecla.
 */

export type SoundName =
  | 'key' | 'enter' | 'tick' | 'error' | 'success' | 'levelUp'
  | 'unlock' | 'hint' | 'boot' | 'denied';

export interface AudioSettings {
  muted: boolean;
  /** Volumen general de 0 a 1. */
  volume: number;
  /** Música ambiente (zumbido de servidor + bips de datos). */
  ambient: boolean;
}

const STORAGE_KEY = 'devops-university:audio';
const DEFAULTS: AudioSettings = { muted: false, volume: 0.5, ambient: false };

/** Frecuencias de notas usadas en las melodías (Hz). */
const NOTE = { C4: 261.63, E4: 329.63, G4: 392, A4: 440, C5: 523.25, E5: 659.25, G5: 783.99, C6: 1046.5 } as const;

type Recipe = (engine: SoundEngine, at: number) => void;

/** Recetas de cada sonido. `at` es el instante de inicio en el reloj del contexto. */
const RECIPES: Record<SoundName, Recipe> = {
  // Clic mecánico: ráfaga de ruido filtrada con tono ligeramente aleatorio.
  key: (e, at) => e.noise(at, 0.03, 1800 + Math.random() * 1400, 0.22),
  // Enter: golpe más grave y largo.
  enter: (e, at) => {
    e.noise(at, 0.05, 900, 0.3);
    e.tone(at, 140, 0.06, 'square', 0.06);
  },
  // Tic del texto que se escribe solo (briefings): muy suave.
  tick: (e, at) => e.tone(at, 2200 + Math.random() * 600, 0.012, 'square', 0.025),
  // Error: dos tonos descendentes ásperos.
  error: (e, at) => {
    e.tone(at, 220, 0.09, 'sawtooth', 0.09);
    e.tone(at + 0.1, 150, 0.14, 'sawtooth', 0.09);
  },
  // Comando bloqueado: zumbido corto tipo "acceso denegado".
  denied: (e, at) => e.tone(at, 110, 0.22, 'square', 0.07, 90),
  // Misión completada: arpegio ascendente.
  success: (e, at) => {
    [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6].forEach((f, i) => e.tone(at + i * 0.08, f, 0.16, 'triangle', 0.12));
  },
  // Subida de nivel: arpegio largo + brillo final.
  levelUp: (e, at) => {
    [NOTE.C4, NOTE.E4, NOTE.G4, NOTE.C5, NOTE.E5, NOTE.G5].forEach((f, i) => e.tone(at + i * 0.07, f, 0.2, 'square', 0.06));
    e.tone(at + 0.45, NOTE.C6, 0.6, 'triangle', 0.1);
    e.tone(at + 0.45, NOTE.C6 * 1.5, 0.6, 'sine', 0.05);
  },
  // Comando desbloqueado: dos bips agudos.
  unlock: (e, at) => {
    e.tone(at, NOTE.A4 * 2, 0.06, 'square', 0.06);
    e.tone(at + 0.08, NOTE.E5 * 2, 0.1, 'square', 0.06);
  },
  // Pista: campanita suave.
  hint: (e, at) => {
    e.tone(at, NOTE.E5, 0.4, 'sine', 0.12);
    e.tone(at + 0.12, NOTE.A4 * 2, 0.5, 'sine', 0.08);
  },
  // Arranque del sistema: barrido ascendente + clics de "disco".
  boot: (e, at) => {
    e.tone(at, 80, 0.7, 'sawtooth', 0.05, 900);
    for (let i = 0; i < 6; i++) e.noise(at + 0.1 + i * 0.09, 0.02, 3000, 0.15);
    e.tone(at + 0.75, NOTE.C5, 0.25, 'triangle', 0.1);
  },
};

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private ambientNodes: { stop: () => void } | null = null;
  private settings: AudioSettings;
  private readonly listeners = new Set<() => void>();

  constructor() {
    this.settings = loadSettings();
  }

  // ───────────────────────── Ajustes (para React) ─────────────────────────

  getSettings = (): AudioSettings => this.settings;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  update(patch: Partial<AudioSettings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.effectiveVolume(), this.ctx.currentTime, 0.02);
    this.syncAmbient();
    this.listeners.forEach((l) => l());
  }

  // ─────────────────────────────── Reproducción ───────────────────────────────

  play(name: SoundName): void {
    if (this.settings.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    RECIPES[name](this, ctx.currentTime + 0.005);
  }

  /** Llamar tras una interacción del usuario para habilitar el audio (y la música si está activa). */
  unlock(): void {
    this.ensureContext();
    this.syncAmbient();
  }

  /**
   * Oscilador con envolvente de ataque/caída rápida.
   * @param slideTo si se indica, la frecuencia se desliza hasta este valor.
   */
  tone(at: number, freq: number, duration: number, type: OscillatorType, gain: number, slideTo?: number): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, at + duration);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(gain, at + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(env).connect(master);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }

  /** Ráfaga de ruido blanco filtrada (clics, golpes). */
  noise(at: number, duration: number, filterFreq: number, gain: number): void {
    const { ctx, master, noiseBuffer } = this;
    if (!ctx || !master || !noiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq;
    filter.Q.value = 1.2;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, at);
    env.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    src.connect(filter).connect(env).connect(master);
    src.start(at, Math.random() * 0.5);
    src.stop(at + duration + 0.01);
  }

  // ─────────────────────────────── Internos ───────────────────────────────

  private effectiveVolume(): number {
    return this.settings.muted ? 0 : this.settings.volume;
  }

  private ensureContext(): AudioContext | null {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return null;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.effectiveVolume();
        this.master.connect(this.ctx.destination);
        this.noiseBuffer = createNoiseBuffer(this.ctx);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    } catch {
      return null; // Audio no disponible: el juego sigue funcionando en silencio.
    }
  }

  /** Arranca o detiene la música ambiente según los ajustes. */
  private syncAmbient(): void {
    const shouldPlay = this.settings.ambient && !this.settings.muted && this.ctx !== null;
    if (shouldPlay && !this.ambientNodes) this.ambientNodes = this.startAmbient();
    if (!shouldPlay && this.ambientNodes) {
      this.ambientNodes.stop();
      this.ambientNodes = null;
    }
  }

  /**
   * Ambiente de "sala de servidores": dos osciladores graves ligeramente
   * desafinados (batido lento) + bips de datos aleatorios en escala pentatónica.
   */
  private startAmbient(): { stop: () => void } {
    const ctx = this.ctx!;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0, ctx.currentTime);
    bus.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 2);
    bus.connect(this.master!);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    filter.connect(bus);

    const drones = [55, 55.4, 110.3].map((freq) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.connect(filter);
      osc.start();
      return osc;
    });

    // Bips de datos: cada 0.4-1.6 s, una nota de la escala pentatónica.
    const scale = [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.A4 * 2, NOTE.C6];
    let timer: ReturnType<typeof setTimeout>;
    const blip = (): void => {
      if (Math.random() < 0.7) this.tone(ctx.currentTime, scale[Math.floor(Math.random() * scale.length)], 0.08, 'sine', 0.025);
      timer = setTimeout(blip, 400 + Math.random() * 1200);
    };
    blip();

    return {
      stop: () => {
        clearTimeout(timer);
        bus.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
        setTimeout(() => {
          drones.forEach((d) => d.stop());
          bus.disconnect();
        }, 1500);
      },
    };
  }
}

function createNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function loadSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AudioSettings>) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(settings: AudioSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* almacenamiento no disponible */
  }
}

/** Instancia única para toda la app. */
export const sounds = new SoundEngine();
