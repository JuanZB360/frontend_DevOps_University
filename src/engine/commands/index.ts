/**
 * Catálogo de comandos Linux implementados.
 *
 * Para añadir un comando nuevo:
 *   1. Crea su archivo en la carpeta de su categoría implementando `Command`.
 *   2. Añádelo a la lista de abajo.
 *   3. Escribe su documentación en `game/content/manual` y sus misiones.
 * El shell no necesita ningún cambio (principio Open/Closed).
 */
import type { Command } from './Command';
import { CommandRegistry } from './CommandRegistry';
import { cdCommand } from './builtins/cd';
import { clearCommand } from './builtins/clear';
import { echoCommand } from './builtins/echo';
import { exitCommand } from './builtins/exit';
import { helpCommand } from './builtins/help';
import { historyCommand } from './builtins/history';
import { pwdCommand } from './builtins/pwd';
import { cpCommand } from './files/cp';
import { mkdirCommand } from './files/mkdir';
import { mvCommand } from './files/mv';
import { rmCommand } from './files/rm';
import { rmdirCommand } from './files/rmdir';
import { touchCommand } from './files/touch';
import { lsCommand } from './navigation/ls';
import { treeCommand } from './navigation/tree';
import { catCommand } from './reading/cat';
import { headCommand, tailCommand } from './reading/headTail';
import { wcCommand } from './reading/wc';
import { dateCommand, hostnameCommand, unameCommand, whoamiCommand } from './system/identity';
import { createManCommand, type ManualProvider } from './system/man';
import { whichCommand } from './system/which';
import {
  aliasCommand, bashCommand, bracketCommand, breakCommand, colonCommand, continueCommand, evalCommand, exportCommand,
  falseCommand, localCommand, readCommand, returnCommand, setCommand, shiftCommand, sourceCommand, testCommand,
  trueCommand, typeCommand, unaliasCommand, unsetCommand,
} from './builtins/scripting';
import { findCommand } from './search/find';
import { dockerCommand } from './docker/docker';
import { certbotCommand, htpasswdCommand, nginxCommand, nodeCommand } from './web/web';
import { gunzipCommand, gzipCommand, tarCommand, unzipCommand, zcatCommand, zipCommand } from './files/archives';
import { nanoCommand } from './files/nano';
import { blkidCommand, dfCommand, duCommand, fdiskCommand, lsblkCommand, mkfsCommand, mkfsExt4Command, mkfsXfsCommand, mountCommand, partedCommand, umountCommand } from './disks/disks';
import { curlCommand, digCommand, hostCommand, ipCommand, netstatCommand, nslookupCommand, pingCommand, ssCommand, tracerouteCommand, wgetCommand } from './network/network';
import { rsyncCommand, scpCommand, sshCommand, sshCopyIdCommand, sshdCommand, sshKeygenCommand } from './network/ssh';
import { aptCacheCommand, aptCommand, aptGetCommand, dpkgCommand } from './packages/apt';
import { chgrpCommand, chmodCommand, chownCommand, fileCommand, lnCommand, readlinkCommand, statCommand, umaskCommand } from './permissions/permissions';
import {
  bgCommand, fgCommand, freeCommand, iostatCommand, jobsCommand, killallCommand, killCommand, lsofCommand, niceCommand,
  nohupCommand, pgrepCommand, pkillCommand, psCommand, reniceCommand, topCommand, uptimeCommand, vmstatCommand,
} from './processes/processes';
import { fail2banCommand, iptablesCommand, ufwCommand } from './security/firewall';
import { crontabCommand, dmesgCommand, journalctlCommand, loggerCommand, logrotateCommand, serviceCommand, systemctlCommand } from './services/systemd';
import {
  adduserCommand, chpasswdCommand, gpasswdCommand, groupaddCommand, groupdelCommand, groupsCommand, idCommand, lastCommand,
  newgrpCommand, passwdCommand, suCommand, sudoCommand, useraddCommand, userdelCommand, usermodCommand, visudoCommand,
  wCommand, whoCommand,
} from './users/users';
import { awkCommand } from './text/awk';
import { cutCommand, nlCommand, pasteCommand, revCommand, teeCommand, trCommand } from './text/fields';
import { egrepCommand, grepCommand } from './text/grep';
import { sedCommand } from './text/sed';
import { sortCommand, uniqCommand } from './text/sortUniq';
import {
  basenameCommand, diffCommand, dirnameCommand, envCommand, lessCommand, locateCommand, moreCommand, printenvCommand,
  printfCommand, seqCommand, sleepCommand, updatedbCommand, xargsCommand, truncateCommand, getentCommand,
} from './text/utilities';

