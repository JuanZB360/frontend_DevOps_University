/**
 * Bus de eventos tipado (patrón Observer).
 *
 * Permite que la lógica del juego anuncie lo que ocurre ("misión completada",
 * "subiste de nivel") sin saber quién escucha: la terminal, la mascota, la
 * interfaz o, en el futuro, la sincronización con el backend.
 */
export type Unsubscribe = () => void;

export class EventBus<Events extends object> {
  private readonly handlers = new Map<keyof Events, Set<(payload: never) => void>>();

  /** Se suscribe a un evento. Devuelve la función para cancelar la suscripción. */
  on<K extends keyof Events>(type: K, handler: (payload: Events[K]) => void): Unsubscribe {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as (payload: never) => void);
    return () => set.delete(handler as (payload: never) => void);
  }

  /** Notifica a todos los suscriptores. Un suscriptor que falla no afecta a los demás. */
  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    for (const handler of this.handlers.get(type) ?? []) {
      try {
        (handler as (p: Events[K]) => void)(payload);
      } catch (error) {
        console.error(`[EventBus] Error en el manejador de "${String(type)}":`, error);
      }
    }
  }
}
