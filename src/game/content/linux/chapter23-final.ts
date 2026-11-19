/**
 * Capítulo final de Linux — JEFE FINAL: Servidor de producción.
 * Un VPS recién comprado → endurecido, actualizado, vigilado y con copias.
 */
import { ruleCovers } from '../../../engine/commands/security/firewall';
import { findUser } from '../../../engine/system/accounts';
import { readMachine } from '../../../engine/system/machine';
import { parseSshdConfig, SSHD_CONFIG_DEFAULT } from '../../../engine/system/sshd';
import { rewardFor, type Chapter, type MissionCheck, type MissionWorld } from '../../domain/curriculum';
import { all, hasFullSudoRights, inGroup, machine, packageInstalled, ran, serviceActive, systemFileMatches, userShellIs } from '../../missions/checks';
import { aptReady, removeUser, withMachine } from '../../missions/worldHelpers';

const OPERATOR = 'operador';

/** La clave pública del jugador está en el authorized_keys de operador, con permisos correctos. */
const operatorKey: MissionCheck = (ctx) => ctx.fs.privileged(() => {
  const home = findUser(ctx.fs, OPERATOR)?.home;
  if (!home) return false;
  const file = `${home}/.ssh/authorized_keys`;
  const dir = `${home}/.ssh`;
  if (!ctx.fs.exists(file)) return false;
  const keys = ctx.fs.readFile(file);
  const fileNode = ctx.fs.stat(file);
  const dirNode = ctx.fs.stat(dir);
  if ((fileNode.mode & 0o077) !== 0 || (dirNode.mode & 0o077) !== 0 || fileNode.owner !== OPERATOR) return false;
  return ctx.fs.readDir('/home').some((d) => {
    const pub = `/home/${d.name}/.ssh/id_ed25519.pub`;
    return d.name !== OPERATOR && ctx.fs.exists(pub) && keys.includes(ctx.fs.readFile(pub).trim().split(/\s+/)[1] ?? '#');
  });
});

const sshHardened: MissionCheck = machine((m) => {
  const c = parseSshdConfig(m.sshdConfig ?? '');
  return c.permitRootLogin === 'no' && !c.passwordAuthentication && m.services.ssh?.active === true;
});

const firewallReady: MissionCheck = machine((m) => {
  const fw = m.firewall;
  const allowed = (port: number): boolean => fw.rules.some((r) => r.direction === 'in' && (r.action === 'allow' || r.action === 'limit') && ruleCovers(r, port));
  return fw.ufwEnabled && fw.defaultIncoming === 'deny' && allowed(22) && allowed(80) && allowed(443);
});

const rootCron = (pattern: RegExp): MissionCheck => (ctx) => ctx.fs.privileged(() => {
  const path = '/var/spool/cron/crontabs/root';
  return ctx.fs.exists(path) && ctx.fs.readFile(path).split('\n').some((l) => !l.startsWith('#') && pattern.test(l));
});

const backupReady: MissionCheck = all(
  systemFileMatches('/usr/local/bin/backup.sh', /tar\s+\S*c\S*/),
  (ctx) => ctx.fs.privileged(() => ((ctx.fs.tryStat('/usr/local/bin/backup.sh')?.mode ?? 0) & 0o100) !== 0),
  rootCron(/^\s*\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\/usr\/local\/bin\/backup\.sh/),
);

const operatorReady: MissionCheck = all(userShellIs(OPERATOR, '/bin/bash'), inGroup(OPERATOR, 'sudo'), hasFullSudoRights(OPERATOR), operatorKey);

/** VPS recién entregado: todo por defecto y sin endurecer. */
function freshVps(world: MissionWorld): void {
  removeUser(world, OPERATOR);
  world.fs.privileged(() => {
    world.fs.writeFile('/etc/ssh/sshd_config', SSHD_CONFIG_DEFAULT);
    for (const path of ['/usr/local/bin/backup.sh', '/var/spool/cron/crontabs/root']) if (world.fs.exists(path)) world.fs.remove(path);
  });
  withMachine(world, (m) => {
    m.sshdConfig = SSHD_CONFIG_DEFAULT;
    m.firewall = { ...m.firewall, ufwEnabled: false, rules: [], defaultIncoming: 'allow', defaultOutgoing: 'allow', banned: {} };
    m.aptUpdatedAt = null;
    if (m.packages.git) m.packages.git.version = '1:2.43.0-1ubuntu7';
  });
}

