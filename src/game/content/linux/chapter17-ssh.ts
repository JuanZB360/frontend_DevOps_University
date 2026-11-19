/**
 * Capítulo 17 — SSH.
 * Claves, ssh-copy-id, conexión, permisos de ~/.ssh, scp/rsync y endurecer sshd.
 */
import { findUser } from '../../../engine/system/accounts';
import { parseSshdConfig, SSHD_CONFIG_DEFAULT } from '../../../engine/system/sshd';
import { rewardFor, type Chapter, type MissionCheck, type MissionWorld } from '../../domain/curriculum';
import { all, any, isFile, machine, modeIs, ownedBy, ran, sessionUserIs } from '../../missions/checks';
import { ensureUser, plantFiles, withMachine } from '../../missions/worldHelpers';

/** El jugador tiene par de claves (lo crea si no). */
function ensureKeys(world: MissionWorld): string {
  const home = world.session.home;
  const pub = `${home}/.ssh/id_ed25519.pub`;
  if (!world.fs.exists(pub)) {
    world.fs.mkdir(`${home}/.ssh`, true);
    world.fs.chmod(`${home}/.ssh`, 0o700);
    world.fs.writeFile(`${home}/.ssh/id_ed25519`, '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAAsimulada\n-----END OPENSSH PRIVATE KEY-----\n');
    world.fs.chmod(`${home}/.ssh/id_ed25519`, 0o600);
    world.fs.writeFile(pub, `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDevopsUniversity${world.session.username} ${world.session.username}@devops-u\n`);
  }
  return world.fs.readFile(pub).trim();
}

/** Instala la clave del jugador en el authorized_keys de `user` (con los permisos indicados). */
function authorize(world: MissionWorld, user: string, keyMode = 0o600): void {
  const key = ensureKeys(world);
  const home = findUser(world.fs, user)!.home;
  world.fs.privileged(() => {
    world.fs.mkdir(`${home}/.ssh`, true);
    world.fs.writeFile(`${home}/.ssh/authorized_keys`, key + '\n');
    world.fs.chown(`${home}/.ssh`, user, user);
    world.fs.chown(`${home}/.ssh/authorized_keys`, user, user);
    world.fs.chmod(`${home}/.ssh`, 0o700);
    world.fs.chmod(`${home}/.ssh/authorized_keys`, keyMode);
  });
}

/** authorized_keys de `user` contiene la clave pública de otro usuario del sistema (el jugador). */
const keyInstalledFor = (user: string): MissionCheck => (ctx) => ctx.fs.privileged(() => {
  const home = findUser(ctx.fs, user)?.home;
  if (!home || !ctx.fs.exists(`${home}/.ssh/authorized_keys`)) return false;
  const keys = ctx.fs.readFile(`${home}/.ssh/authorized_keys`);
  return ctx.fs.readDir('/home').some((dir) => {
    const pub = `/home/${dir.name}/.ssh/id_ed25519.pub`;
    if (dir.name === user || !ctx.fs.exists(pub)) return false;
    const body = ctx.fs.readFile(pub).trim().split(/\s+/)[1];
    return body !== undefined && keys.includes(body);
  });
});

/** Restaura sshd_config a la configuración por defecto (y el servidor la aplica). */
function defaultSshd(world: MissionWorld): void {
  world.fs.privileged(() => world.fs.writeFile('/etc/ssh/sshd_config', SSHD_CONFIG_DEFAULT));
  withMachine(world, (m) => {
    m.sshdConfig = SSHD_CONFIG_DEFAULT;
    m.services.ssh = { active: true, enabled: true, since: world.fs.now() };
    if (!m.processes.some((p) => p.service === 'ssh')) {
      m.processes.push({ pid: 812, ppid: 1, user: 'root', command: 'sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups', cpu: 0, mem: 0.2, rss: 7_900, state: 'S', nice: 0, start: world.fs.now(), tty: '?', ports: [22], service: 'ssh' });
    }
  });
}

