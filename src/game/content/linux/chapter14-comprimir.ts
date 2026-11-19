/**
 * Capítulo 14 — Comprimir y archivar.
 * tar, gzip/gunzip, zip/unzip y restaurar copias de seguridad.
 */
import { gzipContent } from '../../../engine/commands/files/archives';
import { installFiles } from '../../../engine/commands/packages/apt';
import { findPackage } from '../../../engine/system/packages';
import { rewardFor, type Chapter } from '../../domain/curriculum';
import { all, isFile, not, notExists, outputMatches, ran, systemFileMatches } from '../../missions/checks';
import { aptReady, plantFiles, withMachine } from '../../missions/worldHelpers';

const WEB = {
  '~/web/index.html': '<h1>Tienda</h1>\n',
  '~/web/css/estilo.css': 'body { font-family: sans-serif; }\n',
  '~/web/js/app.js': 'console.log("hola");\n',
};

/** Un .tar.gz de /etc/hosts tal como lo haría `tar -czf etc.tar.gz -C / etc/hosts`. */
function etcBackup(hosts: string): string {
  const entries = [
    { path: 'etc', type: 'dir', mode: 0o755, owner: 'root', group: 'root', mtime: 0 },
    { path: 'etc/hosts', type: 'file', content: hosts, mode: 0o644, owner: 'root', group: 'root', mtime: 0 },
    { path: 'etc/hostname', type: 'file', content: 'devops-u\n', mode: 0o644, owner: 'root', group: 'root', mtime: 0 },
  ];
  return gzipContent('TARSIM\n' + JSON.stringify(entries), 20_480).content;
}

