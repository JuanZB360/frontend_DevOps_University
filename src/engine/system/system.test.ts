import { describe, expect, it } from 'vitest';
import { createTestShell } from '../testing/createTestShell';
import { readMachine, updateMachine } from './machine';

describe('usuarios, sudo y su', () => {
  it('sudo ejecuta como root y crea usuarios con su home', async () => {
    const sh = createTestShell();
    expect((await sh.run('useradd ana')).output).toContain('Permission denied');
    expect((await sh.run('sudo whoami')).output).toBe('root\n');
    await sh.run('sudo useradd -m -s /bin/bash ana');
    expect((await sh.run('id ana')).output).toMatch(/^uid=1001\(ana\) gid=1001\(ana\) groups=1001\(ana\)\n$/);
    expect(sh.fs.isDirectory('/home/ana')).toBe(true);
    await sh.run('sudo groupadd devs && sudo usermod -aG devs ana');
    expect((await sh.run('groups ana')).output).toBe('ana : ana devs\n');
  });

  it('passwd y su piden contraseña; sudo -i abre una sesión de root y exit vuelve', async () => {
    const sh = createTestShell();
    await sh.run('sudo useradd -m -s /bin/bash ana');
    sh.answers.push('clave123', 'clave123');
    expect((await sh.run('sudo passwd ana')).output).toContain('updated successfully');
    sh.answers.push('mala');
    expect((await sh.run('su - ana')).output).toContain('Authentication failure');
    sh.answers.push('clave123');
    await sh.run('su - ana');
    expect(sh.session.username).toBe('ana');
    expect(sh.session.cwd).toBe('/home/ana');
    await sh.run('exit');
    expect(sh.session.username).toBe('neo');
    await sh.run('sudo -i');
    expect(sh.session.username).toBe('root');
    await sh.run('exit');
    expect(sh.session.username).toBe('neo');
  });

  it('sudoers con comandos limitados', async () => {
    const sh = createTestShell();
    await sh.run('sudo useradd -m ana');
    await sh.run("echo 'ana ALL=(ALL) NOPASSWD: /usr/bin/systemctl' | sudo tee /etc/sudoers.d/ana");
    sh.session.pushSession({ user: 'ana', groups: ['ana'], hostname: 'devops-u', cwd: '/home/ana', vars: { HOME: '/home/ana', USER: 'ana', PATH: '/usr/bin:/bin' } });
    expect((await sh.run('sudo whoami')).output).toContain('not allowed');
    expect((await sh.run('sudo systemctl is-active ssh')).output).toBe('active\n');
  });
});

describe('permisos', () => {
  it('chmod octal y simbólico, chown y umask', async () => {
    const sh = createTestShell();
    await sh.run('touch s.sh && chmod u+x,g-r s.sh');
    expect((await sh.run('stat -c %A s.sh')).output).toBe('-rwx---r--\n');
    await sh.run('chmod 640 s.sh');
    expect((await sh.run('stat -c %a s.sh')).output).toBe('640\n');
    expect((await sh.run('chown root s.sh')).output).toContain('Operation not permitted');
    await sh.run('sudo chown root:root s.sh');
    expect(sh.fs.stat('/home/neo/s.sh').owner).toBe('root');
    await sh.run('umask 077 && touch privado');
    expect((await sh.run('stat -c %a privado')).output).toBe('600\n');
    await sh.run('mkdir -p comun && chmod 1777 comun');
    expect((await sh.run('stat -c %A comun')).output).toBe('drwxrwxrwt\n');
  });
});

describe('procesos', () => {
  it('trabajos en segundo plano, ps y kill', async () => {
    const sh = createTestShell();
    const { output } = await sh.run('sleep 300 &');
    expect(output).toMatch(/^\[1\] \d+\n$/);
    expect((await sh.run('jobs')).output).toContain('sleep 300');
    expect((await sh.run('ps aux')).output).toContain('sleep 300');
    await sh.run('kill %1');
    expect((await sh.run('jobs')).output).toBe('');
  });

  it('no deja matar procesos de otros usuarios sin sudo', async () => {
    const sh = createTestShell();
    const pid = readMachine(sh.fs).processes.find((p) => p.command.includes('cron'))!.pid;
    expect((await sh.run(`kill ${pid}`)).output).toContain('Operation not permitted');
    await sh.run(`sudo kill -9 ${pid}`);
    expect(readMachine(sh.fs).processes.some((p) => p.pid === pid)).toBe(false);
    expect(readMachine(sh.fs).services.cron.active).toBe(false);
  });
});

