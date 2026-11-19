/**
 * Gestión de paquetes al estilo Debian/Ubuntu:
 *   apt / apt-get  update install remove purge autoremove upgrade search show list
 *   apt-cache      search show policy
 *   dpkg           -l -L -s -S -i --configure -a
 */
import { addUser, findUser } from '../../system/accounts';
import { addJournal, updateMachine, type MachineState } from '../../system/machine';
import { allPackages, findPackage, type PackageDefinition } from '../../system/packages';
import { startService, stopService, findService } from '../../system/services';
import { dirname } from '../../vfs/path';
import type { VirtualFileSystem } from '../../vfs/VirtualFileSystem';
import type { Command, CommandContext } from '../Command';
import { EXIT_USAGE, fail } from '../helpers';

const LOCK_ERROR = (cmd: string): string =>
  `E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\nE: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), are you root?\n\x1b[2m(pista: ${cmd} necesita permisos de administrador → sudo ${cmd} ...)\x1b[0m\n`;

const BROKEN = "E: dpkg was interrupted, you must manually run 'sudo dpkg --configure -a' to correct the problem.\n";

/** Dependencias (recursivas) que faltan por instalar. */
function resolveDependencies(machine: MachineState, names: string[]): { order: PackageDefinition[]; missing: string[] } {
  const order: PackageDefinition[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  const visit = (name: string): void => {
    if (seen.has(name)) return;
    seen.add(name);
    const pkg = findPackage(name);
    if (!pkg) {
      missing.push(name);
      return;
    }
    for (const dep of pkg.depends ?? []) visit(dep);
    if (machine.packages[name]?.status !== 'installed') order.push(pkg);
  };
  names.forEach(visit);
  return { order, missing };
}

/** Copia los archivos del paquete, crea su usuario y arranca su servicio. */
export function installFiles(fs: VirtualFileSystem, machine: MachineState, pkg: PackageDefinition): void {
  fs.privileged(() => {
    if (pkg.systemUser && !findUser(fs, pkg.systemUser)) {
      addUser(fs, { name: pkg.systemUser, createHome: false, system: true, home: `/var/lib/${pkg.systemUser}` });
    }
    for (const [path, mode, owner] of pkg.dirs ?? []) {
      fs.mkdir(path, true);
      fs.chmod(path, mode);
      fs.chown(path, owner, owner);
    }
    for (const [path, content] of Object.entries(pkg.files ?? {})) {
      if (path.endsWith('/')) {
        fs.mkdir(path, true);
        continue;
      }
      if (content.startsWith('@symlink:')) {
        fs.mkdir(dirname(path), true);
        if (!fs.tryStat(path, false)) fs.symlink(content.slice('@symlink:'.length), path);
        continue;
      }
      // Los archivos de configuración que ya existen (de una instalación anterior) se conservan.
      if (fs.exists(path)) continue;
      fs.mkdir(dirname(path), true);
      fs.writeFile(path, content);
    }
    for (const binary of pkg.binaries ?? []) {
      const path = `/usr/bin/${binary}`;
      if (!fs.exists(path)) {
        fs.writeFile(path, `#!ELF binario simulado: ${binary}\n`);
        fs.chmod(path, 0o755);
      }
    }
  });
  machine.packages[pkg.name] = { version: pkg.version, status: 'installed' };
  if (pkg.service && pkg.service.autoStart !== false) {
    machine.services[pkg.service.name] = { active: false, enabled: true, since: fs.now() };
    const info = findService(fs, machine, pkg.service.name);
    if (info) startService(fs, machine, info);
  }
  const date = new Date(fs.now()).toISOString().slice(0, 19).replace('T', ' ');
  fs.privileged(() => fs.writeFile('/var/log/dpkg.log', `${date} status installed ${pkg.name}:amd64 ${pkg.version}\n`, true));
}

function removeFiles(fs: VirtualFileSystem, machine: MachineState, pkg: PackageDefinition, purge: boolean): void {
  if (pkg.service) {
    stopService(fs, machine, pkg.service.name);
    delete machine.services[pkg.service.name];
  }
  fs.privileged(() => {
    for (const binary of pkg.binaries ?? []) if (fs.exists(`/usr/bin/${binary}`)) fs.remove(`/usr/bin/${binary}`);
    if (purge) {
      for (const path of Object.keys(pkg.files ?? {})) {
        if (path.startsWith('/etc/') && fs.tryStat(path, false)) fs.remove(path, true);
      }
    }
  });
  if (purge) delete machine.packages[pkg.name];
  else machine.packages[pkg.name] = { version: pkg.version, status: 'config-files' };
}

function hasBroken(machine: MachineState): boolean {
  return Object.values(machine.packages).some((p) => p.status === 'half-configured');
}

async function confirm(ctx: CommandContext, assumeYes: boolean): Promise<boolean> {
  if (assumeYes) return true;
  if (!ctx.terminal.readLine) return true;
  const answer = await ctx.terminal.readLine('Do you want to continue? [Y/n] ');
  if (answer === null || /^n/i.test(answer.trim())) {
    ctx.stdout.write('Abort.\n');
    return false;
  }
  return true;
}

function formatSize(kb: number): string {
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} kB`;
}

async function aptInstall(ctx: CommandContext, names: string[], assumeYes: boolean, machineRef: { machine: MachineState }): Promise<number> {
  const { machine } = machineRef;
  if (hasBroken(machine)) {
    ctx.stderr.write(BROKEN);
    return 100;
  }
  ctx.stdout.write('Reading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\n');
  // .deb locales: apt install ./paquete.deb
  const requested = names.map((n) => (n.endsWith('.deb') ? (ctx.fs.readFile(ctx.resolve(n)).split(' ')[1] ?? n) : n.replace(/=.*$/, '')));
  if (machine.aptUpdatedAt === null) {
    const unknown = requested.filter((n) => machine.packages[n]?.status !== 'installed');
    if (unknown.length) {
      ctx.stderr.write(`E: Unable to locate package ${unknown[0]}\n\x1b[2m(pista: el índice de paquetes está vacío. Ejecuta primero: sudo apt update)\x1b[0m\n`);
      return 100;
    }
  }
  const { order, missing } = resolveDependencies(machine, requested);
  if (missing.length) {
    ctx.stderr.write(`E: Unable to locate package ${missing[0]}\n`);
    return 100;
  }
  for (const name of requested) {
    if (machine.packages[name]?.status === 'installed') ctx.stdout.write(`${name} is already the newest version (${machine.packages[name].version}).\n`);
  }
  if (order.length === 0) {
    ctx.stdout.write('0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n');
    return 0;
  }
  const extra = order.filter((p) => !requested.includes(p.name));
  if (extra.length) ctx.stdout.write(`The following additional packages will be installed:\n  ${extra.map((p) => p.name).join(' ')}\n`);
  ctx.stdout.write(`The following NEW packages will be installed:\n  ${order.map((p) => p.name).join(' ')}\n`);
  const size = order.reduce((s, p) => s + p.sizeKB, 0);
  ctx.stdout.write(`0 upgraded, ${order.length} newly installed, 0 to remove and 0 not upgraded.\nNeed to get ${formatSize(Math.round(size / 3))} of archives.\nAfter this operation, ${formatSize(size)} of additional disk space will be used.\n`);
  // Como apt: solo pregunta si hay que instalar paquetes adicionales.
  if (extra.length > 0 && !(await confirm(ctx, assumeYes))) return 1;
  order.forEach((p, i) => ctx.stdout.write(`Get:${i + 1} http://archive.ubuntu.com/ubuntu noble/main amd64 ${p.name} amd64 ${p.version} [${formatSize(Math.round(p.sizeKB / 3))}]\n`));
  for (const p of order) ctx.stdout.write(`Selecting previously unselected package ${p.name}.\nUnpacking ${p.name} (${p.version}) ...\n`);
  for (const p of order) {
    ctx.stdout.write(`Setting up ${p.name} (${p.version}) ...\n`);
    installFiles(ctx.fs, machine, p);
    if (extra.includes(p)) machine.packages[p.name].auto = true;
    if (p.service && machine.services[p.service.name]?.enabled) {
      ctx.stdout.write(`Created symlink /etc/systemd/system/multi-user.target.wants/${p.service.name}.service → /usr/lib/systemd/system/${p.service.name}.service.\n`);
    }
  }
  ctx.stdout.write('Processing triggers for man-db (2.12.0-4build2) ...\n');
  addJournal(machine, ctx.fs.now(), 'apt', `install ${order.map((p) => p.name).join(' ')}`);
  return 0;
}

async function aptRemove(ctx: CommandContext, names: string[], purge: boolean, assumeYes: boolean, machine: MachineState): Promise<number> {
  ctx.stdout.write('Reading package lists... Done\nBuilding dependency tree... Done\n');
  const targets: PackageDefinition[] = [];
  for (const name of names) {
    const state = machine.packages[name];
    const pkg = findPackage(name);
    if (!pkg || !state || (state.status === 'config-files' && !purge)) {
      ctx.stdout.write(`Package '${name}' is not installed, so not removed\n`);
      continue;
    }
    targets.push(pkg);
  }
  if (targets.length === 0) {
    ctx.stdout.write('0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n');
    return 0;
  }
  ctx.stdout.write(`The following packages will be REMOVED:\n  ${targets.map((p) => p.name + (purge ? '*' : '')).join(' ')}\n0 upgraded, 0 newly installed, ${targets.length} to remove and 0 not upgraded.\n`);
  if (!(await confirm(ctx, assumeYes))) return 1;
  for (const pkg of targets) {
    ctx.stdout.write(`Removing ${pkg.name} (${pkg.version}) ...\n`);
    if (purge) ctx.stdout.write(`Purging configuration files for ${pkg.name} (${pkg.version}) ...\n`);
    removeFiles(ctx.fs, machine, pkg, purge);
  }
  return 0;
}

function createApt(name: 'apt' | 'apt-get'): Command {
  return {
    name,
    category: 'paquetes',
    summary: name === 'apt' ? 'Instala, actualiza y elimina paquetes' : 'Versión clásica de apt (para scripts)',
    async execute(ctx) {
      const assumeYes = ctx.args.some((a) => a === '-y' || a === '--yes' || a === '--assume-yes' || a === '-qy');
      const fixBroken = ctx.args.includes('-f') || ctx.args.includes('--fix-broken');
      const args = ctx.args.filter((a) => !a.startsWith('-'));
      const [action, ...names] = args;
      const isRoot = ctx.session.username === 'root';
      const needsRoot = ['update', 'install', 'remove', 'purge', 'autoremove', 'upgrade', 'full-upgrade', 'dist-upgrade', 'reinstall'];
      if (!action) {
        ctx.stdout.write(`${name} 2.7.14 (amd64)\nUsage: ${name} [options] command\n\nMost used commands:\n  list - list packages based on package names\n  search - search in package descriptions\n  show - show package details\n  install - install packages\n  remove - remove packages\n  update - update list of available packages\n  upgrade - upgrade the system by installing/upgrading packages\n`);
        return 1;
      }
      if (needsRoot.includes(action) && !isRoot) {
        ctx.stderr.write(LOCK_ERROR(`${name} ${action}`));
        return 100;
      }

      let exitCode = 0;
      const machineRef = { machine: null as unknown as MachineState };
      await updateMachineAsync(ctx.fs, async (machine) => {
        machineRef.machine = machine;
        switch (action) {
          case 'update': {
            const sources = ['http://archive.ubuntu.com/ubuntu noble', 'http://archive.ubuntu.com/ubuntu noble-updates', 'http://security.ubuntu.com/ubuntu noble-security'];
            sources.forEach((s, i) => ctx.stdout.write(`${machine.aptUpdatedAt ? 'Hit' : 'Get'}:${i + 1} ${s} InRelease\n`));
            machine.aptUpdatedAt = ctx.fs.now();
            const upgradable = Object.keys(machine.packages).filter((n) => findPackage(n)?.upgradeTo && machine.packages[n].version !== findPackage(n)!.upgradeTo).length;
            ctx.stdout.write(`Reading package lists... Done\nBuilding dependency tree... Done\n${upgradable ? `${upgradable} package can be upgraded. Run 'apt list --upgradable' to see it.` : 'All packages are up to date.'}\n`);
            break;
          }
          case 'install': case 'reinstall':
            if (fixBroken && names.length === 0) {
              exitCode = fixBrokenPackages(ctx, machine);
              break;
            }
            if (names.length === 0) {
              ctx.stdout.write('Reading package lists... Done\n0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n');
              break;
            }
            exitCode = await aptInstall(ctx, names, assumeYes, machineRef);
            break;
          case 'remove': case 'purge':
            if (hasBroken(machine)) {
              ctx.stderr.write(BROKEN);
              exitCode = 100;
              break;
            }
            exitCode = await aptRemove(ctx, names, action === 'purge' || ctx.args.includes('--purge'), assumeYes, machine);
            break;
          case 'autoremove': {
            const auto = Object.entries(machine.packages).filter(([, p]) => p.auto).map(([n]) => n);
            const needed = new Set(Object.entries(machine.packages).filter(([, p]) => !p.auto && p.status === 'installed').flatMap(([n]) => findPackage(n)?.depends ?? []));
            const removable = auto.filter((n) => !needed.has(n));
            if (removable.length === 0) ctx.stdout.write('Reading package lists... Done\n0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n');
            else exitCode = await aptRemove(ctx, removable, false, assumeYes, machine);
            break;
          }
          case 'upgrade': case 'full-upgrade': case 'dist-upgrade': {
            if (hasBroken(machine)) {
              ctx.stderr.write(BROKEN);
              exitCode = 100;
              break;
            }
            const upgradable = Object.keys(machine.packages).filter((n) => findPackage(n)?.upgradeTo && machine.packages[n].version !== findPackage(n)!.upgradeTo);
            ctx.stdout.write('Reading package lists... Done\nCalculating upgrade... Done\n');
            if (upgradable.length === 0) {
              ctx.stdout.write('0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n');
              break;
            }
            ctx.stdout.write(`The following packages will be upgraded:\n  ${upgradable.join(' ')}\n${upgradable.length} upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n`);
            if (!(await confirm(ctx, assumeYes))) {
              exitCode = 1;
              break;
            }
            for (const n of upgradable) {
              machine.packages[n].version = findPackage(n)!.upgradeTo!;
              ctx.stdout.write(`Setting up ${n} (${machine.packages[n].version}) ...\n`);
            }
            break;
          }
          case 'search': {
            const term = (names[0] ?? '').toLowerCase();
            ctx.stdout.write('Sorting... Done\nFull Text Search... Done\n');
            for (const p of allPackages().filter((x) => x.name.includes(term) || x.description.toLowerCase().includes(term))) {
              const installed = machine.packages[p.name]?.status === 'installed' ? ' [installed]' : '';
              ctx.stdout.write(`\x1b[32m${p.name}\x1b[0m/noble ${p.version} amd64${installed}\n  ${p.description}\n\n`);
            }
            break;
          }
          case 'show': exitCode = showPackages(ctx, machine, names); break;
          case 'list': {
            const installedOnly = ctx.args.includes('--installed');
            const upgradableOnly = ctx.args.includes('--upgradable');
            ctx.stdout.write('Listing... Done\n');
            for (const p of allPackages()) {
              const state = machine.packages[p.name];
              if (installedOnly && state?.status !== 'installed') continue;
              if (upgradableOnly && !(state && p.upgradeTo && state.version !== p.upgradeTo)) continue;
              if (names[0] && !new RegExp('^' + names[0].replace(/\*/g, '.*') + '$').test(p.name)) continue;
              const tag = state?.status === 'installed' ? (state.auto ? ' [installed,automatic]' : ' [installed]') : '';
              ctx.stdout.write(`${p.name}/noble ${upgradableOnly ? p.upgradeTo : p.version} amd64${upgradableOnly ? ` [upgradable from: ${state!.version}]` : tag}\n`);
            }
            break;
          }
          case 'policy': {
            for (const n of names) {
              const p = findPackage(n);
              ctx.stdout.write(`${n}:\n  Installed: ${machine.packages[n]?.version ?? '(none)'}\n  Candidate: ${p?.upgradeTo ?? p?.version ?? '(none)'}\n`);
            }
            break;
          }
          default:
            ctx.stderr.write(`E: Invalid operation ${action}\n`);
            exitCode = 1;
        }
      });
      return exitCode;
    },
  };
}

/** Variante asíncrona de updateMachine (apt pregunta "¿continuar?" a mitad). */
async function updateMachineAsync(fs: VirtualFileSystem, fn: (machine: MachineState) => Promise<void>): Promise<void> {
  let captured: MachineState | null = null;
  updateMachine(fs, (m) => {
    captured = m;
  });
  await fn(captured!);
  updateMachine(fs, (m) => Object.assign(m, captured));
}

function showPackages(ctx: CommandContext, machine: MachineState, names: string[]): number {
  for (const n of names) {
    const p = findPackage(n);
    if (!p) {
      ctx.stderr.write(`N: Unable to locate package ${n}\nE: No packages found\n`);
      return 100;
    }
    ctx.stdout.write(`Package: ${p.name}\nVersion: ${p.version}\nPriority: optional\nSection: ${p.section}\nMaintainer: Ubuntu Developers <ubuntu-devel-discuss@lists.ubuntu.com>\nInstalled-Size: ${formatSize(p.sizeKB)}\n${p.depends ? `Depends: ${p.depends.join(', ')}\n` : ''}Download-Size: ${formatSize(Math.round(p.sizeKB / 3))}\nAPT-Sources: http://archive.ubuntu.com/ubuntu noble/main amd64 Packages\nDescription: ${p.description}\n${machine.packages[n] ? `Status: ${machine.packages[n].status}\n` : ''}\n`);
  }
  return 0;
}

function fixBrokenPackages(ctx: CommandContext, machine: MachineState): number {
  const broken = Object.entries(machine.packages).filter(([, p]) => p.status === 'half-configured');
  ctx.stdout.write('Reading package lists... Done\nCorrecting dependencies... Done\n');
  for (const [name] of broken) {
    const pkg = findPackage(name);
    ctx.stdout.write(`Setting up ${name} (${machine.packages[name].version}) ...\n`);
    if (pkg) installFiles(ctx.fs, machine, pkg);
    else machine.packages[name].status = 'installed';
  }
  ctx.stdout.write(`0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n`);
  return 0;
}

export const aptCommand = createApt('apt');
export const aptGetCommand = createApt('apt-get');

export const aptCacheCommand: Command = {
  name: 'apt-cache',
  category: 'paquetes',
  summary: 'Consulta el índice de paquetes (search, show, policy)',
  execute(ctx) {
    const [action, ...names] = ctx.args;
    let exitCode = 0;
    updateMachine(ctx.fs, (machine) => {
      if (action === 'search') {
        const term = (names[0] ?? '').toLowerCase();
        for (const p of allPackages().filter((x) => x.name.includes(term) || x.description.toLowerCase().includes(term))) ctx.stdout.write(`${p.name} - ${p.description}\n`);
      } else if (action === 'show') exitCode = showPackages(ctx, machine, names);
      else if (action === 'policy') {
        for (const n of names) ctx.stdout.write(`${n}:\n  Installed: ${machine.packages[n]?.version ?? '(none)'}\n  Candidate: ${findPackage(n)?.version ?? '(none)'}\n`);
      } else {
        ctx.stderr.write('E: No operation specified (search, show, policy)\n');
        exitCode = 1;
      }
    });
    return exitCode;
  },
};

const DPKG_STATUS: Record<string, string> = { installed: 'ii', 'half-configured': 'iF', 'config-files': 'rc' };

export const dpkgCommand: Command = {
  name: 'dpkg',
  category: 'paquetes',
  summary: 'Gestor de bajo nivel de paquetes .deb (-l lista, -L archivos)',
  execute(ctx) {
    const [option, ...rest] = ctx.args;
    let exitCode = 0;
    if (!option) return fail(ctx, 'need an action option\n\nType dpkg --help for help about installing and deinstalling packages [*];', EXIT_USAGE);
    updateMachine(ctx.fs, (machine) => {
      switch (option) {
        case '-l': case '--list': {
          ctx.stdout.write('Desired=Unknown/Install/Remove/Purge/Hold\n| Status=Not/Inst/Conf-files/Unpacked/halF-conf/Half-inst/trig-aWait/Trig-pend\n|/ Err?=(none)/Reinst-required (Status,Err: uppercase=bad)\n||/ Name                Version                 Architecture Description\n+++-===================-=======================-============-=================================\n');
          const pattern = rest[0] ? new RegExp('^' + rest[0].replace(/\*/g, '.*') + '$') : null;
          const names = Object.keys(machine.packages).sort().filter((n) => !pattern || pattern.test(n));
          if (pattern && names.length === 0) {
            ctx.stderr.write(`dpkg-query: no packages found matching ${rest[0]}\n`);
            exitCode = 1;
          }
          for (const n of names) {
            const p = machine.packages[n];
            ctx.stdout.write(`${DPKG_STATUS[p.status]}  ${n.padEnd(19)} ${p.version.padEnd(23)} amd64        ${findPackage(n)?.description.slice(0, 40) ?? ''}\n`);
          }
          break;
        }
        case '-L': case '--listfiles': {
          const p = findPackage(rest[0] ?? '');
          if (!p || machine.packages[p.name]?.status !== 'installed') {
            ctx.stderr.write(`dpkg-query: package '${rest[0]}' is not installed\n`);
            exitCode = 1;
            break;
          }
          for (const f of [...(p.binaries ?? []).map((b) => `/usr/bin/${b}`), ...Object.keys(p.files ?? {})]) ctx.stdout.write(f + '\n');
          ctx.stdout.write(`/usr/share/doc/${p.name}\n`);
          break;
        }
        case '-s': case '--status': {
          const state = machine.packages[rest[0] ?? ''];
          if (!state) {
            ctx.stderr.write(`dpkg-query: package '${rest[0]}' is not installed and no information is available\n`);
            exitCode = 1;
            break;
          }
          ctx.stdout.write(`Package: ${rest[0]}\nStatus: install ok ${state.status === 'half-configured' ? 'half-configured' : state.status === 'config-files' ? 'config-files' : 'installed'}\nVersion: ${state.version}\n`);
          break;
        }
        case '-S': case '--search': {
          const path = rest[0] ?? '';
          const owner = allPackages().find((p) => (p.binaries ?? []).some((b) => path.endsWith(`/${b}`) || path === b) || Object.keys(p.files ?? {}).includes(path));
          if (!owner) {
            ctx.stderr.write(`dpkg-query: no path found matching pattern *${path}*\n`);
            exitCode = 1;
          } else ctx.stdout.write(`${owner.name}: ${path}\n`);
          break;
        }
        case '--configure': {
          if (ctx.session.username !== 'root') {
            ctx.stderr.write('dpkg: error: requested operation requires superuser privilege\n');
            exitCode = 2;
            break;
          }
          for (const [name, state] of Object.entries(machine.packages)) {
            if (state.status !== 'half-configured') continue;
            ctx.stdout.write(`Setting up ${name} (${state.version}) ...\n`);
            const pkg = findPackage(name);
            if (pkg) installFiles(ctx.fs, machine, pkg);
            else state.status = 'installed';
          }
          break;
        }
        case '-i': case '--install': {
          if (ctx.session.username !== 'root') {
            ctx.stderr.write('dpkg: error: requested operation requires superuser privilege\n');
            exitCode = 2;
            break;
          }
          for (const file of rest) {
            let content: string;
            try {
              content = ctx.fs.readFile(ctx.resolve(file));
            } catch {
              ctx.stderr.write(`dpkg: error: cannot access archive '${file}': No such file or directory\n`);
              exitCode = 1;
              continue;
            }
            const [, name] = content.split(' ');
            const pkg = findPackage(name ?? '');
            if (!content.startsWith('DEBSIM') || !pkg) {
              ctx.stderr.write(`dpkg-deb: error: '${file}' is not a Debian format archive\n`);
              exitCode = 1;
              continue;
            }
            const missingDeps = (pkg.depends ?? []).filter((d) => machine.packages[d]?.status !== 'installed');
            ctx.stdout.write(`Selecting previously unselected package ${name}.\nUnpacking ${name} (${pkg.version}) ...\n`);
            if (missingDeps.length) {
              machine.packages[name] = { version: pkg.version, status: 'half-configured' };
              ctx.stderr.write(`dpkg: dependency problems prevent configuration of ${name}:\n ${name} depends on ${missingDeps[0]}; however:\n  Package ${missingDeps[0]} is not installed.\n\ndpkg: error processing package ${name} (--install):\n dependency problems - leaving unconfigured\n`);
              exitCode = 1;
              continue;
            }
            ctx.stdout.write(`Setting up ${name} (${pkg.version}) ...\n`);
            installFiles(ctx.fs, machine, pkg);
          }
          break;
        }
        case '-r': case '-P': case '--remove': case '--purge': {
          if (ctx.session.username !== 'root') {
            ctx.stderr.write('dpkg: error: requested operation requires superuser privilege\n');
            exitCode = 2;
            break;
          }
          for (const n of rest) {
            const pkg = findPackage(n);
            if (!pkg || !machine.packages[n]) {
              ctx.stderr.write(`dpkg: warning: ignoring request to remove ${n} which isn't installed\n`);
              continue;
            }
            ctx.stdout.write(`Removing ${n} (${pkg.version}) ...\n`);
            removeFiles(ctx.fs, machine, pkg, option === '-P' || option === '--purge');
          }
          break;
        }
        case '--version':
          ctx.stdout.write("Debian 'dpkg' package management program version 1.22.6 (amd64).\n");
          break;
        default:
          ctx.stderr.write(`dpkg: error: unknown option ${option}\n`);
          exitCode = 2;
      }
    });
    return exitCode;
  },
};