export const chapter14: Chapter = {
  id: 'linux-14',
  number: 14,
  title: 'Comprimir y archivar',
  description: 'Empaquetar, comprimir y restaurar. La base de cualquier copia de seguridad.',
  missions: [
    {
      id: 'linux-14-01',
      title: 'Empaquetar',
      difficulty: 2,
      teaches: [],
      briefing: [
        '`tar` junta muchos archivos en uno solo (un "tarball"). Letras clave:',
        '  `c` crear   `x` extraer   `t` listar   `f` archivo (siempre la última, seguida del nombre)   `v` detalle',
        'Ejemplo: `tar -cvf web.tar web/` empaqueta el directorio web.',
      ],
      objective: 'Empaqueta el directorio ~/web en ~/web.tar (sin comprimir).',
      hints: ['tar con c (crear), v (ver) y f (archivo).', 'cd ~ && tar -cvf web.tar web', 'Escribe: cd ~ && tar -cvf web.tar web'],
      setup: (world) => plantFiles(world, WEB),
      solution: 'cd ~ && tar -cvf web.tar web',
      check: all(isFile('~/web.tar'), ran('tar')),
      success: 'Un único archivo con toda la web dentro.',
      reward: rewardFor(2),
    },
    {
      id: 'linux-14-02',
      title: 'Comprimir',
      difficulty: 2,
      teaches: [],
      briefing: [
        'Añadiendo `z`, tar comprime con gzip: archivos .tar.gz (o .tgz), mucho más pequeños.',
        'La receta que usarás mil veces: `tar -czvf copia.tar.gz directorio/`',
      ],
      objective: 'Crea ~/web.tar.gz con el directorio ~/web comprimido.',
      hints: ['La misma orden con la z de gzip.', 'cd ~ && tar -czvf web.tar.gz web', 'Escribe: cd ~ && tar -czvf web.tar.gz web'],
      setup: (world) => plantFiles(world, WEB),
      solution: 'cd ~ && tar -czvf web.tar.gz web',
      check: (ctx) => isFile('~/web.tar.gz')(ctx) && ctx.fs.readFile(`${ctx.session.home}/web.tar.gz`).startsWith('\x1f\x8b'),
      success: 'Comprimido. Compara tamaños con ls -lh.',
      reward: rewardFor(2),
    },
    {
      id: 'linux-14-03',
      title: 'Mirar sin abrir',
      difficulty: 2,
      teaches: [],
      briefing: [
        'Antes de extraer, mira qué contiene: `tar -tzvf copia.tar.gz` (t = listar).',
        'Evita sorpresas como un .tar que suelta mil archivos en tu directorio actual.',
      ],
      objective: 'Lista el contenido de ~/entregas/proyecto.tar.gz sin extraerlo.',
      hints: ['Usa la letra t en lugar de x.', 'tar -tzvf ~/entregas/proyecto.tar.gz', 'Escribe: tar -tzvf ~/entregas/proyecto.tar.gz'],
      setup: (world) => {
        const entries = [
          { path: 'proyecto', type: 'dir', mode: 0o755, owner: 'neo', group: 'neo', mtime: 0 },
          { path: 'proyecto/main.py', type: 'file', content: 'print("hola")\n', mode: 0o644, owner: 'neo', group: 'neo', mtime: 0 },
          { path: 'proyecto/requirements.txt', type: 'file', content: 'flask\n', mode: 0o644, owner: 'neo', group: 'neo', mtime: 0 },
        ];
        plantFiles(world, { '~/entregas/proyecto.tar.gz': gzipContent('TARSIM\n' + JSON.stringify(entries), 4096).content });
      },
      solution: 'tar -tzvf ~/entregas/proyecto.tar.gz',
      check: outputMatches('tar', /proyecto\/main\.py/),
      success: 'Sabes qué hay dentro sin desordenar nada.',
      reward: rewardFor(2),
    },
    {
      id: 'linux-14-04',
      title: 'Extraer donde quieras',
      difficulty: 3,
      teaches: [],
      briefing: [
        '`tar -xzvf copia.tar.gz` extrae en el directorio actual.',
        'Con `-C destino` extrae en otro sitio: `tar -xzvf copia.tar.gz -C /tmp/prueba`',
      ],
      objective: 'Extrae ~/entregas/proyecto.tar.gz dentro de ~/revision.',
      hints: ['Crea el destino y usa -C.', 'mkdir -p ~/revision && tar -xzvf ~/entregas/proyecto.tar.gz -C ~/revision', 'Escribe: mkdir -p ~/revision && tar -xzvf ~/entregas/proyecto.tar.gz -C ~/revision'],
      setup: (world) => {
        const entries = [
          { path: 'proyecto', type: 'dir', mode: 0o755, owner: 'neo', group: 'neo', mtime: 0 },
          { path: 'proyecto/main.py', type: 'file', content: 'print("hola")\n', mode: 0o644, owner: 'neo', group: 'neo', mtime: 0 },
        ];
        plantFiles(world, { '~/entregas/proyecto.tar.gz': gzipContent('TARSIM\n' + JSON.stringify(entries), 4096).content });
      },
      solution: 'mkdir -p ~/revision && tar -xzvf ~/entregas/proyecto.tar.gz -C ~/revision',
      check: isFile('~/revision/proyecto/main.py'),
      success: 'Extraído justo donde querías.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-14-05',
      title: 'Comprimir un archivo suelto',
      difficulty: 2,
      teaches: ['gzip', 'gunzip', 'zcat'],
      briefing: [
        '`gzip archivo` lo comprime y lo SUSTITUYE por archivo.gz. `gunzip archivo.gz` lo devuelve.',
        '`zcat archivo.gz` muestra su contenido sin descomprimirlo (zgrep busca dentro).',
        'Así guarda Linux los logs viejos: syslog.2.gz, syslog.3.gz...',
      ],
      objective: 'Comprime ~/logs/antiguo.log con gzip.',
      hints: ['gzip seguido del archivo.', 'gzip ~/logs/antiguo.log', 'Escribe: gzip ~/logs/antiguo.log'],
      setup: (world) => plantFiles(world, { '~/logs/antiguo.log': 'Nov 01 evento 1\nNov 01 evento 2\n' }),
      solution: 'gzip ~/logs/antiguo.log',
      check: all(isFile('~/logs/antiguo.log.gz'), notExists('~/logs/antiguo.log')),
      success: 'antiguo.log.gz: el original desaparece y queda la versión comprimida.',
      reward: rewardFor(2),
    },
    {
      id: 'linux-14-06',
      title: 'El formato universal',
      difficulty: 3,
      teaches: ['zip', 'unzip'],
      briefing: [
        'Para compartir con usuarios de Windows se usa .zip: `zip -r informes.zip informes/`',
        'Y para abrirlos: `unzip archivo.zip` (o `unzip -l` para listar).',
        'Puede que no estén instalados: apt al rescate.',
      ],
      objective: 'Crea ~/informes.zip con el directorio ~/informes (recursivo).',
      hints: ['zip con la opción -r para directorios. Si no existe, instálalo.', 'sudo apt install -y zip && cd ~ && zip -r informes.zip informes', 'Escribe: sudo apt install -y zip && cd ~ && zip -r informes.zip informes'],
      setup: (world) => {
        aptReady(world);
        plantFiles(world, { '~/informes/ventas.csv': 'mes,total\nnov,1200\n', '~/informes/resumen.txt': 'Todo bien\n' });
      },
      solution: 'sudo apt install -y zip && cd ~ && zip -r informes.zip informes',
      check: (ctx) => isFile('~/informes.zip')(ctx) && ctx.fs.readFile(`${ctx.session.home}/informes.zip`).startsWith('PKSIM'),
      success: 'Listo para enviar por correo a cualquiera.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-14-07',
      title: 'JEFE: Restauración de emergencia',
      difficulty: 5,
      boss: true,
      teaches: [],
      briefing: [
        '⚠ Alguien ha destrozado /etc/hosts y el servidor ya no se reconoce a sí mismo.',
        'Por suerte hay copia de seguridad de anoche: /backup/etc.tar.gz',
        'Restaura SOLO etc/hosts desde la copia a su lugar original (/), sin tocar nada más.',
        'Pista de N0X: lista primero el contenido (t) para ver la ruta exacta, y extrae indicando ese miembro.',
      ],
      objective: 'Restaura /etc/hosts desde /backup/etc.tar.gz.',
      hints: [
        'Lista con tar -tzf para ver el nombre interno (etc/hosts, sin / inicial).',
        'Extrae en / (-C /) solo el miembro etc/hosts. Necesitas sudo.',
        'Escribe: sudo tar -xzf /backup/etc.tar.gz -C / etc/hosts',
      ],
      setup: (world) => {
        const good = `127.0.0.1\tlocalhost\n127.0.1.1\t${world.session.hostname}\n`;
        plantFiles(world, { '/backup/etc.tar.gz': etcBackup(good) });
        world.fs.privileged(() => world.fs.writeFile('/etc/hosts', '### CORRUPTO ### 0xDEADBEEF\n'));
        withMachine(world, (m) => {
          if (m.packages.zip?.status !== 'installed') installFiles(world.fs, m, findPackage('zip')!);
        });
      },
      solution: 'sudo tar -xzf /backup/etc.tar.gz -C / etc/hosts',
      check: all(systemFileMatches('/etc/hosts', /localhost/), not(systemFileMatches('/etc/hosts', /CORRUPTO/)), ran('tar')),
      success: 'Restaurado en segundos. Una copia que no sabes restaurar no es una copia: acabas de demostrar que sabes.',
      reward: rewardFor(5, true),
    },
  ],
};

