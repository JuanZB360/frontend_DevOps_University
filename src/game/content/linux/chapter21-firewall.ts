/**
 * Capítulo 21 — Firewall y seguridad.
 * ufw, iptables y fail2ban.
 */
import { ruleCovers } from '../../../engine/commands/security/firewall';
import { installFiles } from '../../../engine/commands/packages/apt';
import { findPackage } from '../../../engine/system/packages';
import { rewardFor, type Chapter, type MissionWorld } from '../../domain/curriculum';
import { all, machine, packageInstalled, ran, serviceActive } from '../../missions/checks';
import { aptReady, withMachine } from '../../missions/worldHelpers';

/** Atacante con más intentos fallidos en auth.log. */
export const TOP_ATTACKER = '185.220.101.47';

/** Cortafuegos de fábrica: inactivo y sin reglas. */
function resetFirewall(world: MissionWorld): void {
  withMachine(world, (m) => {
    m.firewall.ufwEnabled = false;
    m.firewall.rules = [];
    m.firewall.defaultIncoming = 'allow';
    m.firewall.defaultOutgoing = 'allow';
  });
}

const allowsPort = (port: number) => machine((m) => m.firewall.rules.some((r) => r.direction === 'in' && (r.action === 'allow' || r.action === 'limit') && r.from === 'Anywhere' && ruleCovers(r, port)));