export const chapter17: Chapter = {
  id: 'linux-17',
  number: 17,
  title: 'SSH',
  description: 'La puerta de entrada a cualquier servidor. Aprende a usarla... y a blindarla.',
  missions: [
    {
      id: 'linux-17-01',
      title: 'Tu par de claves',
      difficulty: 2,
      teaches: ['ssh-keygen'],
      briefing: [
        'SSH puede usar contraseñas, pero lo profesional son las CLAVES:',
        '  · clave PRIVADA (~/.ssh/id_ed25519): nunca sale de tu equipo',
        '  · clave PÚBLICA (~/.ssh/id_ed25519.pub): la copias a los servidores',
        '`ssh-keygen -t ed25519` crea el par (Enter para aceptar la ruta; la frase de paso es opcional).',
      ],
      objective: 'Genera un par de claves ed25519 en la ruta por defecto.',
      hints: ['El comando genera claves ("key gen") de SSH.', 'ssh-keygen -t ed25519', "Escribe: ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ''"],
      setup: (world) => {
        const home = world.session.home;
        for (const f of ['id_ed25519', 'id_ed25519.pub']) if (world.fs.exists(`${home}/.ssh/${f}`)) world.fs.remove(`${home}/.ssh/${f}`);
      },
      solution: "ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ''",
      check: all(isFile('~/.ssh/id_ed25519'), isFile('~/.ssh/id_ed25519.pub'), modeIs('~/.ssh/id_ed25519', 0o600)),
      success: 'Fíjate: la privada tiene permisos 600. Si la compartes, es como regalar las llaves de tu casa.',
      reward: rewardFor(2),
    },
    {
      id: 'linux-17-02',
      title: 'Entregar la llave',
      difficulty: 3,
      teaches: ['ssh-copy-id'],
      briefing: [
        'Para entrar con tu clave, tu pública debe estar en ~/.ssh/authorized_keys del usuario destino.',
        '`ssh-copy-id deploy@localhost` lo hace por ti (te pide UNA vez la contraseña de deploy: deploy123).',
        'A mano sería: añadir la .pub a /home/deploy/.ssh/authorized_keys con dueño deploy y permisos 700/600.',
      ],
      objective: 'Instala tu clave pública en la cuenta deploy de este servidor (contraseña: deploy123).',
      hints: ['ssh-copy-id usuario@host', 'ssh-copy-id deploy@localhost (contraseña deploy123)', 'Escribe: ssh-copy-id deploy@localhost'],
      setup: (world) => {
        ensureKeys(world);
        ensureUser(world, 'deploy', { password: 'deploy123' });
        defaultSshd(world);
        world.fs.privileged(() => {
          const file = '/home/deploy/.ssh/authorized_keys';
          if (world.fs.exists(file)) world.fs.remove(file);
        });
      },
      solution: 'sudo mkdir -p /home/deploy/.ssh && cat ~/.ssh/id_ed25519.pub | sudo tee -a /home/deploy/.ssh/authorized_keys && sudo chown -R deploy:deploy /home/deploy/.ssh && sudo chmod 700 /home/deploy/.ssh && sudo chmod 600 /home/deploy/.ssh/authorized_keys',
      check: keyInstalledFor('deploy'),
      success: 'Clave instalada. A partir de ahora deploy no necesitará contraseña desde tu cuenta.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-17-03',
      title: 'Conectar',
      difficulty: 2,
      teaches: ['ssh'],
      briefing: [
        '`ssh usuario@servidor` abre una sesión remota. Si la clave está instalada, entras sin contraseña.',
        'Con `ssh usuario@servidor comando` ejecutas solo ese comando y vuelves.',
        'Para salir de la sesión remota: `exit`.',
      ],
      objective: 'Conéctate por SSH como deploy a localhost.',
      hints: ['ssh usuario@host', 'ssh deploy@localhost', 'Escribe: ssh deploy@localhost whoami'],
      setup: (world) => {
        ensureUser(world, 'deploy', { password: 'deploy123' });
        defaultSshd(world);
        authorize(world, 'deploy');
      },
      solution: 'ssh deploy@localhost whoami',
      check: any(sessionUserIs('deploy'), (ctx) => ctx.report.commands.some((c) => c.name === 'whoami' && c.user === 'deploy')),
      success: 'Dentro sin contraseña. Si sigues como deploy, escribe exit para volver.',
      reward: rewardFor(2),
    },
    {
      id: 'linux-17-04',
      title: 'Permisos demasiado abiertos',
      difficulty: 4,
      teaches: [],
      briefing: [
        '(Si el prompt dice deploy@..., escribe exit primero.)',
        'SSH es paranoico (y hace bien): si authorized_keys lo puede modificar alguien más, IGNORA la clave.',
        'Alguien puso permisos 666 al authorized_keys de deploy y ahora pide contraseña.',
        'Permisos correctos: ~/.ssh 700 y authorized_keys 600, dueño el propio usuario.',
      ],
      objective: 'Arregla los permisos de /home/deploy/.ssh/authorized_keys para que vuelva a funcionar la clave.',
      hints: ['chmod 600 al archivo (como root).', 'sudo chmod 600 /home/deploy/.ssh/authorized_keys', 'Escribe: sudo chmod 600 /home/deploy/.ssh/authorized_keys'],
      setup: (world) => {
        ensureUser(world, 'deploy', { password: 'deploy123' });
        defaultSshd(world);
        authorize(world, 'deploy', 0o666);
      },
      solution: 'sudo chmod 600 /home/deploy/.ssh/authorized_keys',
      check: all(modeIs('/home/deploy/.ssh/authorized_keys', 0o600), ownedBy('/home/deploy/.ssh/authorized_keys', 'deploy')),
      success: 'Arreglado. "Me sigue pidiendo contraseña" casi siempre es esto: permisos o dueño de ~/.ssh.',
      reward: rewardFor(4),
    },
    {
      id: 'linux-17-05',
      title: 'Copiar por SSH',
      difficulty: 3,
      teaches: ['scp', 'rsync'],
      briefing: [
        '`scp archivo usuario@host:ruta` copia archivos a otro servidor por SSH.',
        '`rsync -av origen/ usuario@host:destino/` sincroniza directorios y solo envía lo que cambió.',
        'Sin ruta tras los ":" se copia al home del usuario remoto.',
      ],
      objective: 'Copia ~/release.tar.gz al home de deploy en localhost usando scp.',
      hints: ['scp origen usuario@host:', 'scp ~/release.tar.gz deploy@localhost:', 'Escribe: scp ~/release.tar.gz deploy@localhost:'],
      setup: (world) => {
        ensureUser(world, 'deploy', { password: 'deploy123' });
        defaultSshd(world);
        authorize(world, 'deploy');
        plantFiles(world, { '~/release.tar.gz': 'paquete v2.4.1\n' });
        world.fs.privileged(() => world.fs.exists('/home/deploy/release.tar.gz') && world.fs.remove('/home/deploy/release.tar.gz'));
      },
      solution: 'scp ~/release.tar.gz deploy@localhost:',
      check: all(isFile('/home/deploy/release.tar.gz'), ownedBy('/home/deploy/release.tar.gz', 'deploy')),
      success: 'Copiado y con el dueño correcto (deploy). Así se suben versiones a producción.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-17-06',
      title: 'JEFE: Acceso solo con llave, sin root',
      difficulty: 5,
      boss: true,
      teaches: ['sshd', 'systemctl'],
      briefing: [
        '⚠ Los bots prueban contraseñas contra tu SSH las 24 h (lo viste en auth.log). Hay que blindarlo.',
        'En /etc/ssh/sshd_config:',
        '  `PermitRootLogin no`           → nadie entra directamente como root',
        '  `PasswordAuthentication no`    → solo claves, nada de contraseñas',
        'Después: `sudo sshd -t` (comprueba la sintaxis) y `sudo systemctl restart ssh` (aplica).',
        '⚠ Antes de quitar las contraseñas, asegúrate de que tu clave funciona (deploy ya la tiene).',
      ],
      objective: 'Desactiva el login de root y las contraseñas en SSH, comprueba la configuración y reinicia el servicio.',
      hints: [
        'Edita sshd_config con nano (o sed -i) para cambiar esas dos líneas.',
        "sudo sed -i 's/^PermitRootLogin .*/PermitRootLogin no/; s/^PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config",
        "Escribe: sudo sed -i 's/^PermitRootLogin .*/PermitRootLogin no/; s/^PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config && sudo sshd -t && sudo systemctl restart ssh",
      ],
      setup: (world) => {
        ensureUser(world, 'deploy', { password: 'deploy123' });
        defaultSshd(world);
        authorize(world, 'deploy');
      },
      solution: "sudo sed -i 's/^PermitRootLogin .*/PermitRootLogin no/; s/^PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config && sudo sshd -t && sudo systemctl restart ssh",
      check: all(
        machine((m) => {
          const active = parseSshdConfig(m.sshdConfig ?? '');
          return active.permitRootLogin === 'no' && !active.passwordAuthentication && m.services.ssh?.active === true;
        }),
        keyInstalledFor('deploy'),
        ran('systemctl'),
      ),
      success: 'SSH blindado: sin root y sin contraseñas. Los bots de auth.log ya no tienen nada que probar.',
      reward: rewardFor(5, true),
    },
  ],
};
