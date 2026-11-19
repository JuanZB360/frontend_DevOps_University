/**
 * Lógica compartida por `cp` y `mv`: ambos aceptan
 *   cmd ORIGEN DESTINO
 *   cmd ORIGEN... DIRECTORIO
 * y deciden la ruta final igual. Extraerlo evita duplicar reglas (DRY).
 */
import { basename, joinPath } from '../../vfs/path';
import type { CommandContext } from '../Command';
import { EXIT_USAGE, fail } from '../helpers';

export interface TransferPlan {
  /** Pares origen → destino final, con las rutas tal como se mostrarán. */
  moves: { src: string; srcAbs: string; dest: string; destAbs: string }[];
}

/**
 * Calcula los destinos finales. Si el último operando es un directorio
 * existente, cada origen va DENTRO de él.
 * @returns el plan o un código de error ya reportado.
 */
export function planTransfer(ctx: CommandContext, operands: readonly string[]): TransferPlan | number {
  if (operands.length === 0) return fail(ctx, 'missing file operand', EXIT_USAGE);
  if (operands.length === 1) return fail(ctx, `missing destination file operand after '${operands[0]}'`, EXIT_USAGE);

  const sources = operands.slice(0, -1);
  const target = operands.at(-1)!;
  const targetAbs = ctx.resolve(target);
  const targetIsDir = ctx.fs.isDirectory(targetAbs);

  if (sources.length > 1 && !targetIsDir) return fail(ctx, `target '${target}' is not a directory`);

  return {
    moves: sources.map((src) => {
      const srcAbs = ctx.resolve(src);
      if (!targetIsDir) return { src, srcAbs, dest: target, destAbs: targetAbs };
      const name = basename(srcAbs);
      const dest = target.endsWith('/') ? target + name : `${target}/${name}`;
      return { src, srcAbs, dest, destAbs: joinPath(targetAbs, name) };
    }),
  };
}
