/**
 * help — lista los comandos que el usuario tiene disponibles, por categoría.
 * Solo muestra los desbloqueados: los demás siguen siendo un misterio.
 */
import type { Command, CommandCategory } from '../Command';
import { ansi, colorize } from '../helpers';

const CATEGORY_TITLES: Record<CommandCategory, string> = {
  juego: 'Juego',
  navegacion: 'Navegación',
  archivos: 'Archivos y directorios',
  lectura: 'Lectura de archivos',
  texto: 'Procesamiento de texto',
  sistema: 'Sistema y shell',
  usuarios: 'Usuarios y grupos',
  permisos: 'Permisos',
  procesos: 'Procesos',
  red: 'Redes',
  paquetes: 'Paquetes',
  servicios: 'Servicios y tareas',
  discos: 'Discos y almacenamiento',
  seguridad: 'Seguridad',
  devops: 'Herramientas DevOps',
};

export const helpCommand: Command = {
  name: 'help',
  aliases: ['ayuda'],
  category: 'juego',
  summary: 'Lista los comandos desbloqueados',
  builtin: true,
  execute(ctx) {
    const available = ctx.commands.available();
    const width = Math.max(...available.map((c) => c.name.length)) + 2;

    ctx.stdout.write(colorize(ctx, ansi.green, 'Comandos disponibles') + '\n');
    for (const category of Object.keys(CATEGORY_TITLES) as CommandCategory[]) {
      const group = available.filter((c) => c.category === category);
      if (group.length === 0) continue;
      ctx.stdout.write('\n' + colorize(ctx, ansi.cyan, `  ${CATEGORY_TITLES[category]}`) + '\n');
      for (const command of group) {
        ctx.stdout.write(`    ${command.name.padEnd(width)}${command.summary}\n`);
      }
    }
    ctx.stdout.write('\nUsa `man <comando>` para ver la explicación completa.\n');
    return 0;
  },
};
