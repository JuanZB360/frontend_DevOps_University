/**
 * Contrato que cumple cada comando del sistema simulado.
 *
 * Diseño:
 *  - Un comando = un archivo = una responsabilidad (SRP).
 *  - Añadir un comando nuevo NO requiere modificar el shell: solo registrarlo
 *    (Open/Closed).
 *  - El comando recibe todo lo que necesita por el contexto (Inversión de
 *    Dependencias), lo que permite testearlo con un VFS en memoria.
 */
import type { CommandHistory } from '../system/CommandHistory';
import type { ShellSession } from '../system/ShellSession';
import type { InputSource, OutputStream } from '../shell/streams';
import type { VirtualFileSystem } from '../vfs/VirtualFileSystem';

/** Categorías para agrupar comandos en `help` y en el manual lateral. */
export type CommandCategory =
  | 'navegacion'
  | 'archivos'
  | 'lectura'
  | 'texto'
  | 'sistema'
  | 'usuarios'
  | 'permisos'
  | 'procesos'
  | 'red'
  | 'paquetes'
  | 'servicios'
  | 'discos'
  | 'seguridad'
  | 'devops'
  | 'juego';

/** Acciones sobre la pantalla que un comando puede solicitar (ej. `clear`). */
export interface TerminalControl {
  clear(): void;
  /** Ancho actual de la terminal en columnas. */
  columns(): number;
  /**
   * Pide una línea al usuario (contraseñas, confirmaciones).
   * @returns el texto, o null si cancela (Ctrl+C) o no hay teclado.
   */
  readLine?(prompt: string, options?: { secret?: boolean }): Promise<string | null>;
  /**
   * Abre el editor a pantalla completa (nano).
   * @returns el contenido guardado, o null si se salió sin guardar.
   */
  edit?(filename: string, content: string): Promise<string | null>;
}

/** Vista de solo lectura de los comandos disponibles para el usuario. */
export interface CommandLookup {
  get(name: string): Command | undefined;
  /** Comandos que el usuario puede ejecutar ahora mismo. */
  available(): Command[];
}

/** Entrada/salida para lanzar otro comando desde un comando (xargs, sudo, find -exec...). */
export interface SpawnIO {
  stdin?: string | null;
  stdout?: OutputStream;
  stderr?: OutputStream;
}

export interface ScriptOptions {
  /** Nombre del script ($0). */
  name?: string;
  /** Argumentos posicionales ($1, $2...). */
  args?: readonly string[];
  /** true = proceso nuevo (bash script.sh): no altera variables ni directorio del padre. */
  newProcess?: boolean;
  io?: SpawnIO;
}

/** Operaciones del intérprete que algunos comandos necesitan (builtins de bash). */
export interface ShellApi {
  /** Ejecuta otro comando (ya separado en argumentos). Devuelve su código de salida. */
  spawn(argv: readonly string[], io?: SpawnIO): Promise<number>;
  /** Ejecuta un texto como script de bash. */
  runScript(text: string, options?: ScriptOptions): Promise<number>;
  /** Argumentos posicionales actuales. */
  positional(): readonly string[];
  setPositional(args: readonly string[]): void;
  /** ¿Se está ejecutando dentro de un script o función (no en la línea interactiva)? */
  inScript(): boolean;
  inFunction(): boolean;
  /** Declara una variable local en la función actual. */
  declareLocal(name: string, value: string | undefined): void;
  /** Lanza una señal de control de flujo (break, continue, return, exit). */
  signal(kind: 'break' | 'continue' | 'return' | 'exit', value: number): never;
  /** Nombres de las funciones definidas. */
  functionNames(): string[];
  hasFunction(name: string): boolean;
}

/** Todo lo que un comando necesita para ejecutarse. */
export interface CommandContext {
  /** Nombre con el que se invocó (puede ser un alias). */
  readonly name: string;
  /** Argumentos ya expandidos (sin el nombre del comando). */
  readonly args: readonly string[];
  /** Entrada estándar: texto de una tubería o redirección, o null si viene del teclado. */
  readonly stdin: string | null;
  /** La misma entrada, leída línea a línea (para `read`). */
  readonly input: InputSource;
  /** El comando se lanzó en segundo plano (`comando &`). */
  readonly background: boolean;
  /** PID del proceso en segundo plano (para que el comando ajuste su duración). */
  readonly backgroundPid?: number;
  readonly shell: ShellApi;
  readonly stdout: OutputStream;
  readonly stderr: OutputStream;
  readonly fs: VirtualFileSystem;
  readonly session: ShellSession;
  readonly history: CommandHistory;
  readonly commands: CommandLookup;
  readonly terminal: TerminalControl;
  /** Convierte una ruta escrita por el usuario en absoluta respecto al cwd. */
  resolve(path: string): string;
}

export interface Command {
  /** Nombre principal (ej. 'ls'). */
  readonly name: string;
  /** Nombres alternativos (ej. 'mision' para 'mission'). */
  readonly aliases?: readonly string[];
  readonly category: CommandCategory;
  /** Descripción de una línea (para `help`). */
  readonly summary: string;
  /** Si es true, es un builtin del shell (no aparece en /usr/bin). */
  readonly builtin?: boolean;
  /** Paquete de apt que lo instala. Si no está instalado, el comando "no existe". */
  readonly package?: string;
  /** Ejecuta el comando y devuelve el código de salida (0 = éxito). */
  execute(ctx: CommandContext): Promise<number> | number;
}
