/**
 * Hooks que conectan React con el estado del juego (que vive fuera de React).
 * useSyncExternalStore garantiza lecturas consistentes y re-render solo al cambiar.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { MascotDirector, type MascotState } from '../../game/mascot/MascotDirector';
import type { GameSession } from '../../game/session/GameSession';
import type { PlayerView } from '../../game/session/PlayerView';
import type { SyncStatus } from '../../game/storage/RemoteSaveRepository';
import { sounds, type AudioSettings } from '../audio/SoundEngine';

export function usePlayerView(game: GameSession): PlayerView {
  return useSyncExternalStore(game.subscribe, game.view);
}

/**
 * Crea el director de N0X ligado a la sesión y devuelve su estado actual.
 * El director se crea y destruye dentro del efecto para no dejar
 * suscripciones colgadas (importante con StrictMode).
 */
export function useMascot(game: GameSession, displayName: string, isNewPlayer: boolean): MascotState {
  const [state, setState] = useState<MascotState>({ mood: 'idle', message: '', id: 0 });

  useEffect(() => {
    const director = new MascotDirector(game.events, { displayName });
    const unsubscribe = director.subscribe(setState);
    director.greet(isNewPlayer);
    return () => {
      unsubscribe();
      director.dispose();
    };
    // Solo se recrea al cambiar de partida.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game]);

  return state;
}

/** Fuente del estado de guardado en el servidor (la implementa RemoteSaveRepository). */
export interface SyncStatusSource {
  getStatus: () => SyncStatus;
  subscribe: (listener: () => void) => () => void;
}

/** Estado de la sincronización con el servidor (guardado, guardando, sin conexión…). */
export function useSyncStatus(source: SyncStatusSource): SyncStatus {
  return useSyncExternalStore(source.subscribe, source.getStatus);
}

/** Ajustes de audio (silencio, volumen, música) sincronizados con React. */
export function useAudioSettings(): AudioSettings {
  return useSyncExternalStore(sounds.subscribe, sounds.getSettings);
}
