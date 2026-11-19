/**
 * Capítulo 15 — Discos y almacenamiento.
 * df, du, lsblk, particionar, formatear, montar y /etc/fstab.
 */
import { diskUsage } from '../../../engine/commands/disks/disks';
import { readMachine } from '../../../engine/system/machine';
import { rewardFor, type Chapter, type MissionCheck, type MissionWorld } from '../../domain/curriculum';
import { all, finalOutputMatches, isFile, machine, ran, systemFileMatches } from '../../missions/checks';
import { plantFiles, setSize, withMachine } from '../../missions/worldHelpers';

/** Porcentaje de uso de / tal como lo muestra df. */
function rootUsage(ctx: Parameters<MissionCheck>[0]): number {
  const root = diskUsage(ctx.fs, readMachine(ctx.fs)).find((d) => d.target === '/')!;
  return Math.ceil((root.used / root.size) * 100);
}

/** Deja sdb como recién comprada (sin particiones ni montajes). */
function freshDisk(world: MissionWorld): void {
  withMachine(world, (m) => {
    const disk = m.disks.find((d) => d.name === 'sdb');
    if (disk) disk.partitions = [];
    m.mounts = m.mounts.filter((x) => !x.device.startsWith('/dev/sdb'));
  });
}

/** sdb1 existe (opcionalmente formateada). */
function partitioned(world: MissionWorld, formatted: boolean): void {
  withMachine(world, (m) => {
    const disk = m.disks.find((d) => d.name === 'sdb')!;
    if (disk.partitions.length === 0) disk.partitions.push({ name: 'sdb1', sizeGB: 50, fstype: null, uuid: '3c1d6c55-9f0e-4a8b-b8e2-7d0c52f1a9e4' });
    if (formatted) disk.partitions[0].fstype ??= 'ext4';
  });
}

const BIG = 1024 ** 3;

