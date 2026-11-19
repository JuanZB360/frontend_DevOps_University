/**
 * Documentación de un comando, en español y orientada a la práctica.
 * La misma fuente alimenta `man <cmd>` en la terminal y el manual lateral.
 */
export interface CommandDoc {
  name: string;
  /** Una línea: qué hace. */
  summary: string;
  /** Forma de uso, ej: "ls [OPCIÓN]... [RUTA]..." */
  synopsis: string;
  /** Explicación en uno o varios párrafos. */
  description: readonly string[];
  options?: readonly { flag: string; description: string }[];
  examples: readonly { command: string; explanation: string }[];
  /** Consejo de "sysadmin veterano". */
  tip?: string;
}
