/**
 * Utilidades compartidas por los comandos para no repetir código (DRY):
 * formateo de errores, parseo seguro de opciones y colores ANSI.
 */
import { isFsError } from '../vfs/errors';
import type { CommandContext } from './Command';
import { OptionError, parseOptions, type OptionSpec, type ParsedOptions } from './options';

/** Códigos ANSI usados por los comandos cuando escriben en pantalla. */
export const ansi = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  blue: '\x1b[1;34m',
  cyan: '\x1b[1;36m',
  green: '\x1b[1;32m',
  red: '\x1b[1;31m',
  yellow: '\x1b[1;33m',
  magenta: '\x1b[35m',
  dim: '\x1b[2m',
} as const;

/** Aplica un color solo si la salida es la pantalla (como --color=auto). */
export function colorize(ctx: CommandContext, color: string, text: string): string {
  return ctx.stdout.isTTY ? `${color}${text}${ansi.reset}` : text;
}

/** Escribe `comando: mensaje` en stderr y devuelve el código de salida. */
export function fail(ctx: CommandContext, message: string, exitCode = 1): number {
  ctx.stderr.write(`${ctx.name}: ${message}\n`);
  return exitCode;
}

/**
 * Convierte un error del VFS en el mensaje exacto de coreutils.
 * Ej: `cat: notas.txt: No such file or directory`
 * @param action prefijo opcional (ej. "cannot access", "cannot remove").
 */
export function reportFsError(ctx: CommandContext, error: unknown, shownPath: string, action?: string): number {
  if (!isFsError(error)) throw error;
  const subject = action ? `${action} '${shownPath}'` : shownPath;
  return fail(ctx, `${subject}: ${error.reason}`);
}

/**
 * Parsea opciones y, si son inválidas, imprime el error estándar de GNU.
 * @returns las opciones o null si hubo error (el comando debe devolver 2).
 */
export function parseOrFail(ctx: CommandContext, specs: readonly OptionSpec[]): ParsedOptions | null {
  try {
    return parseOptions(ctx.args, specs);
  } catch (error) {
    if (!(error instanceof OptionError)) throw error;
    ctx.stderr.write(`${ctx.name}: ${error.message}\nTry '${ctx.name} --help' for more information.\n`);
    return null;
  }
}

/** Código de salida para uso incorrecto del comando (convención de GNU). */
export const EXIT_USAGE = 2;

/** Asegura que un texto termina con salto de línea (salvo que esté vacío). */
export function ensureNewline(text: string): string {
  return text === '' || text.endsWith('\n') ? text : text + '\n';
}

/** Lee la entrada de un comando de texto: archivos indicados o stdin. */
export function readInputs(ctx: CommandContext, operands: readonly string[]): { name: string; content: string | null }[] {
  if (operands.length === 0) return [{ name: '-', content: ctx.stdin ?? '' }];
  return operands.map((name) => {
    if (name === '-') return { name, content: ctx.stdin ?? '' };
    try {
      return { name, content: ctx.fs.readFile(ctx.resolve(name)) };
    } catch (error) {
      reportFsError(ctx, error, name);
      return { name, content: null };
    }
  });
}