/** Comandos que no tienen dependencias externas. */
export const CORE_COMMANDS: readonly Command[] = [
  // Builtins del shell
  cdCommand, pwdCommand, echoCommand, historyCommand, clearCommand, helpCommand, exitCommand,
  // Navegación
  lsCommand, treeCommand,
  // Archivos
  touchCommand, mkdirCommand, rmdirCommand, rmCommand, cpCommand, mvCommand,
  // Lectura
  catCommand, headCommand, tailCommand, wcCommand,
  // Sistema
  whoamiCommand, hostnameCommand, unameCommand, dateCommand, whichCommand,
  // Shell y scripts
  trueCommand, falseCommand, testCommand, bracketCommand, colonCommand, exportCommand, unsetCommand, localCommand,
  setCommand, aliasCommand, unaliasCommand, sourceCommand, bashCommand, evalCommand, readCommand, breakCommand,
  continueCommand, returnCommand, shiftCommand, typeCommand, envCommand, printenvCommand, sleepCommand,
  // Lectura, búsqueda y texto
  lessCommand, moreCommand, findCommand, locateCommand, updatedbCommand,
  grepCommand, egrepCommand, sortCommand, uniqCommand, cutCommand, trCommand, teeCommand, nlCommand, revCommand,
  pasteCommand, sedCommand, awkCommand, diffCommand, xargsCommand, printfCommand, seqCommand, basenameCommand,
  dirnameCommand, nanoCommand, truncateCommand, getentCommand,
  // Usuarios y permisos
  idCommand, groupsCommand, whoCommand, wCommand, lastCommand, useraddCommand, adduserCommand, usermodCommand,
  userdelCommand, groupaddCommand, groupdelCommand, gpasswdCommand, passwdCommand, chpasswdCommand, suCommand,
  sudoCommand, visudoCommand, newgrpCommand, chmodCommand, chownCommand, chgrpCommand, umaskCommand, statCommand,
  lnCommand, readlinkCommand, fileCommand,
  // Procesos y rendimiento
  psCommand, topCommand, killCommand, killallCommand, pkillCommand, pgrepCommand, jobsCommand, fgCommand, bgCommand,
  nohupCommand, niceCommand, reniceCommand, freeCommand, uptimeCommand, vmstatCommand, iostatCommand, lsofCommand,
  // Paquetes, servicios y logs
  aptCommand, aptGetCommand, aptCacheCommand, dpkgCommand, systemctlCommand, serviceCommand, journalctlCommand,
  loggerCommand, dmesgCommand, crontabCommand, logrotateCommand,
  // Archivos comprimidos y discos
  tarCommand, gzipCommand, gunzipCommand, zcatCommand, zipCommand, unzipCommand, dfCommand, duCommand, lsblkCommand,
  blkidCommand, fdiskCommand, partedCommand, mkfsCommand, mkfsExt4Command, mkfsXfsCommand, mountCommand, umountCommand,
  // Red, SSH y seguridad
  ipCommand, pingCommand, ssCommand, netstatCommand, curlCommand, wgetCommand, digCommand, nslookupCommand, hostCommand,
  tracerouteCommand, sshKeygenCommand, sshCopyIdCommand, sshCommand, scpCommand, rsyncCommand, sshdCommand, ufwCommand,
  iptablesCommand, fail2banCommand,
  // Módulo web
  nginxCommand, certbotCommand, nodeCommand, htpasswdCommand,
  // Módulo Docker
  dockerCommand,
];

export interface CoreRegistryDependencies {
  manuals: ManualProvider;
  /** Comandos adicionales (ej. los del juego: mision, pista). */
  extra?: readonly Command[];
}

/** Nombres de los programas instalados en una máquina nueva (para poblar /usr/bin). */
export function coreBinaryNames(): string[] {
  const noManuals: ManualProvider = { lookup: () => ({ status: 'missing' }) };
  return createCommandRegistry({ manuals: noManuals }).binaryNames();
}

/** Construye el registro con todos los comandos del sistema. */
export function createCommandRegistry(deps: CoreRegistryDependencies): CommandRegistry {
  return new CommandRegistry().register(...CORE_COMMANDS, createManCommand(deps.manuals), ...(deps.extra ?? []));
}
