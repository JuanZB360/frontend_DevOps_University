/**
 * Capítulo 19 — Tareas programadas.
 * crontab, sintaxis cron, /etc/cron.d y redirección de la salida.
 */
import { rewardFor, type Chapter, type MissionCheck, type MissionWorld } from '../../domain/curriculum';
import { all, systemFileMatches } from '../../missions/checks';
import { plantFiles } from '../../missions/worldHelpers';

/** El crontab del usuario contiene una línea que cumple el patrón. */
const cronHas = (user: string | null, pattern: RegExp): MissionCheck => (ctx) => {
  const name = user ?? ctx.session.username;
  const path = `/var/spool/cron/crontabs/${name}`;
  const content = ctx.fs.privileged(() => (ctx.fs.exists(path) ? ctx.fs.readFile(path) : ''));
  return content.split('\n').some((l) => !l.trim().startsWith('#') && pattern.test(l.trim()));
};

/** Borra el crontab de un usuario. */
function clearCrontab(world: MissionWorld, user: string): void {
  world.fs.privileged(() => {
    const path = `/var/spool/cron/crontabs/${user}`;
    if (world.fs.exists(path)) world.fs.remove(path);
  });
}

export const chapter19: Chapter = {
  id: 'linux-19',
  number: 19,
  title: 'Tareas programadas',
  description: 'Que el servidor trabaje solo: copias, limpiezas e informes a su hora.',
  missions: [
    {
      id: 'linux-19-01',
      title: 'Tus tareas',
      difficulty: 1,
      teaches: ['crontab'],
      briefing: [
        'cron ejecuta comandos periódicamente. Cada usuario tiene su "crontab".',
        '`crontab -l` lista tus tareas; `crontab -e` las edita; `crontab -r` las BORRA todas (cuidado).',
      ],
      objective: 'Lista tus tareas programadas.',
      hints: ['crontab con -l (list).', 'crontab -l', 'Escribe: crontab -l'],
      setup: (world) => clearCrontab(world, world.session.username),
      solution: 'crontab -l',
      // "no crontab for..." termina con código 1, pero cuenta igual.
      check: (ctx) => ctx.report.commands.some((c) => c.name === 'crontab' && c.args.includes('-l')),
      success: '"no crontab": aún no tienes ninguna. Vamos a crearlas.',
      reward: rewardFor(1),
    },
    {
      id: 'linux-19-02',
      title: 'Cada cinco minutos',
      difficulty: 3,
      teaches: [],
      briefing: [
        'Formato de una línea:  minuto  hora  día-mes  mes  día-semana  comando',
        '  `*` = cualquiera   `*/5` = cada 5   `1-5` = rango   `1,15` = lista',
        'Ejemplo: `*/5 * * * * /usr/local/bin/check.sh` → cada 5 minutos.',
        'Edita con `crontab -e`, o en una línea: `(crontab -l; echo "LÍNEA") | crontab -`',
      ],
      objective: 'Programa /usr/local/bin/check.sh para que se ejecute cada 5 minutos.',
      hints: ['La expresión de minutos es */5 y el resto *.', "echo '*/5 * * * * /usr/local/bin/check.sh' | crontab -", "Escribe: echo '*/5 * * * * /usr/local/bin/check.sh' | crontab -"],
      setup: (world) => clearCrontab(world, world.session.username),
      solution: "echo '*/5 * * * * /usr/local/bin/check.sh' | crontab -",
      check: cronHas(null, /^\*\/5\s+\*\s+\*\s+\*\s+\*\s+\/usr\/local\/bin\/check\.sh/),
      success: 'Cada 5 minutos, para siempre. Comprueba con crontab -l.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-19-03',
      title: 'A una hora exacta',
      difficulty: 3,
      teaches: [],
      briefing: [
        '`30 2 * * *` → todos los días a las 02:30.',
        '`0 9 * * 1-5` → a las 09:00 de lunes a viernes (0 o 7 = domingo).',
        'Herramienta útil: crontab.guru explica cualquier expresión.',
      ],
      objective: 'Añade a tu crontab /usr/local/bin/informe.sh de lunes a viernes a las 09:00 (sin borrar lo que ya tengas).',
      hints: ['Minuto 0, hora 9, día-semana 1-5.', "(crontab -l; echo '0 9 * * 1-5 /usr/local/bin/informe.sh') | crontab -", "Escribe: (crontab -l; echo '0 9 * * 1-5 /usr/local/bin/informe.sh') | crontab -"],
      setup: (world) => {
        plantFiles(world, {});
        world.fs.privileged(() => {
          world.fs.mkdir('/var/spool/cron/crontabs', true);
          world.fs.writeFile(`/var/spool/cron/crontabs/${world.session.username}`, '*/5 * * * * /usr/local/bin/check.sh\n');
        });
      },
      solution: "(crontab -l; echo '0 9 * * 1-5 /usr/local/bin/informe.sh') | crontab -",
      check: all(cronHas(null, /^0\s+9\s+\*\s+\*\s+(1-5|mon-fri)\s+\/usr\/local\/bin\/informe\.sh/i), cronHas(null, /check\.sh/)),
      success: 'Informes en días laborables, y la tarea anterior sigue ahí.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-19-04',
      title: 'Sin pantalla',
      difficulty: 4,
      teaches: [],
      briefing: [
        'cron no tiene pantalla: si no rediriges la salida, se pierde (o se envía por correo local).',
        'Siempre: `comando >> /var/log/tarea.log 2>&1` para guardar salida y errores.',
      ],
      objective: 'Programa /usr/local/bin/limpieza.sh cada día a las 04:00 guardando salida y errores en /tmp/limpieza.log',
      hints: ['Al final de la línea: >> /tmp/limpieza.log 2>&1', "(crontab -l; echo '0 4 * * * /usr/local/bin/limpieza.sh >> /tmp/limpieza.log 2>&1') | crontab -", "Escribe: (crontab -l; echo '0 4 * * * /usr/local/bin/limpieza.sh >> /tmp/limpieza.log 2>&1') | crontab -"],
      solution: "(crontab -l; echo '0 4 * * * /usr/local/bin/limpieza.sh >> /tmp/limpieza.log 2>&1') | crontab -",
      check: cronHas(null, /^0\s+4\s+\*\s+\*\s+\*\s+\/usr\/local\/bin\/limpieza\.sh\s*>>\s*\/tmp\/limpieza\.log\s+2>&1/),
      success: 'Si algún día falla, tendrás el log para saber por qué.',
      reward: rewardFor(4),
    },
    {
      id: 'linux-19-05',
      title: 'Tareas del sistema',
      difficulty: 4,
      teaches: [],
      briefing: [
        'Las tareas del sistema van en archivos dentro de /etc/cron.d/. Llevan un campo extra: el USUARIO.',
        '  `0 3 * * * root /usr/local/bin/backup.sh`',
        'Así quedan versionables y separadas por aplicación.',
      ],
      objective: 'Crea /etc/cron.d/rotar-tmp que ejecute como root "find /tmp -mtime +7 -delete" cada domingo a las 05:00.',
      hints: ['Minuto 0, hora 5, día-semana 0; después el usuario root y el comando.', "echo '0 5 * * 0 root find /tmp -mtime +7 -delete' | sudo tee /etc/cron.d/rotar-tmp", "Escribe: echo '0 5 * * 0 root find /tmp -mtime +7 -delete' | sudo tee /etc/cron.d/rotar-tmp"],
      solution: "echo '0 5 * * 0 root find /tmp -mtime +7 -delete' | sudo tee /etc/cron.d/rotar-tmp",
      check: systemFileMatches('/etc/cron.d/rotar-tmp', /^0\s+5\s+\*\s+\*\s+(0|7|sun)\s+root\s+find \/tmp -mtime \+7 -delete/im),
      success: 'Limpieza semanal de /tmp como root.',
      reward: rewardFor(4),
    },
    {
      id: 'linux-19-06',
      title: 'JEFE: Backup diario a las 3 AM',
      difficulty: 5,
      boss: true,
      teaches: [],
      briefing: [
        '⚠ Requisito de auditoría: copia diaria de /home a las 03:00.',
        '  1) Script /usr/local/bin/backup-home.sh (ejecutable) que cree /backup/home-FECHA.tar.gz con tar',
        '  2) En el crontab de ROOT: ejecutarlo a las 03:00 cada día, con la salida y errores en /var/log/backup.log',
        'Pista: `sudo crontab -e` (o `... | sudo crontab -`) edita el crontab de root.',
      ],
      objective: 'Crea el script de backup de /home y prográmalo en el crontab de root a las 03:00 con log.',
      hints: [
        'El script: #!/bin/bash y tar -czf /backup/home-$(date +%F).tar.gz /home',
        "printf '#!/bin/bash\\ntar -czf /backup/home-$(date +%%F).tar.gz /home\\n' | sudo tee /usr/local/bin/backup-home.sh && sudo chmod +x /usr/local/bin/backup-home.sh",
        "Escribe: printf '#!/bin/bash\\ntar -czf /backup/home-$(date +%%F).tar.gz /home\\n' | sudo tee /usr/local/bin/backup-home.sh && sudo chmod +x /usr/local/bin/backup-home.sh && echo '0 3 * * * /usr/local/bin/backup-home.sh >> /var/log/backup.log 2>&1' | sudo crontab -",
      ],
      setup: (world) => {
        clearCrontab(world, 'root');
        world.fs.privileged(() => {
          if (world.fs.exists('/usr/local/bin/backup-home.sh')) world.fs.remove('/usr/local/bin/backup-home.sh');
        });
      },
      solution: "printf '#!/bin/bash\\ntar -czf /backup/home-$(date +%%F).tar.gz /home\\n' | sudo tee /usr/local/bin/backup-home.sh && sudo chmod +x /usr/local/bin/backup-home.sh && echo '0 3 * * * /usr/local/bin/backup-home.sh >> /var/log/backup.log 2>&1' | sudo crontab -",
      check: all(
        systemFileMatches('/usr/local/bin/backup-home.sh', /tar\s+-?c\w*z\w*f?\s+\S*\/backup\//),
        (ctx) => ctx.fs.privileged(() => ((ctx.fs.tryStat('/usr/local/bin/backup-home.sh')?.mode ?? 0) & 0o100) !== 0),
        cronHas('root', /^0\s+3\s+\*\s+\*\s+\*\s+\/usr\/local\/bin\/backup-home\.sh.*>>\s*\/var\/log\/backup\.log\s+2>&1/),
      ),
      success: 'Backups automáticos cada noche. Duerme tranquilo... y prueba de vez en cuando a restaurarlos.',
      reward: rewardFor(5, true),
    },
  ],
};
