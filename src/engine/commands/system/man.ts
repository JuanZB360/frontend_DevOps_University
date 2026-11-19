/**
 * man — muestra el manual de un comando.
 *
 * El contenido de los manuales NO vive en el motor: se inyecta un
 * `ManualProvider` (Inversión de Dependencias). Así el juego decide qué
 * manuales están desbloqueados y en qué idioma se muestran.
 */
import type { Command } from '../Command';
import { EXIT_USAGE } from '../helpers';

export type ManualLookup =
  | { status: 'ok'; text: string }
  | { status: 'locked' }
  | { status: 'missing' };

export interface ManualProvider {
  /** Devuelve la página del manual ya formateada para la terminal. */
  lookup(name: string, useColor: boolean): ManualLookup;
}

export function createManCommand(provider: ManualProvider): Command {
  return {
    name: 'man',
    category: 'sistema',
    summary: 'Muestra el manual de un comando',
    execute(ctx) {
      const [name] = ctx.args;
      if (!name) {
        ctx.stderr.write('What manual page do you want?\nFor example, try \'man man\'.\n');
        return 1;
      }
      const page = provider.lookup(name, ctx.stdout.isTTY);
      if (page.status === 'ok') {
        ctx.stdout.write(page.text.endsWith('\n') ? page.text : page.text + '\n');
        return 0;
      }
      if (page.status === 'locked') {
        ctx.stderr.write(`man: 🔒 la entrada de '${name}' está ENCRIPTADA. Desbloquéala avanzando en las misiones.\n`);
        return EXIT_USAGE;
      }
      ctx.stderr.write(`No manual entry for ${name}\n`);
      return 16;
    },
  };
}
