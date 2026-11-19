/**
 * Capítulo 11 — Paquetes.
 * apt (update, search, show, install, remove, purge, upgrade) y dpkg.
 */
import { rewardFor, type Chapter } from '../../domain/curriculum';
import { all, machine, packageAbsent, packageInstalled, ran } from '../../missions/checks';
import { aptReady, withMachine } from '../../missions/worldHelpers';
import { installFiles } from '../../../engine/commands/packages/apt';
import { findPackage } from '../../../engine/system/packages';

export const chapter11: Chapter = {
  id: 'linux-11',
  number: 11,
  title: 'Paquetes',
  description: 'Instalar, actualizar y quitar software como en cualquier servidor Debian/Ubuntu.',
  missions: [
    {
      id: 'linux-11-01',
      title: 'Actualiza el catálogo',
      difficulty: 2,
      teaches: ['apt', 'apt-get'],
      briefing: [
        'En Ubuntu el software se instala desde REPOSITORIOS con `apt`.',
        'Primero hay que descargar el índice de paquetes disponibles: `sudo apt update`.',
        '⚠ update NO instala nada: solo actualiza la lista. Hazlo siempre antes de instalar.',
      ],
      objective: 'Actualiza el índice de paquetes.',
      hints: ['apt + la acción "actualizar la lista". Necesita root.', 'sudo apt update', 'Escribe: sudo apt update'],
      setup: (world) => withMachine(world, (m) => { m.aptUpdatedAt = null; }),
      solution: 'sudo apt update',
      check: machine((m) => m.aptUpdatedAt !== null),
      success: 'Índice actualizado: ahora apt sabe qué versiones hay disponibles.',
      reward: rewardFor(2),
    },
    {
      id: 'linux-11-02',
      title: 'Buscar software',
      difficulty: 2,
      teaches: ['apt-cache'],
      briefing: [
        '`apt search palabra` busca paquetes por nombre y descripción.',
        '`apt show paquete` muestra sus detalles: versión, tamaño, dependencias...',
      ],
      objective: 'Busca un "visor de procesos interactivo" (prueba con apt search processes).',
      hints: ['apt tiene una acción para buscar.', 'apt search processes', 'Escribe: apt search processes'],
      setup: (world) => aptReady(world),
      solution: 'apt search processes',
      check: ran('apt', (args) => args[0] === 'search'),
      success: 'Ahí está htop: un top mucho más bonito.',
      reward: rewardFor(2),
    },
    {
      id: 'linux-11-03',
      title: 'Instalar',
      difficulty: 2,
      teaches: [],
      briefing: [
        '`sudo apt install paquete` descarga e instala el paquete y sus dependencias.',
        'Con `-y` responde "sí" automáticamente (imprescindible en scripts).',
      ],
      objective: 'Instala htop.',
      hints: ['apt install con sudo.', 'sudo apt install htop', 'Escribe: sudo apt install -y htop'],
      setup: (world) => aptReady(world),
      solution: 'sudo apt install -y htop',
      check: packageInstalled('htop'),
      success: 'htop instalado. Pruébalo cuando quieras.',
      reward: rewardFor(2),
    },
    {
      id: 'linux-11-04',
      title: '¿Qué ha instalado?',
      difficulty: 3,
      teaches: ['dpkg'],
      briefing: [
        'Debajo de apt está `dpkg`, que gestiona los paquetes .deb instalados:',
        '  `dpkg -l` lista lo instalado   `dpkg -L paquete` sus archivos   `dpkg -S /ruta` de qué paquete es un archivo',
      ],
      objective: 'Lista los archivos que instaló el paquete htop.',
      hints: ['dpkg tiene una opción para listar archivos (L mayúscula).', 'dpkg -L htop', 'Escribe: dpkg -L htop'],
      setup: (world) => {
        aptReady(world);
        withMachine(world, (m) => {
          if (m.packages.htop?.status !== 'installed') installFiles(world.fs, m, findPackage('htop')!);
        });
      },
      solution: 'dpkg -L htop',
      check: ran('dpkg', (args) => args.includes('-L')),
      success: 'El ejecutable vive en /usr/bin/htop. Útil para saber dónde instala cada cosa un paquete.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-11-05',
      title: 'Desinstalar a fondo',
      difficulty: 3,
      teaches: [],
      briefing: [
        '`apt remove paquete` lo desinstala pero CONSERVA sus archivos de configuración.',
        '`apt purge paquete` lo borra todo, configuración incluida.',
        '`apt autoremove` limpia dependencias que ya nadie usa.',
      ],
      objective: 'Alguien instaló cowsay en el servidor de producción. Elimínalo por completo (purge).',
      hints: ['La acción que borra también la configuración.', 'sudo apt purge cowsay', 'Escribe: sudo apt purge -y cowsay'],
      setup: (world) => {
        aptReady(world);
        withMachine(world, (m) => {
          if (m.packages.cowsay?.status !== 'installed') installFiles(world.fs, m, findPackage('cowsay')!);
        });
      },
      solution: 'sudo apt purge -y cowsay',
      check: all(packageAbsent('cowsay'), machine((m) => m.packages.cowsay === undefined)),
      success: 'Ni rastro de la vaca. En producción solo debe estar instalado lo necesario.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-11-06',
      title: 'Parches de seguridad',
      difficulty: 3,
      teaches: [],
      briefing: [
        '`apt list --upgradable` muestra lo que tiene versión nueva.',
        '`sudo apt upgrade` actualiza todos los paquetes instalados.',
        'Rutina de mantenimiento: `sudo apt update && sudo apt upgrade -y`.',
      ],
      objective: 'Actualiza todos los paquetes del sistema.',
      hints: ['Primero update, después upgrade.', 'sudo apt update && sudo apt upgrade -y', 'Escribe: sudo apt update && sudo apt upgrade -y'],
      setup: (world) => withMachine(world, (m) => {
        if (m.packages.git) m.packages.git.version = '1:2.43.0-1ubuntu7';
      }),
      solution: 'sudo apt update && sudo apt upgrade -y',
      check: machine((m) => m.packages.git?.version === findPackage('git')!.upgradeTo),
      success: 'Sistema al día. La mayoría de servidores hackeados tenían parches pendientes desde hacía meses.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-11-07',
      title: 'JEFE: Repara un paquete roto',
      difficulty: 4,
      boss: true,
      teaches: [],
      briefing: [
        '⚠ Una instalación se cortó a medias (se fue la luz) y ahora apt se niega a hacer nada.',
        'Necesitamos instalar zip urgentemente para enviar unos informes.',
        'Lee bien el mensaje de error de apt: te dice exactamente qué hacer.',
      ],
      objective: 'Repara el sistema de paquetes e instala zip.',
      hints: [
        'Intenta instalar zip y lee el error.',
        'Hay que terminar de configurar los paquetes interrumpidos: sudo dpkg --configure -a',
        'Escribe: sudo dpkg --configure -a && sudo apt install -y zip',
      ],
      setup: (world) => {
        aptReady(world);
        withMachine(world, (m) => {
          m.packages.jq = { version: '1.7.1-3build1', status: 'half-configured' };
          if (m.packages.zip) delete m.packages.zip;
        });
      },
      solution: 'sudo dpkg --configure -a && sudo apt install -y zip',
      check: all(packageInstalled('zip'), machine((m) => !Object.values(m.packages).some((p) => p.status === 'half-configured'))),
      success: 'dpkg reparado y zip instalado. "dpkg was interrupted" es un error que verás en la vida real: ya sabes resolverlo.',
      reward: rewardFor(4, true),
    },
  ],
};