export const chapter15: Chapter = {
  id: 'linux-15',
  number: 15,
  title: 'Discos y almacenamiento',
  description: 'Un disco lleno tumba cualquier servidor. Aprende a vigilarlo y a ampliar el espacio.',
  missions: [
    {
      id: 'linux-15-01',
      title: 'Espacio libre',
      difficulty: 1,
      teaches: ['df'],
      briefing: [
        '`df -h` (disk free) muestra cada sistema de archivos montado: tamaño, usado, libre y % de uso.',
        'La -h significa "human": 20G en lugar de 20971520.',
        'Lo primero que se mira cuando algo falla raro: un disco al 100 %.',
      ],
      objective: 'Muestra el espacio libre de los discos en formato legible.',
      hints: ['"Disk free" abreviado, con -h.', 'df -h', 'Escribe: df -h'],
      solution: 'df -h',
      check: ran('df', (args) => args.some((a) => a.includes('h'))),
      success: 'La línea de / es tu disco principal. Vigila ese porcentaje.',
      reward: rewardFor(1),
    },
    {
      id: 'linux-15-02',
      title: '¿Qué ocupa tanto?',
      difficulty: 3,
      teaches: ['du'],
      briefing: [
        'df dice CUÁNTO está lleno; `du` dice QUÉ lo llena.',
        '`du -sh directorio` muestra el total de un directorio; `du -sh ~/*` el de cada elemento.',
        'Combinado con sort: `du -sh ~/* | sort -h` → lo más grande al final.',
      ],
      objective: 'Averigua qué directorio de ~/datos ocupa más y escribe su nombre con echo.',
      hints: ['du -sh ~/datos/* te da el tamaño de cada uno.', 'du -sh ~/datos/* | sort -h', 'Escribe: echo videos'],
      setup: (world) => {
        plantFiles(world, { '~/datos/fotos/a.jpg': '', '~/datos/videos/curso.mp4': '', '~/datos/docs/a.pdf': '', '~/datos/musica/a.mp3': '' });
        setSize(world, '~/datos/fotos/a.jpg', 300_000_000);
        setSize(world, '~/datos/videos/curso.mp4', 2_100_000_000);
        setSize(world, '~/datos/docs/a.pdf', 4_000_000);
        setSize(world, '~/datos/musica/a.mp3', 900_000_000);
      },
      solution: 'du -sh ~/datos/* | sort -h; echo videos',
      check: (ctx) => ctx.report.commands.some((c) => c.name === 'echo' && c.stdout.trim() === 'videos'),
      success: 'videos: 2 GB. du + sort es la forma más rápida de encontrar al culpable.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-15-03',
      title: 'Los discos',
      difficulty: 2,
      teaches: ['lsblk', 'blkid'],
      briefing: [
        '`lsblk` muestra los discos físicos y sus particiones en árbol.',
        'sda es el primer disco, sdb el segundo... y sda1, sda2 sus particiones.',
        'Te acaban de conectar un disco nuevo de 50 GB. ¿Lo ves?',
      ],
      objective: 'Lista los discos y particiones del servidor.',
      hints: ['"List block devices".', 'lsblk', 'Escribe: lsblk'],
      setup: (world) => freshDisk(world),
      solution: 'lsblk',
      check: finalOutputMatches(/sdb\s/),
      success: 'sdb: 50G, sin particiones ni punto de montaje. Vamos a prepararlo.',
      reward: rewardFor(2),
    },
    {
      id: 'linux-15-04',
      title: 'Particionar',
      difficulty: 4,
      teaches: ['fdisk', 'parted'],
      briefing: [
        'Un disco nuevo necesita al menos una PARTICIÓN.',
        '`fdisk /dev/sdb` es interactivo (n = nueva, p = primaria, w = escribir). En scripts se le pasan las respuestas:',
        '  `printf "n\\np\\n1\\n\\n\\nw\\n" | sudo fdisk /dev/sdb`',
        'O con parted: `sudo parted /dev/sdb --script mklabel gpt mkpart primary ext4 0% 100%`',
        '⚠ Particionar el disco equivocado destruye sus datos. Comprueba siempre el nombre con lsblk.',
      ],
      objective: 'Crea una partición que ocupe todo /dev/sdb.',
      hints: ['Usa parted --script o fdisk con las respuestas por tubería.', 'sudo parted /dev/sdb --script mklabel gpt mkpart primary ext4 0% 100%', 'Escribe: sudo parted /dev/sdb --script mklabel gpt mkpart primary ext4 0% 100%'],
      setup: (world) => freshDisk(world),
      solution: 'sudo parted /dev/sdb --script mklabel gpt mkpart primary ext4 0% 100%',
      check: machine((m) => (m.disks.find((d) => d.name === 'sdb')?.partitions.length ?? 0) > 0),
      success: 'Ya existe /dev/sdb1. Compruébalo con lsblk.',
      reward: rewardFor(4),
    },
    {
      id: 'linux-15-05',
      title: 'Formatear',
      difficulty: 3,
      teaches: ['mkfs', 'mkfs.ext4'],
      briefing: [
        'Una partición necesita un SISTEMA DE ARCHIVOS para guardar datos: ext4 es el estándar en Linux.',
        '`sudo mkfs.ext4 /dev/sdb1` lo crea. ⚠ Borra todo lo que hubiera en esa partición.',
      ],
      objective: 'Formatea /dev/sdb1 con ext4.',
      hints: ['mkfs.ext4 seguido de la partición (no del disco).', 'sudo mkfs.ext4 /dev/sdb1', 'Escribe: sudo mkfs.ext4 /dev/sdb1'],
      setup: (world) => {
        freshDisk(world);
        partitioned(world, false);
      },
      solution: 'sudo mkfs.ext4 /dev/sdb1',
      check: machine((m) => m.disks.find((d) => d.name === 'sdb')?.partitions[0]?.fstype === 'ext4'),
      success: 'Formateado. Fíjate en el UUID: es el identificador único de la partición.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-15-06',
      title: 'Montar',
      difficulty: 3,
      teaches: ['mount', 'umount'],
      briefing: [
        'En Linux no hay letras de unidad (C:, D:). Los discos se MONTAN en un directorio cualquiera.',
        '`sudo mkdir /data` y `sudo mount /dev/sdb1 /data`: todo lo que guardes en /data va al disco nuevo.',
        '`umount /data` lo desmonta (sin "n": u-mount).',
      ],
      objective: 'Monta /dev/sdb1 en /data.',
      hints: ['Crea el directorio y monta.', 'sudo mkdir -p /data && sudo mount /dev/sdb1 /data', 'Escribe: sudo mkdir -p /data && sudo mount /dev/sdb1 /data'],
      setup: (world) => {
        freshDisk(world);
        partitioned(world, true);
      },
      solution: 'sudo mkdir -p /data && sudo mount /dev/sdb1 /data',
      check: machine((m) => m.mounts.some((x) => x.device === '/dev/sdb1' && x.target === '/data')),
      success: 'df -h ahora muestra /data con 50 GB. Pero... al reiniciar se perdería el montaje.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-15-07',
      title: 'Montaje permanente',
      difficulty: 4,
      teaches: [],
      briefing: [
        '/etc/fstab lista lo que se monta al arrancar. Una línea por disco:',
        '  `UUID=xxxx  /data  ext4  defaults  0  2`',
        'Usa el UUID (sale en `sudo blkid`) en vez de /dev/sdb1: los nombres pueden cambiar entre reinicios.',
        '⚠ Un error en fstab puede impedir que el servidor arranque. Prueba SIEMPRE con `sudo mount -a`.',
      ],
      objective: 'Añade /dev/sdb1 a /etc/fstab (montado en /data, ext4) y compruébalo con mount -a.',
      hints: [
        'Añade la línea con tee -a (como root) y luego sudo mount -a.',
        "echo 'UUID=... /data ext4 defaults 0 2' | sudo tee -a /etc/fstab   (el UUID sale en sudo blkid)",
        "Escribe (con el UUID que te da sudo blkid): echo 'UUID=3c1d6c55-9f0e-4a8b-b8e2-7d0c52f1a9e4 /data ext4 defaults 0 2' | sudo tee -a /etc/fstab && sudo mount -a",
      ],
      setup: (world) => {
        freshDisk(world);
        partitioned(world, true);
        world.fs.privileged(() => {
          world.fs.mkdir('/data', true);
          const fstab = world.fs.readFile('/etc/fstab').split('\n').filter((l) => !l.includes('/data')).join('\n');
          world.fs.writeFile('/etc/fstab', fstab.endsWith('\n') ? fstab : fstab + '\n');
        });
      },
      solution: "echo 'UUID=3c1d6c55-9f0e-4a8b-b8e2-7d0c52f1a9e4 /data ext4 defaults 0 2' | sudo tee -a /etc/fstab && sudo mount -a",
      check: all(systemFileMatches('/etc/fstab', /^(UUID=\S+|\/dev\/sdb1)\s+\/data\s+ext4/m), machine((m) => m.mounts.some((x) => x.target === '/data'))),
      success: 'Sobrevivirá a los reinicios. mount -a sin errores = fstab correcto.',
      reward: rewardFor(4),
    },
    {
      id: 'linux-15-08',
      title: 'JEFE: Disco al 98 %',
      difficulty: 5,
      boss: true,
      teaches: ['truncate'],
      briefing: [
        '⚠ ALERTA: el disco raíz está casi lleno y las aplicaciones empiezan a fallar.',
        'Encuentra qué lo llena (df, du -sh /var/log/* ...) y libera espacio hasta bajar del 80 %.',
        'Condición: el log culpable lo tiene abierto la aplicación, así que NO lo borres: vacíalo.',
        '  `sudo truncate -s 0 archivo` lo deja a 0 bytes sin borrarlo.',
      ],
      objective: 'Baja el uso del disco raíz por debajo del 80 % vaciando (sin borrar) el log que lo llena.',
      hints: [
        'sudo du -sh /var/log/* | sort -h te señalará el directorio culpable. Baja un nivel más.',
        'El culpable está en /var/log/miapp/. Vacíalo con truncate.',
        'Escribe: sudo truncate -s 0 /var/log/miapp/debug.log',
      ],
      setup: (world) => {
        plantFiles(world, { '/var/log/miapp/debug.log': '[DEBUG] petición recibida\n', '/var/log/miapp/error.log': '[ERROR] timeout\n' });
        setSize(world, '/var/log/miapp/debug.log', 11.8 * BIG);
      },
      solution: 'sudo truncate -s 0 /var/log/miapp/debug.log',
      check: all((ctx) => rootUsage(ctx) < 80, isFile('/var/log/miapp/debug.log')),
      success: 'Disco recuperado sin parar la aplicación. Ahora configura logrotate para que no vuelva a pasar (capítulo 20).',
      reward: rewardFor(5, true),
    },
  ],
};
