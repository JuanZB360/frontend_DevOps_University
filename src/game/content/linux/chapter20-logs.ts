/**
 * Capítulo 20 — Logs.
 * /var/log, journalctl avanzado, dmesg, logger y logrotate.
 */
import { rewardFor, type Chapter } from '../../domain/curriculum';
import { all, fileContains, machine, ran, ranAsRoot, systemFileMatches } from '../../missions/checks';
import { plantFiles, withMachine } from '../../missions/worldHelpers';

export const chapter20: Chapter = {
  id: 'linux-20',
  number: 20,
  title: 'Logs',
  description: 'El servidor te cuenta todo lo que le pasa. Solo hay que saber dónde mirar.',
  missions: [
    {
      id: 'linux-20-01',
      title: 'El archivo de los logs',
      difficulty: 1,
      teaches: [],
      briefing: [
        '/var/log es donde Linux guarda sus registros:',
        '  syslog (todo el sistema) · auth.log (logins y sudo) · kern.log (kernel) · dpkg.log (paquetes)',
        '  y un directorio por aplicación: nginx/, mysql/, apt/...',
      ],
      objective: 'Muestra las últimas 15 líneas de /var/log/syslog.',
      hints: ['tail con -n.', 'tail -n 15 /var/log/syslog', 'Escribe: tail -n 15 /var/log/syslog'],
      solution: 'tail -n 15 /var/log/syslog',
      check: ran('tail', (args) => args.some((a) => a.includes('syslog'))),
      success: 'syslog es el primer sitio donde mirar cuando "algo raro pasa".',
      reward: rewardFor(1),
    },
    {
      id: 'linux-20-02',
      title: 'Solo los errores',
      difficulty: 2,
      teaches: [],
      briefing: [
        'Los mensajes del journal tienen PRIORIDAD: emerg, alert, crit, err, warning, notice, info, debug.',
        '`journalctl -p err` muestra solo los de prioridad "err" o peor.',
        'Combínalo con `--since today` o `-u servicio` para acotar.',
      ],
      objective: 'Muestra solo los mensajes de error (o peores) del journal.',
      hints: ['La opción -p indica la prioridad.', 'journalctl -p err', 'Escribe: journalctl -p err'],
      solution: 'journalctl -p err',
      check: ran('journalctl', (args) => args.includes('-p') || args.some((a) => a.startsWith('--priority'))),
      success: 'Directo a lo importante.',
      reward: rewardFor(2),
    },
    {
      id: 'linux-20-03',
      title: 'El kernel habla',
      difficulty: 2,
      teaches: ['dmesg'],
      briefing: [
        '`dmesg` muestra los mensajes del kernel: discos detectados, errores de hardware, falta de memoria...',
        'En Ubuntu requiere sudo. Con `-T` muestra fechas legibles.',
      ],
      objective: 'Muestra los mensajes del kernel.',
      hints: ['Necesita sudo.', 'sudo dmesg', 'Escribe: sudo dmesg -T'],
      solution: 'sudo dmesg -T',
      check: ranAsRoot('dmesg'),
      success: 'Ahí ves cómo el kernel detectó los discos sda y sdb al arrancar.',
      reward: rewardFor(2),
    },
    {
      id: 'linux-20-04',
      title: 'Deja tu huella',
      difficulty: 2,
      teaches: ['logger'],
      briefing: [
        '`logger -t etiqueta "mensaje"` escribe en el log del sistema.',
        'Ideal para tus scripts: sus mensajes quedan junto a los del sistema y se ven con journalctl.',
      ],
      objective: 'Registra el mensaje "Mantenimiento iniciado" con la etiqueta mantenimiento.',
      hints: ['logger con -t para la etiqueta.', 'logger -t mantenimiento "Mantenimiento iniciado"', 'Escribe: logger -t mantenimiento "Mantenimiento iniciado"'],
      solution: 'logger -t mantenimiento "Mantenimiento iniciado"',
      check: machine((m) => m.journal.some((e) => e.unit === 'mantenimiento' && /Mantenimiento iniciado/.test(e.message))),
      success: 'Compruébalo: journalctl -t mantenimiento (o grep mantenimiento /var/log/syslog).',
      reward: rewardFor(2),
    },
    {
      id: 'linux-20-05',
      title: 'Rotación de logs',
      difficulty: 4,
      teaches: ['logrotate'],
      briefing: [
        'Los logs crecen sin parar. `logrotate` los "rota": renombra el actual (app.log.1), comprime los viejos y borra los más antiguos.',
        'Configuración en /etc/logrotate.d/APP:',
        '  /var/log/miapp/*.log {',
        '      daily          (cada día)',
        '      rotate 7       (guarda 7)',
        '      compress       (comprime con gzip)',
        '      missingok      (sin error si no existe)',
        '      notifempty     (no rota si está vacío)',
        '  }',
        'Prueba la configuración con `sudo logrotate -d /etc/logrotate.d/miapp` (modo debug: no cambia nada).',
      ],
      objective: 'Crea /etc/logrotate.d/miapp para /var/log/miapp/*.log: daily, rotate 7, compress, missingok, notifempty. Pruébalo con -d.',
      hints: [
        'Escribe el archivo con sudo nano o printf | sudo tee.',
        "printf '/var/log/miapp/*.log {\\n    daily\\n    rotate 7\\n    compress\\n    missingok\\n    notifempty\\n}\\n' | sudo tee /etc/logrotate.d/miapp",
        "Escribe: printf '/var/log/miapp/*.log {\\n    daily\\n    rotate 7\\n    compress\\n    missingok\\n    notifempty\\n}\\n' | sudo tee /etc/logrotate.d/miapp && sudo logrotate -d /etc/logrotate.d/miapp",
      ],
      setup: (world) => plantFiles(world, { '/var/log/miapp/app.log': '[INFO] arranque\n' }),
      solution: "printf '/var/log/miapp/*.log {\\n    daily\\n    rotate 7\\n    compress\\n    missingok\\n    notifempty\\n}\\n' | sudo tee /etc/logrotate.d/miapp && sudo logrotate -d /etc/logrotate.d/miapp",
      check: all(
        systemFileMatches('/etc/logrotate.d/miapp', /\/var\/log\/miapp\/\*\.log\s*\{/),
        systemFileMatches('/etc/logrotate.d/miapp', /^\s*daily\s*$/m),
        systemFileMatches('/etc/logrotate.d/miapp', /^\s*rotate\s+7\s*$/m),
        systemFileMatches('/etc/logrotate.d/miapp', /^\s*compress\s*$/m),
        systemFileMatches('/etc/logrotate.d/miapp', /^\s*missingok\s*$/m),
        systemFileMatches('/etc/logrotate.d/miapp', /^\s*notifempty\s*$/m),
        (ctx) => ctx.report.commands.some((c) => c.name === 'logrotate' && c.exitCode === 0),
      ),
      success: 'Nunca más un disco lleno por un log gigante (¿recuerdas el capítulo 15?).',
      reward: rewardFor(4),
    },
    {
      id: 'linux-20-06',
      title: 'JEFE: ¿Por qué falló anoche?',
      difficulty: 5,
      boss: true,
      teaches: [],
      briefing: [
        '⚠ Esta mañana la base de datos estaba caída. Nadie sabe qué pasó de madrugada.',
        'Investiga los logs (journalctl, /var/log/syslog, dmesg...) y escribe en ~/incidente.txt:',
        '  · el NOMBRE del proceso que murió',
        '  · la CAUSA (en pocas palabras, con el término técnico que aparece en el log)',
        'Ejemplo de formato: "nginx murió por disco lleno"',
      ],
      objective: 'Averigua qué proceso murió esta madrugada y por qué, y escríbelo en ~/incidente.txt',
      hints: [
        'journalctl -p err (o grep -i kill /var/log/syslog) te lleva al momento exacto.',
        'Busca "Out of memory" / "oom": el kernel mató un proceso por falta de RAM.',
        'Escribe: echo "mysqld murió por Out of memory (OOM killer)" > ~/incidente.txt',
      ],
      setup: (world) => {
        const night = world.fs.now() - 6 * 3_600_000;
        withMachine(world, (m) => {
          if (m.journal.some((e) => e.message.includes('Killed process 4711 (mysqld)'))) return;
          m.journal.push(
            { time: night, unit: 'backup', priority: 6, message: 'Iniciando copia completa de la base de datos (mysqldump)' },
            { time: night + 60_000, unit: 'kernel', priority: 4, message: 'mysqld invoked oom-killer: gfp_mask=0x140cca(GFP_HIGHUSER_MOVABLE|__GFP_COMP), order=0, oom_score_adj=0' },
            { time: night + 61_000, unit: 'kernel', priority: 3, message: 'Out of memory: Killed process 4711 (mysqld) total-vm:4125412kB, anon-rss:3812044kB, file-rss:0kB, shmem-rss:0kB, UID:112' },
            { time: night + 62_000, unit: 'systemd', priority: 3, message: 'mysql.service: Main process exited, code=killed, status=9/KILL' },
            { time: night + 62_500, unit: 'systemd', priority: 3, message: "mysql.service: Failed with result 'oom-kill'." },
          );
        });
        world.fs.privileged(() => {
          const line = 'Nov 16 03:01:01 devops-u kernel: [91201.441201] Out of memory: Killed process 4711 (mysqld) total-vm:4125412kB';
          const syslog = world.fs.readFile('/var/log/syslog');
          if (!syslog.includes('Killed process 4711')) world.fs.writeFile('/var/log/syslog', syslog + line + '\n');
          const incident = `${world.session.home}/incidente.txt`;
          if (world.resetting && world.fs.exists(incident)) world.fs.remove(incident);
        });
      },
      solution: 'echo "mysqld murió por Out of memory (OOM killer)" > ~/incidente.txt',
      check: all(fileContains('~/incidente.txt', /mysql/i), fileContains('~/incidente.txt', /(out of memory|oom|memoria)/i)),
      success: 'Diagnóstico correcto: el OOM killer mató mysqld durante el backup. Solución real: más RAM, swap o limitar memoria de MySQL.',
      reward: rewardFor(5, true),
    },
  ],
};