export const chapter21: Chapter = {
  id: 'linux-21',
  number: 21,
  title: 'Firewall y seguridad',
  description: 'Cierra todas las puertas que no uses y vigila las que dejes abiertas.',
  missions: [
    {
      id: 'linux-21-01',
      title: 'Estado del cortafuegos',
      difficulty: 1,
      teaches: ['ufw'],
      briefing: [
        'Ubuntu trae `ufw` (Uncomplicated FireWall): una forma sencilla de controlar el cortafuegos del kernel.',
        '`sudo ufw status verbose` muestra si está activo, sus políticas por defecto y sus reglas.',
      ],
      objective: 'Consulta el estado del cortafuegos.',
      hints: ['ufw status, con sudo.', 'sudo ufw status verbose', 'Escribe: sudo ufw status verbose'],
      setup: (world) => resetFirewall(world),
      solution: 'sudo ufw status verbose',
      check: ran('ufw', (args) => args[0] === 'status'),
      success: 'Status: inactive. Ahora mismo cualquier puerto abierto es accesible desde Internet.',
      reward: rewardFor(1),
    },
    {
      id: 'linux-21-02',
      title: 'Por defecto: cerrado',
      difficulty: 3,
      teaches: [],
      briefing: [
        'La política segura: denegar TODO lo que entra y permitir solo lo necesario.',
        '`sudo ufw default deny incoming` y `sudo ufw default allow outgoing`.',
        '(Aún no se activa: primero configuraremos las excepciones.)',
      ],
      objective: 'Establece las políticas por defecto: denegar entrante y permitir saliente.',
      hints: ['ufw default + política + dirección.', 'sudo ufw default deny incoming && sudo ufw default allow outgoing', 'Escribe: sudo ufw default deny incoming && sudo ufw default allow outgoing'],
      setup: (world) => resetFirewall(world),
      solution: 'sudo ufw default deny incoming && sudo ufw default allow outgoing',
      check: machine((m) => m.firewall.defaultIncoming === 'deny' && m.firewall.defaultOutgoing === 'allow'),
      success: 'Base segura. Ahora abramos solo lo imprescindible.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-21-03',
      title: 'Las excepciones',
      difficulty: 3,
      teaches: [],
      briefing: [
        '`sudo ufw allow 22/tcp` (o `ufw allow OpenSSH`) permite SSH.',
        'Para una web: 80 (HTTP) y 443 (HTTPS): `sudo ufw allow 80,443/tcp`',
        '⚠ SSH SIEMPRE antes de activar el cortafuegos, o te quedarás fuera de tu propio servidor.',
      ],
      objective: 'Permite SSH (22), HTTP (80) y HTTPS (443).',
      hints: ['Dos reglas: una para SSH y otra para la web.', 'sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp', 'Escribe: sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp'],
      setup: (world) => withMachine(world, (m) => { m.firewall.rules = []; m.firewall.ufwEnabled = false; }),
      solution: 'sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp',
      check: all(allowsPort(22), allowsPort(80), allowsPort(443)),
      success: 'Tres puertas abiertas, todas las demás cerradas.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-21-04',
      title: 'Activar',
      difficulty: 3,
      teaches: [],
      briefing: [
        '`sudo ufw enable` lo activa (pregunta si quieres continuar: responde y).',
        'En scripts: `sudo ufw --force enable`.',
        'Comprueba después con `sudo ufw status`.',
      ],
      objective: 'Activa el cortafuegos (con SSH permitido).',
      hints: ['ufw enable, con sudo.', 'sudo ufw enable (y responde y)', 'Escribe: sudo ufw --force enable'],
      setup: (world) => withMachine(world, (m) => {
        m.firewall.ufwEnabled = false;
        if (!m.firewall.rules.some((r) => ruleCovers(r, 22))) m.firewall.rules.push({ action: 'allow', to: 'OpenSSH', from: 'Anywhere', direction: 'in' });
      }),
      solution: 'sudo ufw --force enable',
      check: all(machine((m) => m.firewall.ufwEnabled), allowsPort(22)),
      success: 'Cortafuegos activo y SSH a salvo.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-21-05',
      title: 'Cerrar el paso a una IP',
      difficulty: 4,
      teaches: ['iptables'],
      briefing: [
        'En auth.log viste miles de intentos de entrar. Averigua qué IP lo intenta más y bloquéala:',
        '  `sudo ufw deny from IP`',
        'Debajo de ufw está iptables (las reglas reales del kernel): `sudo iptables -L -n` las muestra.',
      ],
      objective: 'Bloquea con ufw la IP que más intentos fallidos tiene en /var/log/auth.log.',
      hints: [
        "grep 'Failed password' /var/log/auth.log | awk '{print $(NF-3)}' | sort | uniq -c | sort -rn | head -1",
        `La IP con más intentos es ${TOP_ATTACKER}.`,
        `Escribe: sudo ufw deny from ${TOP_ATTACKER}`,
      ],
      solution: `sudo ufw deny from ${TOP_ATTACKER}`,
      check: machine((m) => m.firewall.rules.some((r) => (r.action === 'deny' || r.action === 'reject') && r.from === TOP_ATTACKER)),
      success: 'Atacante bloqueado. Pero mañana vendrá otro... necesitamos automatizarlo.',
      reward: rewardFor(4),
    },
    {
      id: 'linux-21-06',
      title: 'Guardia automático',
      difficulty: 3,
      teaches: ['fail2ban-client'],
      briefing: [
        '`fail2ban` vigila los logs y BLOQUEA automáticamente las IPs que fallan demasiadas contraseñas.',
        'Instálalo y comprueba la "jaula" de SSH: `sudo fail2ban-client status sshd`.',
        'Su configuración se cambia en /etc/fail2ban/jail.local (nunca en jail.conf).',
      ],
      objective: 'Instala fail2ban y consulta el estado de la jaula sshd.',
      hints: ['apt install y luego fail2ban-client status sshd.', 'sudo apt install -y fail2ban', 'Escribe: sudo apt install -y fail2ban && sudo fail2ban-client status sshd'],
      setup: (world) => aptReady(world),
      solution: 'sudo apt install -y fail2ban && sudo fail2ban-client status sshd',
      check: all(packageInstalled('fail2ban'), serviceActive('fail2ban'), ran('fail2ban-client')),
      success: 'Ahora el servidor se defiende solo.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-21-07',
      title: 'JEFE: Bloquea al atacante',
      difficulty: 5,
      boss: true,
      teaches: [],
      briefing: [
        '⚠ Ataque de fuerza bruta en curso contra SSH. Contramedidas:',
        '  1) Banea con fail2ban (jaula sshd) la IP con MÁS intentos fallidos de auth.log',
        '  2) Limita las conexiones a SSH en ufw: `sudo ufw limit OpenSSH` (bloquea a quien abre más de 6 conexiones en 30 s)',
        '  3) El cortafuegos debe quedar activo',
      ],
      objective: 'Banea al atacante principal con fail2ban, limita SSH en ufw y deja el cortafuegos activo.',
      hints: [
        'Primero identifica la IP con grep/awk/sort/uniq sobre /var/log/auth.log.',
        `sudo fail2ban-client set sshd banip ${TOP_ATTACKER}`,
        `Escribe: sudo fail2ban-client set sshd banip ${TOP_ATTACKER} && sudo ufw limit OpenSSH && sudo ufw --force enable`,
      ],
      setup: (world) => {
        aptReady(world);
        withMachine(world, (m) => {
          if (m.packages.fail2ban?.status !== 'installed') installFiles(world.fs, m, findPackage('fail2ban')!);
          m.firewall.banned = {};
        });
      },
      solution: `sudo fail2ban-client set sshd banip ${TOP_ATTACKER} && sudo ufw limit OpenSSH && sudo ufw --force enable`,
      check: all(
        machine((m) => (m.firewall.banned.sshd ?? []).includes(TOP_ATTACKER)),
        machine((m) => m.firewall.rules.some((r) => r.action === 'limit' && ruleCovers(r, 22))),
        machine((m) => m.firewall.ufwEnabled),
      ),
      success: 'Ataque neutralizado con tres capas de defensa. Esto es "defensa en profundidad".',
      reward: rewardFor(5, true),
    },
  ],
};
