/**
 * Capítulo 22 — Rendimiento y monitoreo.
 * uptime, free, vmstat, iostat, lsof y diagnóstico de un servidor lento.
 */
import { rewardFor, type Chapter } from '../../domain/curriculum';
import { all, machine, noProcessMatching, outputEquals, processMatching, ran } from '../../missions/checks';
import { aptReady, ensureProcess, withMachine } from '../../missions/worldHelpers';

export const chapter22: Chapter = {
  id: 'linux-22',
  number: 22,
  title: 'Rendimiento y monitoreo',
  description: 'CPU, memoria, disco y red: los cuatro recursos que debes vigilar.',
  missions: [
    {
      id: 'linux-22-01',
      title: 'La carga del sistema',
      difficulty: 2,
      teaches: ['uptime', 'w', 'who'],
      briefing: [
        '`uptime` dice cuánto lleva encendido el servidor y su LOAD AVERAGE (1, 5 y 15 minutos).',
        'Regla rápida: si la carga supera el número de CPUs (`nproc`), hay cola de trabajo esperando.',
      ],
      objective: 'Muestra el tiempo encendido y la carga media.',
      hints: ['"Up time".', 'uptime', 'Escribe: uptime'],
      solution: 'uptime',
      check: ran('uptime'),
      success: 'Load average bajo: el servidor está tranquilo.',
      reward: rewardFor(2),
    },
    {
      id: 'linux-22-02',
      title: 'La memoria',
      difficulty: 2,
      teaches: ['free'],
      briefing: [
        '`free -h` muestra la RAM y la swap.',
        'Mira la columna "available": lo realmente disponible (Linux usa la RAM libre como caché, y eso es BUENO).',
      ],
      objective: 'Muestra el uso de memoria en formato legible.',
      hints: ['free con -h.', 'free -h', 'Escribe: free -h'],
      solution: 'free -h',
      check: ran('free'),
      success: '"used" alto no es un problema; "available" bajo, sí.',
      reward: rewardFor(2),
    },
    {
      id: 'linux-22-03',
      title: 'Todo de un vistazo',
      difficulty: 3,
      teaches: ['vmstat'],
      briefing: [
        '`vmstat` resume procesos, memoria, swap, E/S y CPU en una línea. `vmstat 1 5` = 5 muestras, una por segundo.',
        'Claves: "r" (procesos esperando CPU), "si/so" (swap: si no es 0, falta RAM) y "wa" (esperando al disco).',
      ],
      objective: 'Ejecuta vmstat.',
      hints: ['vmstat sin argumentos (o con intervalo y número de muestras).', 'vmstat', 'Escribe: vmstat'],
      solution: 'vmstat',
      check: ran('vmstat'),
      success: 'La primera foto rápida cuando un servidor "va lento".',
      reward: rewardFor(3),
    },
    {
      id: 'linux-22-04',
      title: 'El disco trabaja',
      difficulty: 3,
      teaches: ['iostat'],
      briefing: [
        '`iostat` (paquete sysstat) mide la actividad de cada disco: operaciones por segundo y KB leídos/escritos.',
        'Un disco saturado hace que TODO vaya lento aunque la CPU esté libre.',
      ],
      objective: 'Instala sysstat y ejecuta iostat.',
      hints: ['apt install sysstat, después iostat.', 'sudo apt install -y sysstat && iostat', 'Escribe: sudo apt install -y sysstat && iostat'],
      setup: (world) => aptReady(world),
      solution: 'sudo apt install -y sysstat && iostat',
      check: ran('iostat'),
      success: 'sda tranquilo. Si ves tps y kB_wrtn/s disparados, algo está escribiendo sin parar.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-22-05',
      title: 'Archivos abiertos',
      difficulty: 4,
      teaches: [],
      briefing: [
        '`lsof` lista los archivos abiertos por cada proceso (en Linux, "todo es un archivo").',
        'Truco: un log BORRADO que un proceso mantiene abierto sigue ocupando disco. `sudo lsof +L1` los muestra.',
        'El espacio solo se libera al reiniciar (o terminar) ese proceso.',
      ],
      objective: 'Encuentra con lsof +L1 qué proceso retiene un archivo borrado y escribe su nombre con echo.',
      hints: ['sudo lsof +L1', 'La primera columna (COMMAND) es el nombre del proceso.', 'Escribe: echo reportero'],
      setup: (world) => ensureProcess(world, { user: 'root', command: '/usr/local/bin/reportero --daemon', cpu: 0.5, mem: 0.8, rss: 30_000, files: ['/var/log/reportero/old.log (deleted)'] }),
      solution: 'sudo lsof +L1; echo reportero',
      check: outputEquals('echo', 'reportero'),
      success: 'reportero retiene un log borrado de 9 GB. Reiniciarlo libera el espacio de golpe.',
      reward: rewardFor(4),
    },
    {
      id: 'linux-22-06',
      title: 'JEFE: El servidor va lento',
      difficulty: 5,
      boss: true,
      teaches: [],
      briefing: [
        '⚠ Los usuarios se quejan: la web tarda 10 segundos en cargar.',
        'Diagnostica con lo aprendido (uptime, free -h, top, ps aux --sort=-%mem...).',
        'Encuentra el proceso que agota la MEMORIA y termínalo. No toques nada más (sshd y cron deben seguir vivos).',
      ],
      objective: 'Encuentra el proceso que agota la RAM y elimínalo sin tocar los servicios del sistema.',
      hints: [
        'ps aux --sort=-%mem | head muestra los que más memoria usan.',
        'Es un proceso java del usuario reportes. Necesitas sudo.',
        "Escribe: sudo kill $(ps aux --sort=-%mem | awk 'NR == 2 {print $2}')",
      ],
      setup: (world) => {
        ensureProcess(world, { user: 'reportes', command: 'java -Xmx3500m -jar /opt/reportes/generador.jar', cpu: 38, mem: 86.4, rss: 3_465_000 });
        withMachine(world, (m) => {
          if (!m.processes.some((p) => p.service === 'cron')) m.processes.push({ pid: 640, ppid: 1, user: 'root', command: '/usr/sbin/cron -f -P', cpu: 0, mem: 0.1, rss: 2_800, state: 'S', nice: 0, start: world.fs.now(), tty: '?', service: 'cron' });
        });
      },
      solution: "sudo kill $(ps aux --sort=-%mem | awk 'NR == 2 {print $2}')",
      check: all(noProcessMatching(/generador\.jar/), processMatching(/sshd/), processMatching(/cron/), machine((m) => m.services.ssh?.active === true)),
      success: 'Memoria liberada y la web vuela de nuevo. El informe pesado debería ejecutarse de noche o en otro servidor.',
      reward: rewardFor(5, true),
    },
  ],
};
