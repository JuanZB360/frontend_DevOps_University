/**
 * Capítulo 18 — Servicios con systemd.
 * systemctl, journalctl y unidades .service propias.
 */
import { rewardFor, type Chapter, type MissionWorld } from '../../domain/curriculum';
import { all, ran, serviceActive, serviceEnabled, systemFileMatches } from '../../missions/checks';
import { plantFiles, withMachine } from '../../missions/worldHelpers';
import { stopService } from '../../../engine/system/services';

/** Script ejecutable fuera del home (como root). */
function rootScript(world: MissionWorld, path: string, content: string, mode = 0o755): void {
  plantFiles(world, { [path]: content });
  world.fs.privileged(() => world.fs.chmod(path, mode));
}

/** Borra una unidad propia y su estado (para empezar limpio). */
function removeUnit(world: MissionWorld, name: string): void {
  world.fs.privileged(() => {
    const path = `/etc/systemd/system/${name}.service`;
    if (world.fs.exists(path)) world.fs.remove(path);
  });
  withMachine(world, (m) => {
    stopService(world.fs, m, name);
    delete m.services[name];
    if (m.loadedUnits) delete m.loadedUnits[`${name}.service`];
  });
}

export const chapter18: Chapter = {
  id: 'linux-18',
  number: 18,
  title: 'Servicios con systemd',
  description: 'Los programas que deben estar siempre en marcha se gestionan como servicios.',
  missions: [
    {
      id: 'linux-18-01',
      title: 'Estado de un servicio',
      difficulty: 2,
      teaches: ['service'],
      briefing: [
        'systemd arranca y vigila los servicios del sistema. Se controla con `systemctl`.',
        '`systemctl status ssh` muestra si está activo, desde cuándo, su PID y sus últimos logs.',
        '(Pulsa q para salir del status en un servidor real.)',
      ],
      objective: 'Consulta el estado del servicio ssh.',
      hints: ['systemctl + acción + servicio.', 'systemctl status ssh', 'Escribe: systemctl status ssh'],
      solution: 'systemctl status ssh',
      check: ran('systemctl', (args) => args[0] === 'status'),
      success: '● verde y "active (running)": todo bien. Lo leerás miles de veces.',
      reward: rewardFor(2),
    },
    {
      id: 'linux-18-02',
      title: 'Arrancar y parar',
      difficulty: 2,
      teaches: [],
      briefing: [
        '`sudo systemctl start|stop|restart servicio` lo arranca, para o reinicia.',
        '`reload` recarga la configuración sin cortar conexiones (si el servicio lo admite).',
        'Alguien ha parado cron y ya no se ejecutan las tareas programadas.',
      ],
      objective: 'Arranca el servicio cron.',
      hints: ['La acción es start, y necesitas sudo.', 'sudo systemctl start cron', 'Escribe: sudo systemctl start cron'],
      setup: (world) => withMachine(world, (m) => stopService(world.fs, m, 'cron')),
      solution: 'sudo systemctl start cron',
      check: serviceActive('cron'),
      success: 'cron vuelve a estar activo.',
      reward: rewardFor(2),
    },
    {
      id: 'linux-18-03',
      title: 'Al arrancar el servidor',
      difficulty: 2,
      teaches: [],
      briefing: [
        'start lo arranca AHORA, pero si el servidor se reinicia no volverá solo.',
        '`sudo systemctl enable servicio` lo activa en el arranque. `disable` lo quita.',
        '`enable --now` hace las dos cosas a la vez.',
      ],
      objective: 'Haz que cron arranque automáticamente al iniciar el servidor.',
      hints: ['La acción es enable.', 'sudo systemctl enable cron', 'Escribe: sudo systemctl enable cron'],
      setup: (world) => withMachine(world, (m) => { if (m.services.cron) m.services.cron.enabled = false; }),
      solution: 'sudo systemctl enable cron',
      check: serviceEnabled('cron'),
      success: 'Enabled: sobrevivirá a los reinicios. "Lo arranqué pero tras reiniciar no estaba" = faltó enable.',
      reward: rewardFor(2),
    },
    {
      id: 'linux-18-04',
      title: 'Los logs de un servicio',
      difficulty: 3,
      teaches: ['journalctl'],
      briefing: [
        'systemd guarda los logs de todos los servicios en el journal. Se leen con `journalctl`:',
        '  `-u servicio` solo ese servicio   `-n 20` últimas 20 líneas   `-p err` solo errores',
        '  `-f` en directo   `--since "1 hour ago"` desde hace una hora',
      ],
      objective: 'Muestra los logs del servicio ssh.',
      hints: ['journalctl con -u.', 'journalctl -u ssh', 'Escribe: journalctl -u ssh'],
      solution: 'journalctl -u ssh',
      check: ran('journalctl', (args) => args.includes('-u') || args.some((a) => a.startsWith('--unit'))),
      success: 'Cuando un servicio falla, aquí está siempre el porqué.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-18-05',
      title: 'Diagnóstico',
      difficulty: 4,
      teaches: [],
      briefing: [
        'El servicio informes no arranca. El procedimiento de un profesional:',
        '  1) `systemctl status informes` → ¿qué dice?',
        '  2) `journalctl -u informes` → el mensaje de error exacto',
        '  3) corregir la causa y `sudo systemctl restart informes`',
      ],
      objective: 'Averigua por qué falla el servicio informes, corrígelo y déjalo funcionando.',
      hints: [
        'journalctl -u informes dice "Permission denied" al ejecutar el script.',
        'Al script /usr/local/bin/informes.sh le falta el permiso de ejecución.',
        'Escribe: sudo chmod +x /usr/local/bin/informes.sh && sudo systemctl restart informes',
      ],
      setup: (world) => {
        rootScript(world, '/usr/local/bin/informes.sh', '#!/bin/bash\nwhile true; do date >> /var/log/informes.log; sleep 60; done\n', 0o644);
        plantFiles(world, { '/etc/systemd/system/informes.service': '[Unit]\nDescription=Generador de informes\n\n[Service]\nExecStart=/usr/local/bin/informes.sh\nRestart=on-failure\n\n[Install]\nWantedBy=multi-user.target\n' });
        withMachine(world, (m) => {
          m.loadedUnits = { ...m.loadedUnits, 'informes.service': String(hashUnit(world.fs.privileged(() => world.fs.readFile('/etc/systemd/system/informes.service')))) };
          m.services.informes = { active: false, enabled: true, since: world.fs.now(), failed: 'Main process exited, code=exited, status=203/EXEC' };
          m.journal.push({ time: world.fs.now() - 60_000, unit: 'informes', priority: 3, message: 'informes.service: Failed to execute /usr/local/bin/informes.sh: Permission denied' });
          m.journal.push({ time: world.fs.now() - 60_000, unit: 'informes', priority: 3, message: 'informes.service: Main process exited, code=exited, status=203/EXEC' });
          m.processes = m.processes.filter((p) => p.service !== 'informes');
        });
      },
      solution: 'sudo chmod +x /usr/local/bin/informes.sh && sudo systemctl restart informes',
      check: serviceActive('informes'),
      success: 'status=203/EXEC = "no puedo ejecutar el programa". Ahora ya sabes leerlo.',
      reward: rewardFor(4),
    },
    {
      id: 'linux-18-06',
      title: 'JEFE: Tu script como servicio',
      difficulty: 5,
      boss: true,
      teaches: [],
      briefing: [
        '⚠ Hay un monitor casero en /usr/local/bin/latido.sh. Hay que convertirlo en un servicio de verdad:',
        '  · /etc/systemd/system/latido.service con [Unit] Description, [Service] ExecStart y Restart=always,',
        '    y [Install] WantedBy=multi-user.target',
        '  · `sudo systemctl daemon-reload` para que systemd lo conozca',
        '  · activo AHORA y al arrancar: `sudo systemctl enable --now latido`',
      ],
      objective: 'Crea latido.service (Restart=always), recarga systemd y déjalo activo y habilitado.',
      hints: [
        'Escribe el archivo con sudo nano o con printf ... | sudo tee.',
        "printf '[Unit]\\nDescription=Latido\\n[Service]\\nExecStart=/usr/local/bin/latido.sh\\nRestart=always\\n[Install]\\nWantedBy=multi-user.target\\n' | sudo tee /etc/systemd/system/latido.service",
        "Escribe: printf '[Unit]\\nDescription=Latido\\n[Service]\\nExecStart=/usr/local/bin/latido.sh\\nRestart=always\\n[Install]\\nWantedBy=multi-user.target\\n' | sudo tee /etc/systemd/system/latido.service && sudo systemctl daemon-reload && sudo systemctl enable --now latido",
      ],
      setup: (world) => {
        removeUnit(world, 'latido');
        rootScript(world, '/usr/local/bin/latido.sh', '#!/bin/bash\nwhile true; do logger -t latido "sigo vivo"; sleep 30; done\n');
      },
      solution: "printf '[Unit]\\nDescription=Latido\\n[Service]\\nExecStart=/usr/local/bin/latido.sh\\nRestart=always\\n[Install]\\nWantedBy=multi-user.target\\n' | sudo tee /etc/systemd/system/latido.service && sudo systemctl daemon-reload && sudo systemctl enable --now latido",
      check: all(
        systemFileMatches('/etc/systemd/system/latido.service', /ExecStart=\/usr\/local\/bin\/latido\.sh/),
        systemFileMatches('/etc/systemd/system/latido.service', /Restart=always/),
        systemFileMatches('/etc/systemd/system/latido.service', /WantedBy=multi-user\.target/),
        serviceActive('latido'), serviceEnabled('latido'),
      ),
      success: 'Tu script es ahora un servicio: arranca con el servidor y systemd lo resucita si se cae.',
      reward: rewardFor(5, true),
    },
  ],
};

/** Mismo hash que usa systemctl daemon-reload (para simular una unidad ya cargada). */
function hashUnit(text: string): number {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h;
}
