/**
 * Capítulo 9 — Permisos.
 * rwx, chmod (octal y simbólico), chown, chgrp, umask y bits especiales.
 */
import { rewardFor, type Chapter } from '../../domain/curriculum';
import { all, inGroup, modeIs, ownedBy, ran } from '../../missions/checks';
import { ensureGroup, ensureUser, plantFiles, withMachine } from '../../missions/worldHelpers';
import type { MissionCheck, MissionWorld } from '../../domain/curriculum';

/** Planta un archivo/directorio con permisos concretos (como root si está fuera del home). */
function plantWithMode(world: MissionWorld, path: string, content: string | null, mode: number, owner?: string, group?: string): void {
  plantFiles(world, { [path + (content === null ? '/' : '')]: content ?? '' });
  const abs = path.startsWith('~/') ? world.session.home + path.slice(1) : path;
  world.fs.privileged(() => {
    world.fs.chmod(abs, mode);
    if (owner || group) world.fs.chown(abs, owner, group);
  });
}

/** Todo el árbol pertenece a este dueño:grupo. */
const treeOwnedBy = (path: string, owner: string, group: string): MissionCheck => (ctx) =>
  ctx.fs.privileged(() => {
    const walk = (p: string): boolean => {
      const node = ctx.fs.tryStat(p, false);
      if (!node || node.owner !== owner || node.group !== group) return false;
      return node.type !== 'dir' || Object.keys(node.children).every((c) => walk(`${p}/${c}`));
    };
    return walk(path);
  });