export const chapter23: Chapter = {
  id: 'linux-23',
  number: 23,
  title: 'JEFE FINAL: Servidor de producción',
  description: 'Te entregan un VPS recién creado. Mañana saldrá a Internet con datos reales. Prepáralo.',
  missions: [
    {
      id: 'linux-23-01',
      title: 'Fase 1: el administrador',
      difficulty: 4,
      boss: true,
      teaches: [],
      briefing: [
        '══ MISIÓN FINAL DE LINUX ══',
        'El servidor está "de fábrica": root entra con contraseña, sin cortafuegos ni copias. Lo vas a dejar listo para producción.',
        'Fase 1: nadie debe trabajar como root. Crea la cuenta del administrador:',
        `  · usuario ${OPERATOR} con home y /bin/bash, miembro del grupo sudo`,
        `  · tu clave pública en /home/${OPERATOR}/.ssh/authorized_keys (dueño ${OPERATOR}, permisos 700/600)`,
      ],
      objective: `Crea ${OPERATOR} (bash, grupo sudo) e instala tu clave SSH en su cuenta con los permisos correctos.`,
      hints: [
        'useradd -m -s /bin/bash -G sudo; después copia tu .pub a su authorized_keys y ajusta dueño y permisos.',
        `sudo useradd -m -s /bin/bash -G sudo ${OPERATOR} && sudo mkdir -p /home/${OPERATOR}/.ssh && cat ~/.ssh/id_ed25519.pub | sudo tee /home/${OPERATOR}/.ssh/authorized_keys`,
        `Escribe: sudo useradd -m -s /bin/bash -G sudo ${OPERATOR} && sudo mkdir -p /home/${OPERATOR}/.ssh && cat ~/.ssh/id_ed25519.pub | sudo tee /home/${OPERATOR}/.ssh/authorized_keys && sudo chown -R ${OPERATOR}:${OPERATOR} /home/${OPERATOR}/.ssh && sudo chmod 700 /home/${OPERATOR}/.ssh && sudo chmod 600 /home/${OPERATOR}/.ssh/authorized_keys`,
      ],
      setup: (world) => {
        freshVps(world);
        const home = world.session.home;
        if (!world.fs.exists(`${home}/.ssh/id_ed25519.pub`)) {
          world.fs.mkdir(`${home}/.ssh`, true);
          world.fs.writeFile(`${home}/.ssh/id_ed25519.pub`, `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFinal${world.session.username} ${world.session.username}@devops-u\n`);
        }
      },
      solution: `sudo useradd -m -s /bin/bash -G sudo ${OPERATOR} && sudo mkdir -p /home/${OPERATOR}/.ssh && cat ~/.ssh/id_ed25519.pub | sudo tee /home/${OPERATOR}/.ssh/authorized_keys && sudo chown -R ${OPERATOR}:${OPERATOR} /home/${OPERATOR}/.ssh && sudo chmod 700 /home/${OPERATOR}/.ssh && sudo chmod 600 /home/${OPERATOR}/.ssh/authorized_keys`,
      check: operatorReady,
      success: 'Fase 1 completa: un administrador con nombre propio, sudo y acceso por clave.',
      reward: rewardFor(4, true),
    },
    {
      id: 'linux-23-02',
      title: 'Fase 2: blindar SSH',
      difficulty: 4,
      boss: true,
      teaches: [],
      briefing: [
        'Fase 2: cierra la puerta a los bots.',
        '  · PermitRootLogin no   · PasswordAuthentication no',
        '  · comprueba con sshd -t y aplica reiniciando ssh',
      ],
      objective: 'Desactiva el login de root y las contraseñas en SSH y aplica la configuración.',
      hints: [
        'sed -i sobre /etc/ssh/sshd_config, después sshd -t y systemctl restart ssh.',
        "sudo sed -i 's/^PermitRootLogin .*/PermitRootLogin no/; s/^PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config",
        "Escribe: sudo sed -i 's/^PermitRootLogin .*/PermitRootLogin no/; s/^PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config && sudo sshd -t && sudo systemctl restart ssh",
      ],
      solution: "sudo sed -i 's/^PermitRootLogin .*/PermitRootLogin no/; s/^PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config && sudo sshd -t && sudo systemctl restart ssh",
      check: sshHardened,
      success: 'Fase 2 completa: SSH solo con claves y sin root.',
      reward: rewardFor(4, true),
    },
    {
      id: 'linux-23-03',
      title: 'Fase 3: cortafuegos',
      difficulty: 4,
      boss: true,
      teaches: [],
      briefing: [
        'Fase 3: solo deben estar abiertos SSH, HTTP y HTTPS.',
        '  · política por defecto: denegar lo entrante',
        '  · permitir 22 (mejor con limit), 80 y 443',
        '  · cortafuegos activado',
      ],
      objective: 'Configura y activa ufw: deny incoming, SSH (limit), 80 y 443.',
      hints: [
        'ufw default deny incoming; ufw limit OpenSSH; ufw allow 80,443/tcp; ufw enable.',
        'sudo ufw default deny incoming && sudo ufw limit OpenSSH && sudo ufw allow 80,443/tcp',
        'Escribe: sudo ufw default deny incoming && sudo ufw default allow outgoing && sudo ufw limit OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw --force enable',
      ],
      solution: 'sudo ufw default deny incoming && sudo ufw default allow outgoing && sudo ufw limit OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw --force enable',
      check: firewallReady,
      success: 'Fase 3 completa: tres puertas y un portero.',
      reward: rewardFor(4, true),
    },
    {
      id: 'linux-23-04',
      title: 'Fase 4: parches y guardia',
      difficulty: 4,
      boss: true,
      teaches: [],
      briefing: [
        'Fase 4: un servidor sin actualizar es un servidor hackeado.',
        '  · actualiza el índice y todos los paquetes',
        '  · instala fail2ban y comprueba que está activo',
      ],
      objective: 'Actualiza el sistema e instala fail2ban (activo).',
      hints: [
        'apt update, apt upgrade y apt install fail2ban, todo con -y.',
        'sudo apt update && sudo apt upgrade -y && sudo apt install -y fail2ban',
        'Escribe: sudo apt update && sudo apt upgrade -y && sudo apt install -y fail2ban',
      ],
      setup: (world) => aptReady(world),
      solution: 'sudo apt update && sudo apt upgrade -y && sudo apt install -y fail2ban',
      check: all(packageInstalled('fail2ban'), serviceActive('fail2ban'), machine((m) => m.packages.git?.version !== '1:2.43.0-1ubuntu7')),
      success: 'Fase 4 completa: al día y vigilado.',
      reward: rewardFor(4, true),
    },
    {
      id: 'linux-23-05',
      title: 'Fase 5: copias automáticas',
      difficulty: 5,
      boss: true,
      teaches: [],
      briefing: [
        'Fase 5: sin backups no hay producción.',
        '  · /usr/local/bin/backup.sh (ejecutable) que comprima /etc y /home en /backup/servidor-FECHA.tar.gz',
        '  · en el crontab de root, cada día a la hora que elijas, con la salida en /var/log/backup.log',
      ],
      objective: 'Crea /usr/local/bin/backup.sh y prográmalo a diario en el crontab de root.',
      hints: [
        "El script: #!/bin/bash + tar -czf /backup/servidor-$(date +%F).tar.gz /etc /home",
        "printf '#!/bin/bash\\ntar -czf /backup/servidor-$(date +%%F).tar.gz /etc /home\\n' | sudo tee /usr/local/bin/backup.sh && sudo chmod +x /usr/local/bin/backup.sh",
        "Escribe: printf '#!/bin/bash\\ntar -czf /backup/servidor-$(date +%%F).tar.gz /etc /home\\n' | sudo tee /usr/local/bin/backup.sh && sudo chmod +x /usr/local/bin/backup.sh && echo '30 3 * * * /usr/local/bin/backup.sh >> /var/log/backup.log 2>&1' | sudo crontab -",
      ],
      solution: "printf '#!/bin/bash\\ntar -czf /backup/servidor-$(date +%%F).tar.gz /etc /home\\n' | sudo tee /usr/local/bin/backup.sh && sudo chmod +x /usr/local/bin/backup.sh && echo '30 3 * * * /usr/local/bin/backup.sh >> /var/log/backup.log 2>&1' | sudo crontab -",
      check: backupReady,
      success: 'Fase 5 completa: cada noche, una copia.',
      reward: rewardFor(5, true),
    },
    {
      id: 'linux-23-06',
      title: 'Auditoría final',
      difficulty: 5,
      boss: true,
      teaches: [],
      briefing: [
        '══ AUDITORÍA FINAL ══',
        'El auditor comprobará TODO a la vez. Si algo se ha desconfigurado por el camino, arréglalo.',
        'Cuando creas que está listo, ejecuta el informe: `sudo ufw status verbose`',
      ],
      objective: 'Con todo en orden (operador, SSH, cortafuegos, fail2ban y backups), ejecuta sudo ufw status verbose.',
      hints: [
        'Revisa cada fase: id operador, sudo sshd -T, sudo ufw status, systemctl is-active fail2ban, sudo crontab -l.',
        'Si todo está bien, solo falta el informe.',
        'Escribe: sudo ufw status verbose',
      ],
      solution: 'sudo ufw status verbose',
      check: all(ran('ufw'), operatorReady, sshHardened, firewallReady, serviceActive('fail2ban'), backupReady, (ctx) => readMachine(ctx.fs).services.cron?.active !== false),
      success: '🏆 SERVIDOR DE PRODUCCIÓN APROBADO. Eres oficialmente ROOT: has dominado Linux. La siguiente carrera te espera: Nginx.',
      reward: rewardFor(5, true),
    },
  ],
};
