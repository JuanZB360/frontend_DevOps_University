/**
 * Capítulo 12 — Variables y entorno.
 * Variables, export, PATH, alias, .bashrc y source.
 */
import { rewardFor, type Chapter, type MissionWorld } from '../../domain/curriculum';
import { all, fileContains, ran } from '../../missions/checks';
import { plantFiles } from '../../missions/worldHelpers';

function executable(world: MissionWorld, path: string, content: string): void {
  plantFiles(world, { [path]: content });
  const abs = path.startsWith('~/') ? world.session.home + path.slice(1) : path;
  world.fs.privileged(() => world.fs.chmod(abs, 0o755));
}

export const chapter12: Chapter = {
  id: 'linux-12',
  number: 12,
  title: 'Variables y entorno',
  description: 'Configura tu shell como un profesional: variables, PATH, alias y .bashrc.',
  missions: [
    {
      id: 'linux-12-01',
      title: 'El entorno',
      difficulty: 1,
      teaches: ['env', 'printenv'],
      briefing: [
        'El shell guarda datos en VARIABLES. Algunas ya existen: $HOME, $USER, $PATH, $SHELL...',
        '`echo $HOME` muestra una; `printenv` (o `env`) las muestra todas.',
      ],
      objective: 'Muestra todas las variables de entorno.',
      hints: ['"Imprimir entorno" en inglés, junto.', 'printenv', 'Escribe: printenv'],
      solution: 'printenv',
      check: ran('printenv'),
      success: 'Cada programa que lanzas recibe estas variables.',
      reward: rewardFor(1),
    },
    {
      id: 'linux-12-02',
      title: 'Tu primera variable',
      difficulty: 2,
      teaches: ['export', 'unset'],
      briefing: [
        'Se crean así, SIN espacios alrededor del =: `PROYECTO=tienda`',
        'Se usan con $: `echo "Trabajando en $PROYECTO"`',
        'Una variable normal solo existe en tu shell. `export PROYECTO` la pasa a los programas que lances.',
      ],
      objective: 'Crea la variable PROYECTO con el valor tienda y expórtala.',
      hints: ['Puedes crearla y exportarla en un paso.', 'export PROYECTO=tienda', 'Escribe: export PROYECTO=tienda'],
      solution: 'export PROYECTO=tienda',
      check: (ctx) => ctx.session.getVar('PROYECTO') === 'tienda' && ctx.session.isExported('PROYECTO'),
      success: 'Compruébalo: printenv PROYECTO. Las apps leen así su configuración (variables de entorno).',
      reward: rewardFor(2),
    },
    {
      id: 'linux-12-03',
      title: 'El PATH',
      difficulty: 3,
      teaches: [],
      briefing: [
        'Cuando escribes `ls`, bash busca un programa llamado ls en los directorios de $PATH (separados por :).',
        'Tienes un script en ~/bin/saludo, pero `saludo` da "command not found": ~/bin no está en el PATH.',
        'Se añade así: `export PATH="$PATH:$HOME/bin"`',
      ],
      objective: 'Añade ~/bin al PATH y ejecuta el comando saludo.',
      hints: ['Añade $HOME/bin al final del PATH con export.', 'export PATH="$PATH:$HOME/bin" && saludo', 'Escribe: export PATH="$PATH:$HOME/bin" && saludo'],
      setup: (world) => executable(world, '~/bin/saludo', '#!/bin/bash\necho "Hola desde mi propio comando"\n'),
      solution: 'export PATH="$PATH:$HOME/bin" && saludo',
      check: (ctx) => ctx.report.commands.some((c) => c.name === 'saludo' && c.exitCode === 0),
      success: 'Ya tienes tus propios comandos. Así funcionan todas las herramientas que instales.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-12-04',
      title: 'Atajos',
      difficulty: 2,
      teaches: ['alias', 'unalias'],
      briefing: [
        'Un alias es un atajo: `alias ll="ls -alF"`.',
        '`alias` sin argumentos lista los que tienes; `unalias nombre` elimina uno.',
      ],
      objective: 'Crea el alias actualizar que ejecute: sudo apt update && sudo apt upgrade -y',
      hints: ['alias nombre="comando" (comillas imprescindibles por los espacios).', "alias actualizar='sudo apt update && sudo apt upgrade -y'", "Escribe: alias actualizar='sudo apt update && sudo apt upgrade -y'"],
      solution: "alias actualizar='sudo apt update && sudo apt upgrade -y'",
      check: (ctx) => /apt update/.test(ctx.session.getAlias('actualizar') ?? '') && /upgrade/.test(ctx.session.getAlias('actualizar') ?? ''),
      success: 'Ahora "actualizar" hace las dos cosas. Pero cuidado: al cerrar sesión se pierde...',
      reward: rewardFor(2),
    },
    {
      id: 'linux-12-05',
      title: 'Que sea permanente',
      difficulty: 3,
      teaches: ['source', 'nano'],
      briefing: [
        'Las variables y alias desaparecen al cerrar la sesión.',
        'Para que sean permanentes se escriben en ~/.bashrc, que bash ejecuta al abrir cada terminal.',
        'Edítalo con `nano ~/.bashrc` (^O guarda, ^X sale) o añade líneas con `echo "..." >> ~/.bashrc`.',
        'Para aplicar los cambios sin reabrir la terminal: `source ~/.bashrc`.',
      ],
      objective: "Añade a ~/.bashrc el alias logs='sudo tail -n 20 /var/log/syslog' y aplícalo con source.",
      hints: ['Añade la línea con echo y >> (o con nano), luego source.', "echo \"alias logs='sudo tail -n 20 /var/log/syslog'\" >> ~/.bashrc && source ~/.bashrc", "Escribe: echo \"alias logs='sudo tail -n 20 /var/log/syslog'\" >> ~/.bashrc && source ~/.bashrc"],
      solution: "echo \"alias logs='sudo tail -n 20 /var/log/syslog'\" >> ~/.bashrc && source ~/.bashrc",
      check: all(fileContains('~/.bashrc', /alias logs=/), (ctx) => ctx.session.getAlias('logs')?.includes('syslog') ?? false),
      success: 'Permanente y aplicado. Tu .bashrc es tu "configuración personal" del servidor.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-12-06',
      title: 'JEFE: Entorno de trabajo personalizado',
      difficulty: 4,
      boss: true,
      teaches: [],
      briefing: [
        '⚠ Prepara tu entorno de trabajo definitivo. En ~/.bashrc deben quedar:',
        '  1) `export EDITOR=nano`',
        '  2) el directorio ~/scripts añadido al PATH',
        "  3) el alias `gs='git status'`",
        'Y deben estar activos en tu sesión actual (source).',
      ],
      objective: 'Configura EDITOR, PATH (~/scripts) y el alias gs en ~/.bashrc y aplícalo.',
      hints: [
        'Añade tres líneas a ~/.bashrc (con nano o echo >>) y después source ~/.bashrc.',
        "echo 'export EDITOR=nano' >> ~/.bashrc ; echo 'export PATH=\"$PATH:$HOME/scripts\"' >> ~/.bashrc ; ...",
        "Escribe: echo 'export EDITOR=nano' >> ~/.bashrc && echo 'export PATH=\"$PATH:$HOME/scripts\"' >> ~/.bashrc && echo \"alias gs='git status'\" >> ~/.bashrc && source ~/.bashrc",
      ],
      solution: "echo 'export EDITOR=nano' >> ~/.bashrc && echo 'export PATH=\"$PATH:$HOME/scripts\"' >> ~/.bashrc && echo \"alias gs='git status'\" >> ~/.bashrc && source ~/.bashrc",
      check: all(
        fileContains('~/.bashrc', /export EDITOR=nano/),
        fileContains('~/.bashrc', /PATH=.*scripts/),
        fileContains('~/.bashrc', /alias gs=/),
        (ctx) => ctx.session.getVar('EDITOR') === 'nano' && ctx.session.isExported('EDITOR'),
        (ctx) => (ctx.session.getVar('PATH') ?? '').split(':').includes(`${ctx.session.home}/scripts`),
        (ctx) => ctx.session.getAlias('gs') === 'git status',
      ),
      success: 'Entorno profesional listo. Cada vez que entres al servidor estará todo a mano.',
      reward: rewardFor(4, true),
    },
  ],
};
