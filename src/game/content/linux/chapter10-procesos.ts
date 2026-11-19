/**
 * Capítulo 10 — Procesos.
 * ps, top, trabajos en segundo plano, kill, pkill, nice/renice y nohup.
 */
import { rewardFor, type Chapter, type MissionWorld } from '../../domain/curriculum';
import { all, machine, noProcessMatching, processMatching, ran } from '../../missions/checks';
import { ensureProcess } from '../../missions/worldHelpers';

/** Proceso del jugador (lo crea con su usuario). */
function playerProcess(world: MissionWorld, command: string, cpu: number, mem = 1.2, extra: { nice?: number } = {}): void {
  ensureProcess(world, { user: world.session.username, command, cpu, mem, rss: Math.round(mem * 40_000), tty: 'pts/0', ...extra });
}

export const chapter10: Chapter = {
  id: 'linux-10',
  number: 10,
  title: 'Procesos',
  description: 'Todo lo que se ejecuta es un proceso. Aprende a verlos, priorizarlos y detenerlos.',
  missions: [
    {
      id: 'linux-10-01',
      title: '¿Qué se está ejecutando?',
      difficulty: 2,
      teaches: ['ps'],
      briefing: [
        'Cada programa en marcha es un PROCESO con un número único: el PID.',
        '`ps` solo muestra los de tu terminal. `ps aux` muestra TODOS los del sistema con detalle:',
        '  USER (dueño) · PID · %CPU · %MEM · COMMAND (qué es)',
      ],
      objective: 'Lista todos los procesos del sistema con ps aux.',
      hints: ['ps con las letras a, u, x (sin guion).', 'Escribe ps aux', 'Escribe: ps aux'],
      solution: 'ps aux',
      check: ran('ps', (args) => args.join('').includes('aux') || args.includes('-ef') || args.includes('-e')),
      success: 'El PID 1 es systemd (/sbin/init): el padre de todos los procesos.',
      reward: rewardFor(2),
    },
    {
      id: 'linux-10-02',
      title: 'El monitor',
      difficulty: 2,
      teaches: ['top', 'htop'],
      briefing: [
        '`top` muestra los procesos ordenados por consumo de CPU, en tiempo real.',
        'Arriba ves la carga del sistema (load average), las tareas y la memoria.',
        'Algo está consumiendo CPU en este servidor...',
      ],
      objective: 'Abre top y localiza el proceso que más CPU consume.',
      hints: ['Es un comando de tres letras: "lo de arriba".', 'Escribe top. El primero de la lista es el que más consume.', 'Escribe: top'],
      setup: (world) => playerProcess(world, '/usr/bin/python3 /home/' + world.session.username + '/minero.py', 96.4, 3.1),
      solution: 'top',
      check: ran('top'),
      success: 'Un tal minero.py se come casi toda la CPU. Vamos a por él.',
      reward: rewardFor(2),
    },
    {
      id: 'linux-10-03',
      title: 'Detener un proceso',
      difficulty: 3,
      teaches: ['kill'],
      briefing: [
        '`kill PID` envía una señal al proceso. Por defecto, TERM (15): "termina, por favor".',
        'Busca el PID con ps (o top) y después: `kill 4242`.',
        'Truco: `ps aux | grep minero` encuentra el proceso sin leer toda la lista.',
      ],
      objective: 'Termina el proceso minero.py.',
      hints: ['Encuentra su PID con ps aux | grep minero.', 'kill seguido del PID (el número de la segunda columna).', "Escribe: kill $(ps aux | grep minero.py | awk '{print $2}')"],
      setup: (world) => playerProcess(world, '/usr/bin/python3 /home/' + world.session.username + '/minero.py', 96.4, 3.1),
      solution: "kill $(ps aux | grep minero.py | awk '{print $2}')",
      check: noProcessMatching(/minero\.py/),
      success: 'CPU liberada. Un minero de criptomonedas es justo lo que instala un atacante en un servidor mal protegido.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-10-04',
      title: 'Matar por nombre',
      difficulty: 3,
      teaches: ['pkill', 'pgrep', 'killall'],
      briefing: [
        '`pgrep nombre` muestra los PID de los procesos con ese nombre.',
        '`pkill nombre` les envía la señal a todos a la vez (killall hace algo parecido).',
        'Con `-f` comparan con la línea de comandos completa, no solo con el nombre del programa.',
      ],
      objective: 'Hay varios procesos stress-test lanzados por error. Termínalos todos de una vez.',
      hints: ['No hace falta buscar cada PID.', 'pkill stress-test', 'Escribe: pkill stress-test'],
      setup: (world) => {
        for (const n of [1, 2, 3]) playerProcess(world, `stress-test --worker ${n}`, 31, 2);
      },
      solution: 'pkill stress-test',
      check: noProcessMatching(/stress-test/),
      success: 'Los tres eliminados con un solo comando.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-10-05',
      title: 'Un proceso rebelde',
      difficulty: 3,
      teaches: [],
      briefing: [
        'Algunos procesos ignoran la señal TERM (por estar colgados o por estar mal programados).',
        'Entonces se usa KILL (9): el kernel lo elimina sin preguntarle. `kill -9 PID`',
        '⚠ KILL no deja al proceso guardar nada: úsalo solo si TERM no funciona.',
      ],
      objective: 'El proceso zombie-app ignora TERM. Elimínalo con la señal KILL.',
      hints: ['Prueba primero kill normal y verás que no muere.', 'Usa la señal 9: kill -9 PID o pkill -9.', 'Escribe: pkill -9 zombie-app'],
      setup: (world) => playerProcess(world, 'zombie-app --ignore-term', 12, 4),
      solution: 'pkill -9 zombie-app',
      check: noProcessMatching(/zombie-app/),
      success: 'Eliminado a la fuerza. Recuerda el orden: primero TERM, y solo si no responde, KILL.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-10-06',
      title: 'Segundo plano',
      difficulty: 3,
      teaches: ['jobs', 'fg', 'bg', 'sleep'],
      briefing: [
        'Un `&` al final ejecuta el comando en SEGUNDO PLANO: la terminal queda libre.',
        '`jobs` lista tus trabajos; `fg %1` trae el 1 al frente; `kill %1` lo termina.',
        '`sleep 600` simplemente espera 600 segundos: perfecto para practicar.',
      ],
      objective: 'Lanza sleep 600 en segundo plano y compruébalo con jobs.',
      hints: ['Añade & al final del comando.', 'sleep 600 &  y después  jobs', 'Escribe: sleep 600 & jobs'],
      solution: 'sleep 600 & jobs',
      check: all(processMatching(/^sleep 600$/), ran('jobs')),
      success: '[1] Running. En un servidor lo usarás para tareas largas (copias, compilaciones...).',
      reward: rewardFor(3),
    },
    {
      id: 'linux-10-07',
      title: 'Prioridades',
      difficulty: 4,
      teaches: ['nice', 'renice'],
      briefing: [
        'Cada proceso tiene una prioridad "nice" de -20 (máxima) a 19 (mínima). Por defecto, 0.',
        '`nice -n 10 comando` lo lanza con menos prioridad; `renice -n 15 -p PID` cambia uno en marcha.',
        'Bajar la prioridad es libre; subirla (valores negativos) requiere sudo.',
      ],
      objective: 'El proceso backup-nocturno ralentiza el servidor en horas de trabajo. Bájale la prioridad a 15.',
      hints: ['Busca su PID y usa renice.', 'renice -n 15 -p $(pgrep backup-nocturno)', 'Escribe: renice -n 15 -p $(pgrep backup-nocturno)'],
      setup: (world) => playerProcess(world, 'backup-nocturno --destino /backup', 45, 2.4),
      solution: 'renice -n 15 -p $(pgrep backup-nocturno)',
      check: machine((m) => m.processes.some((p) => p.command.startsWith('backup-nocturno') && p.nice >= 15)),
      success: 'El backup sigue, pero cede la CPU a lo importante. Así se convive en producción.',
      reward: rewardFor(4),
    },
    {
      id: 'linux-10-08',
      title: 'Que sobreviva',
      difficulty: 3,
      teaches: ['nohup'],
      briefing: [
        'Si cierras la conexión SSH, los procesos de tu sesión reciben la señal HUP y mueren.',
        '`nohup comando &` lo hace inmune: sigue aunque te desconectes, y su salida va a nohup.out.',
        '(Para cosas serias se usan servicios de systemd o tmux/screen, que verás más adelante.)',
      ],
      objective: 'Lanza sleep 3600 con nohup y en segundo plano.',
      hints: ['nohup delante, & detrás.', 'nohup sleep 3600 &', 'Escribe: nohup sleep 3600 &'],
      solution: 'nohup sleep 3600 &',
      check: all(processMatching(/sleep 3600/), ran('nohup')),
      success: 'Aunque cierres la sesión, seguirá corriendo.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-10-09',
      title: 'JEFE: Proceso desbocado',
      difficulty: 5,
      boss: true,
      teaches: [],
      briefing: [
        '⚠ ALERTA: la web no responde. El servidor está al 100 % de CPU.',
        'Localiza el proceso culpable, averigua de quién es y elimínalo.',
        'Cuidado: es de otro usuario, e ignora la señal TERM. No mates nada más.',
      ],
      objective: 'Encuentra el proceso que consume la CPU y elimínalo sin tocar ningún otro servicio.',
      hints: [
        'top (o ps aux --sort=-%cpu) te dirá cuál es. No es tuyo: necesitarás sudo.',
        'Ignora TERM: necesita la señal 9.',
        'Escribe: sudo pkill -9 indexador',
      ],
      setup: (world) => {
        ensureProcess(world, { user: 'root', command: '/usr/local/bin/indexador --ignore-term --full-scan', cpu: 99.1, mem: 8.4, rss: 330_000 });
      },
      solution: 'sudo pkill -9 indexador',
      check: all(noProcessMatching(/indexador/), processMatching(/sshd/), machine((m) => m.services.ssh?.active === true)),
      success: 'CPU al 2 %. La web responde de nuevo. Incidente resuelto en minutos: así se gana la confianza de un equipo.',
      reward: rewardFor(5, true),
    },
  ],
};