export const chapter09: Chapter = {
  id: 'linux-09',
  number: 9,
  title: 'Permisos',
  description: 'Quién puede leer, escribir o ejecutar cada archivo. La primera línea de defensa de Linux.',
  missions: [
    {
      id: 'linux-09-01',
      title: 'Ejecutable',
      difficulty: 2,
      teaches: ['chmod', 'stat'],
      briefing: [
        'En `ls -l` ves algo como -rw-r--r--: tres grupos de permisos rwx (lectura, escritura, ejecución)',
        'para el DUEÑO, el GRUPO y el RESTO, en ese orden.',
        'Un script no se puede ejecutar hasta que tenga el permiso x: `chmod +x script.sh`.',
        'Luego se ejecuta indicando su ruta: `./script.sh`.',
      ],
      objective: 'Haz ejecutable ~/scripts/hola.sh y ejecútalo.',
      hints: ['Añade el permiso de ejecución con chmod.', 'chmod +x ~/scripts/hola.sh y después ~/scripts/hola.sh', 'Escribe: chmod +x ~/scripts/hola.sh && ~/scripts/hola.sh'],
      setup: (world) => plantWithMode(world, '~/scripts/hola.sh', '#!/bin/bash\necho "¡Funciona! Soy un script ejecutable."\n', 0o644),
      solution: 'chmod +x ~/scripts/hola.sh && ~/scripts/hola.sh',
      check: (ctx) => ctx.report.commands.some((c) => c.name === 'echo' && c.stdout.includes('¡Funciona!')),
      success: 'Tu primer script ejecutado. Sin la x, Linux no deja ejecutar nada.',
      reward: rewardFor(2),
    },
    {
      id: 'linux-09-02',
      title: 'Solo para tus ojos',
      difficulty: 3,
      teaches: [],
      briefing: [
        'Los permisos también se escriben en octal: r=4, w=2, x=1, y se suman por grupo.',
        '  7 = rwx   6 = rw-   5 = r-x   4 = r--   0 = ---',
        '`chmod 600 archivo` → el dueño lee y escribe; nadie más puede ni mirarlo.',
        'Es lo obligatorio para claves privadas y archivos con contraseñas.',
      ],
      objective: 'Deja ~/claves/api.key legible y modificable SOLO por ti (600).',
      hints: ['Calcula: dueño rw (4+2), grupo nada, resto nada.', 'chmod 600 ~/claves/api.key', 'Escribe: chmod 600 ~/claves/api.key'],
      setup: (world) => plantWithMode(world, '~/claves/api.key', 'sk_live_51HxDevopsU\n', 0o644),
      solution: 'chmod 600 ~/claves/api.key',
      check: modeIs('~/claves/api.key', 0o600),
      success: '-rw------- : solo tú. SSH incluso se niega a usar una clave privada con permisos más abiertos.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-09-03',
      title: 'Quitar permisos',
      difficulty: 3,
      teaches: [],
      briefing: [
        'El modo simbólico cambia permisos concretos sin calcular números:',
        '  `u` dueño, `g` grupo, `o` otros, `a` todos   ·   `+` añadir, `-` quitar, `=` fijar',
        '`chmod go-w archivo` quita la escritura al grupo y a los demás.',
      ],
      objective: 'Alguien dejó ~/compartido.txt escribible por todo el mundo (666). Quita la escritura al grupo y a otros.',
      hints: ['Usa el modo simbólico: grupo (g) y otros (o), quitar (-) escritura (w).', 'chmod go-w ~/compartido.txt', 'Escribe: chmod go-w ~/compartido.txt'],
      setup: (world) => plantWithMode(world, '~/compartido.txt', 'Agenda del equipo\n', 0o666),
      solution: 'chmod go-w ~/compartido.txt',
      check: modeIs('~/compartido.txt', 0o644),
      success: 'Ahora todos pueden leerlo pero solo tú modificarlo (644).',
      reward: rewardFor(3),
    },
    {
      id: 'linux-09-04',
      title: 'Cambio de dueño',
      difficulty: 3,
      teaches: ['chown'],
      briefing: [
        'Nginx y muchos servidores web funcionan con el usuario www-data.',
        'Los archivos de la web deben pertenecerle: `sudo chown -R www-data:www-data /ruta`',
        '`-R` aplica el cambio a todo lo que hay dentro. Solo root puede regalar archivos.',
      ],
      objective: 'Haz que /srv/web y todo su contenido pertenezcan al usuario y grupo www-data.',
      hints: ['chown usuario:grupo, recursivo, con sudo.', 'sudo chown -R www-data:www-data /srv/web', 'Escribe: sudo chown -R www-data:www-data /srv/web'],
      setup: (world) => plantFiles(world, { '/srv/web/index.html': '<h1>Hola</h1>\n', '/srv/web/css/estilo.css': 'body{}\n' }),
      solution: 'sudo chown -R www-data:www-data /srv/web',
      check: treeOwnedBy('/srv/web', 'www-data', 'www-data'),
      success: 'La web pertenece a su servidor. Si no, nginx no podría leerla (403 Forbidden).',
      reward: rewardFor(3),
    },
    {
      id: 'linux-09-05',
      title: 'Carpeta del equipo',
      difficulty: 3,
      teaches: ['chgrp'],
      briefing: [
        '`chgrp grupo ruta` cambia solo el grupo (igual que chown :grupo).',
        'Para un proyecto de equipo: grupo devs y permisos 770 (dueño y grupo todo; el resto, nada).',
      ],
      objective: 'Haz que /srv/proyecto sea del grupo devs con permisos 770.',
      hints: ['Dos pasos: cambiar el grupo y fijar los permisos.', 'sudo chgrp devs /srv/proyecto && sudo chmod 770 /srv/proyecto', 'Escribe: sudo chgrp devs /srv/proyecto && sudo chmod 770 /srv/proyecto'],
      setup: (world) => {
        ensureGroup(world, 'devs');
        plantFiles(world, { '/srv/proyecto/': '' });
      },
      solution: 'sudo chgrp devs /srv/proyecto && sudo chmod 770 /srv/proyecto',
      check: all(ownedBy('/srv/proyecto', 'root', 'devs'), modeIs('/srv/proyecto', 0o770)),
      success: 'Solo el equipo devs puede entrar. El resto ve "Permission denied".',
      reward: rewardFor(3),
    },
    {
      id: 'linux-09-06',
      title: 'Permisos por defecto',
      difficulty: 4,
      teaches: ['umask'],
      briefing: [
        'Los archivos nuevos nacen con 666 y los directorios con 777, MENOS la umask.',
        'La umask típica es 022 → archivos 644 y directorios 755.',
        'Con `umask 027` los archivos nuevos quedan 640: el resto del mundo no puede ni leerlos.',
      ],
      objective: 'Cambia tu umask a 027 y crea el archivo ~/privado.txt (debe nacer con permisos 640).',
      hints: ['Primero cambia la umask y después crea el archivo con touch.', 'umask 027 && touch ~/privado.txt', 'Escribe: umask 027 && touch ~/privado.txt'],
      setup: (world) => {
        world.session.umask = 0o022;
        const abs = `${world.session.home}/privado.txt`;
        if (world.fs.exists(abs)) world.fs.remove(abs);
      },
      solution: 'umask 027 && touch ~/privado.txt',
      check: all(modeIs('~/privado.txt', 0o640), (ctx) => ctx.session.umask === 0o027),
      success: 'Nació con 640 sin tocar chmod. (Al cerrar la sesión vuelve a 022; para hacerla permanente se pone en ~/.bashrc.)',
      reward: rewardFor(4),
    },
    {
      id: 'linux-09-07',
      title: 'El bit pegajoso',
      difficulty: 4,
      teaches: [],
      briefing: [
        'Hay tres permisos especiales (el primer dígito de 4 cifras):',
        '  4 = SUID (se ejecuta como el dueño)   2 = SGID (lo nuevo hereda el grupo)   1 = sticky',
        'Sticky (como en /tmp: drwxrwxrwt): todos pueden escribir, pero cada uno solo borra lo SUYO.',
      ],
      objective: 'Haz /srv/subidas escribible por todos pero con sticky bit (1777).',
      hints: ['Cuatro cifras: el 1 inicial es el sticky bit.', 'sudo chmod 1777 /srv/subidas', 'Escribe: sudo chmod 1777 /srv/subidas'],
      setup: (world) => {
        // La umask no sobrevive al cierre de sesión: volvemos a la estándar.
        world.session.umask = 0o022;
        plantFiles(world, { '/srv/subidas/': '' });
      },
      solution: 'sudo chmod 1777 /srv/subidas',
      check: modeIs('/srv/subidas', 0o1777),
      success: 'drwxrwxrwt: un "tablón público" donde nadie puede borrar lo de los demás.',
      reward: rewardFor(4),
    },
    {
      id: 'linux-09-08',
      title: 'JEFE: Directorio compartido seguro',
      difficulty: 5,
      boss: true,
      teaches: [],
      briefing: [
        '⚠ El equipo necesita /srv/equipo con estas reglas:',
        '  1) dueño root y grupo devs',
        '  2) devs puede leer, escribir y entrar; el resto del mundo NADA',
        '  3) todo lo que se cree dentro debe pertenecer automáticamente al grupo devs (SGID)',
        '  4) luis y marta deben estar en devs',
        'Pista de N0X: SGID es el 2 del primer dígito → permisos 2770.',
      ],
      objective: 'Configura /srv/equipo: root:devs, permisos 2770, y luis y marta en el grupo devs.',
      hints: [
        'Crea el directorio, cambia el grupo, aplica 2770 y añade a los usuarios al grupo.',
        'sudo mkdir -p /srv/equipo && sudo chown root:devs /srv/equipo && sudo chmod 2770 /srv/equipo',
        'Escribe: sudo mkdir -p /srv/equipo && sudo chown root:devs /srv/equipo && sudo chmod 2770 /srv/equipo && sudo usermod -aG devs luis && sudo usermod -aG devs marta',
      ],
      setup: (world) => {
        ensureGroup(world, 'devs');
        ensureUser(world, 'luis');
        ensureUser(world, 'marta');
        withMachine(world, () => undefined);
      },
      solution: 'sudo mkdir -p /srv/equipo && sudo chown root:devs /srv/equipo && sudo chmod 2770 /srv/equipo && sudo usermod -aG devs luis && sudo usermod -aG devs marta',
      check: all(ownedBy('/srv/equipo', 'root', 'devs'), modeIs('/srv/equipo', 0o2770), inGroup('luis', 'devs'), inGroup('marta', 'devs'), ran('chmod')),
      success: 'drwxrws---: un espacio de equipo profesional. Esto es exactamente lo que se configura en empresas reales.',
      reward: rewardFor(5, true),
    },
  ],
};
