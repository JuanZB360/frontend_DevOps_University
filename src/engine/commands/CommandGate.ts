/**
 * Puerta de acceso a los comandos.
 *
 * El motor no sabe nada del juego: solo pregunta "¿se puede usar este comando?".
 * El juego implementa esta interfaz para bloquear los comandos que aún no se
 * han desbloqueado. Fuera del juego (tests, modo sandbox) se usa `ALLOW_ALL`.
 */
export interface CommandGate {
  isAllowed(name: string): boolean;
}

export const ALLOW_ALL: CommandGate = { isAllowed: () => true };
