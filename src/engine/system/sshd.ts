/**
 * Configuración del servidor SSH (/etc/ssh/sshd_config): validación y
 * opciones efectivas. El sshd en marcha usa la configuración que había en
 * su último arranque, guardada en el estado de la máquina.
 */
import type { VirtualFileSystem } from '../vfs/VirtualFileSystem';
import { readMachine, type MachineState } from './machine';

/** sshd_config por defecto de Ubuntu 24.04 (resumido). */
export const SSHD_CONFIG = `# Configuración del servidor SSH. Ver: man sshd_config
Include /etc/ssh/sshd_config.d/*.conf

#Port 22
#AddressFamily any
#ListenAddress 0.0.0.0

#LoginGraceTime 2m
PermitRootLogin yes
#StrictModes yes
#MaxAuthTries 6
#MaxSessions 10

#PubkeyAuthentication yes
#AuthorizedKeysFile	.ssh/authorized_keys .ssh/authorized_keys2

# Para desactivar las contraseñas en texto plano, cámbialo a no:
PasswordAuthentication yes
#PermitEmptyPasswords no

KbdInteractiveAuthentication no
UsePAM yes

X11Forwarding yes
PrintMotd no

AcceptEnv LANG LC_*
Subsystem	sftp	/usr/lib/openssh/sftp-server
`;

export const SSHD_CONFIG_DEFAULT = SSHD_CONFIG;

const SSHD_KEYWORDS = new Set([
  'include', 'port', 'addressfamily', 'listenaddress', 'hostkey', 'logingracetime', 'permitrootlogin', 'strictmodes',
  'maxauthtries', 'maxsessions', 'pubkeyauthentication', 'authorizedkeysfile', 'passwordauthentication',
  'permitemptypasswords', 'kbdinteractiveauthentication', 'challengeresponseauthentication', 'usepam', 'x11forwarding',
  'printmotd', 'acceptenv', 'subsystem', 'allowusers', 'allowgroups', 'denyusers', 'denygroups', 'clientaliveinterval',
  'clientalivecountmax', 'banner', 'loglevel', 'usedns', 'allowtcpforwarding', 'maxstartups', 'protocol',
]);

export interface SshdConfig {
  port: number;
  permitRootLogin: string;
  passwordAuthentication: boolean;
  pubkeyAuthentication: boolean;
  allowUsers: string[] | null;
  allowGroups: string[] | null;
}

/** Comprueba la sintaxis de sshd_config. Devuelve los errores (vacío = correcto). */
export function checkSshdConfig(content: string): string[] {
  const errors: string[] = [];
  content.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const [keyword, ...values] = line.split(/\s+/);
    if (!SSHD_KEYWORDS.has(keyword.toLowerCase())) errors.push(`/etc/ssh/sshd_config: line ${i + 1}: Bad configuration option: ${keyword}`);
    else if (values.length === 0) errors.push(`/etc/ssh/sshd_config line ${i + 1}: no argument after keyword "${keyword}"`);
    else if (['passwordauthentication', 'pubkeyauthentication', 'permitemptypasswords', 'usepam', 'x11forwarding'].includes(keyword.toLowerCase()) && !['yes', 'no'].includes(values[0])) {
      errors.push(`/etc/ssh/sshd_config line ${i + 1}: unsupported option "${values[0]}".`);
    } else if (keyword.toLowerCase() === 'permitrootlogin' && !['yes', 'no', 'prohibit-password', 'without-password', 'forced-commands-only'].includes(values[0])) {
      errors.push(`/etc/ssh/sshd_config line ${i + 1}: unsupported option "${values[0]}".`);
    }
  });
  return errors;
}

export function parseSshdConfig(content: string): SshdConfig {
  const config: SshdConfig = { port: 22, permitRootLogin: 'prohibit-password', passwordAuthentication: true, pubkeyAuthentication: true, allowUsers: null, allowGroups: null };
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [keyword, ...values] = line.split(/\s+/);
    const value = values[0] ?? '';
    // Como sshd, gana la PRIMERA aparición de cada opción.
    switch (keyword.toLowerCase()) {
      case 'port': config.port = Number(value) || 22; break;
      case 'permitrootlogin': config.permitRootLogin = value; break;
      case 'passwordauthentication': config.passwordAuthentication = value === 'yes'; break;
      case 'pubkeyauthentication': config.pubkeyAuthentication = value === 'yes'; break;
      case 'allowusers': config.allowUsers = values; break;
      case 'allowgroups': config.allowGroups = values; break;
    }
  }
  return config;
}

/** Configuración que aplica el sshd en marcha (la del último reinicio del servicio). */
export function activeSshdConfig(fs: VirtualFileSystem): SshdConfig {
  const machine = readMachine(fs);
  const content = machine.sshdConfig ?? fs.privileged(() => fs.readFile('/etc/ssh/sshd_config'));
  return parseSshdConfig(content);
}


/** Comprobación previa al arranque del servicio ssh (como hace systemd con sshd -t). */
export function sshServiceCheck(fs: VirtualFileSystem, machine: MachineState): string | null {
  const content = fs.privileged(() => fs.readFile('/etc/ssh/sshd_config'));
  const errors = checkSshdConfig(content);
  if (errors.length) return errors.join('\n');
  machine.sshdConfig = content;
  return null;
}