describe('paquetes y servicios', () => {
  it('apt exige root y update; instala con dependencias y arranca el servicio', async () => {
    const sh = createTestShell();
    expect((await sh.run('apt install fail2ban')).output).toContain('are you root?');
    expect((await sh.run('sudo apt install -y fail2ban')).output).toContain('Unable to locate package');
    await sh.run('sudo apt update');
    await sh.run('sudo apt install -y fail2ban');
    expect((await sh.run('systemctl is-active fail2ban')).output).toBe('active\n');
    expect((await sh.run('dpkg -l fail2ban')).output).toMatch(/ii {2}fail2ban/);
    await sh.run('sudo apt remove -y fail2ban');
    expect((await sh.run('fail2ban-client status')).output).toContain('sudo apt install fail2ban');
  });

  it('un paquete roto bloquea apt hasta dpkg --configure -a', async () => {
    const sh = createTestShell();
    await sh.run('sudo apt update');
    updateMachine(sh.fs, (m) => { m.packages.htop = { version: '3.3.0', status: 'half-configured' }; });
    expect((await sh.run('sudo apt install -y jq')).output).toContain("dpkg --configure -a");
    await sh.run('sudo dpkg --configure -a');
    expect((await sh.run('sudo apt install -y jq')).report.exitCode).toBe(0);
  });

  it('unidades propias: daemon-reload, ExecStart y journal', async () => {
    const sh = createTestShell();
    sh.fs.writeFile('/home/neo/app.sh', '#!/bin/bash\necho hola\n');
    await sh.run("printf '[Unit]\\nDescription=Mi app\\n[Service]\\nExecStart=/home/neo/app.sh\\n[Install]\\nWantedBy=multi-user.target\\n' | sudo tee /etc/systemd/system/miapp.service");
    expect((await sh.run('sudo systemctl start miapp')).output).toContain('daemon-reload');
    await sh.run('sudo systemctl daemon-reload');
    expect((await sh.run('sudo systemctl start miapp')).output).toContain('failed');
    expect((await sh.run('journalctl -u miapp')).output).toContain('Permission denied');
    await sh.run('chmod +x app.sh && sudo systemctl enable --now miapp');
    expect((await sh.run('systemctl is-active miapp')).output).toBe('active\n');
    expect((await sh.run('systemctl is-enabled miapp')).output).toBe('enabled\n');
  });

  it('crontab valida la sintaxis', async () => {
    const sh = createTestShell();
    expect((await sh.run("echo '0 25 * * * /bin/backup' | crontab -")).output).toContain('bad hour');
    await sh.run("echo '0 3 * * * /usr/local/bin/backup.sh' | crontab -");
    expect((await sh.run('crontab -l')).output).toBe('0 3 * * * /usr/local/bin/backup.sh\n');
  });
});

describe('archivos, discos y red', () => {
  it('tar.gz crea y extrae', async () => {
    const sh = createTestShell();
    await sh.run('mkdir -p web && echo hola > web/index.html');
    await sh.run('tar -czf web.tar.gz web');
    expect((await sh.run('tar -tzf web.tar.gz')).output).toBe('web/\nweb/index.html\n');
    await sh.run('mkdir restaurar && tar -xzf web.tar.gz -C restaurar');
    expect(sh.fs.readFile('/home/neo/restaurar/web/index.html')).toBe('hola\n');
  });

  it('un log enorme llena el disco y df/du lo delatan', async () => {
    const sh = createTestShell();
    await sh.run('sudo touch /var/log/app.log');
    const node = sh.fs.stat('/var/log/app.log');
    if (node.type === 'file') node.size = 11 * 1024 ** 3;
    expect((await sh.run('df -h /')).output).toMatch(/9\d% \/\n/);
    expect((await sh.run('sudo du -sh /var/log')).output).toMatch(/^11G/);
    await sh.run('sudo truncate -s 0 /var/log/app.log 2>/dev/null || echo -n | sudo tee /var/log/app.log');
    expect((await sh.run('df -h /')).output).not.toMatch(/9\d% \/\n/);
  });

  it('particionar, formatear y montar un disco', async () => {
    const sh = createTestShell();
    expect((await sh.run('printf "n\\np\\n1\\n\\n\\nw\\n" | sudo fdisk /dev/sdb')).report.exitCode).toBe(0);
    await sh.run('sudo mkfs.ext4 /dev/sdb1 && sudo mkdir -p /data && sudo mount /dev/sdb1 /data');
    expect((await sh.run('df -h /data')).output).toContain('/dev/sdb1');
  });

  it('red: ss, curl y ping', async () => {
    const sh = createTestShell();
    expect((await sh.run('ss -tln')).output).toContain('0.0.0.0:22');
    expect((await sh.run('curl -s example.com')).output).toContain('Example Domain');
    expect((await sh.run('curl -sSI http://localhost')).output).toContain("Couldn't connect");
    expect((await sh.run('curl -s http://localhost')).report.exitCode).toBe(7);
    expect((await sh.run('ping -c 1 noexiste.local')).output).toContain('name resolution');
  });

  it('ssh con clave: authorized_keys, permisos y sshd_config', async () => {
    const sh = createTestShell();
    await sh.run('sudo useradd -m -s /bin/bash deploy');
    await sh.run("ssh-keygen -t ed25519 -N '' -f ~/.ssh/id_ed25519");
    expect(sh.fs.exists('/home/neo/.ssh/id_ed25519.pub')).toBe(true);
    // Sin contraseña para deploy, ssh-copy-id no puede autenticarse.
    sh.answers.push('x', 'x', 'x');
    expect((await sh.run('ssh-copy-id deploy@localhost')).output).toContain('Permission denied');
    await sh.run('sudo mkdir -p /home/deploy/.ssh && cat ~/.ssh/id_ed25519.pub | sudo tee /home/deploy/.ssh/authorized_keys');
    await sh.run('sudo chown -R deploy:deploy /home/deploy/.ssh && sudo chmod 700 /home/deploy/.ssh && sudo chmod 600 /home/deploy/.ssh/authorized_keys');
    await sh.run('ssh deploy@localhost');
    expect(sh.session.username).toBe('deploy');
    await sh.run('exit');
    await sh.run("sudo sed -i 's/^PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config");
    await sh.run("echo 'PermitRotLogin no' | sudo tee -a /etc/ssh/sshd_config");
    expect((await sh.run('sudo sshd -t')).output).toContain('Bad configuration option: PermitRotLogin');
  });

  it('ufw: reglas y estado', async () => {
    const sh = createTestShell();
    await sh.run('sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw --force enable');
    const { output } = await sh.run('sudo ufw status');
    expect(output).toContain('Status: active');
    expect(output).toContain('OpenSSH');
    expect(output).toContain('80/tcp');
    await sh.run('sudo ufw deny from 185.220.101.47');
    expect((await sh.run('sudo ufw status numbered')).output).toMatch(/\[ 1\] Anywhere\s+DENY\s+185\.220\.101\.47/);
  });
});
