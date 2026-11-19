/**
 * Discos y almacenamiento:
 *   df (-h)  du (-sh, --max-depth)  lsblk (-f)  blkid  fdisk -l  parted
 *   mkfs / mkfs.ext4   mount / umount   (mount -a lee /etc/fstab)
 */
import { readMachine, updateMachine, type MachineState } from '../../system/machine';
import { isFsError } from '../../vfs/errors';
import { joinPath } from '../../vfs/path';
import { nodeSize, type FsNode } from '../../vfs/types';
import type { VirtualFileSystem } from '../../vfs/VirtualFileSystem';
import type { Command, CommandContext } from '../Command';
import { EXIT_USAGE, fail } from '../helpers';

const GB = 1024 ** 3;

/** Tamaño legible estilo -h de coreutils: 4.0K, 12M, 1.5G. */
export function human(bytes: number): string {
  if (bytes < 1024) return `${bytes}`;
  const units = ['K', 'M', 'G', 'T'];
  let value = bytes;
  let i = -1;
  do {
    value /= 1024;
    i++;
  } while (value >= 1024 && i < units.length - 1);
  return (value < 10 ? value.toFixed(1) : String(Math.round(value))) + units[i];
}

/** Bytes usados por los archivos del VFS, repartidos por punto de montaje. */
export function usageByMount(fs: VirtualFileSystem, machine: MachineState): Map<string, number> {
  const targets = machine.mounts.map((m) => m.target).sort((a, b) => b.length - a.length);
  const usage = new Map<string, number>(targets.map((t) => [t, 0]));
  const mountOf = (path: string): string => targets.find((t) => t === '/' || path === t || path.startsWith(t + '/')) ?? '/';
  const walk = (node: FsNode, path: string): void => {
    if (node.type === 'dir') {
      for (const child of Object.values(node.children)) walk(child, joinPath(path, child.name));
      return;
    }
    const mount = mountOf(path);
    usage.set(mount, (usage.get(mount) ?? 0) + nodeSize(node));
  };
  fs.privileged(() => walk(fs.stat('/'), '/'));
  return usage;
}

function partitionSize(machine: MachineState, device: string): number {
  const name = device.replace('/dev/', '');
  for (const disk of machine.disks) {
    if (disk.name === name) return disk.sizeGB * GB;
    const part = disk.partitions.find((p) => p.name === name);
    if (part) return part.sizeGB * GB;
  }
  return 0;
}

export interface DiskUsage {
  device: string;
  target: string;
  fstype: string;
  size: number;
  used: number;
}

export function diskUsage(fs: VirtualFileSystem, machine: MachineState): DiskUsage[] {
  const usage = usageByMount(fs, machine);
  return machine.mounts.map((m) => {
    const size = partitionSize(machine, m.device);
    const base = m.target === '/' ? machine.baseUsedGB * GB : m.target === '/boot/efi' ? 6_300_000 : 25_000_000;
    return { device: m.device, target: m.target, fstype: m.fstype, size, used: Math.min(size, base + (usage.get(m.target) ?? 0)) };
  });
}

export const dfCommand: Command = {
  name: 'df',
  category: 'discos',
  summary: 'Muestra el espacio libre de cada disco (-h legible)',
  execute(ctx) {
    const machine = readMachine(ctx.fs);
    const h = ctx.args.some((a) => /^-[a-zA-Z]*h/.test(a)) || ctx.args.includes('--human-readable');
    const showType = ctx.args.some((a) => /^-[a-zA-Z]*T/.test(a));
    const inodes = ctx.args.some((a) => /^-[a-zA-Z]*i/.test(a));
    const paths = ctx.args.filter((a) => !a.startsWith('-'));
    let rows = diskUsage(ctx.fs, machine);
    if (paths.length) {
      rows = paths.map((p) => {
        const abs = ctx.resolve(p);
        return [...rows].sort((a, b) => b.target.length - a.target.length).find((r) => r.target === '/' || abs === r.target || abs.startsWith(r.target + '/'))!;
      });
    }
    const fmt = (n: number): string => (h ? human(n) : String(Math.round(n / 1024)));
    const virtual = paths.length ? [] : [
      { device: 'tmpfs', target: '/run', fstype: 'tmpfs', size: 392 * 1024 * 1024, used: 1_100_000 },
      { device: 'tmpfs', target: '/dev/shm', fstype: 'tmpfs', size: 1958 * 1024 * 1024, used: 0 },
    ];
    ctx.stdout.write(`Filesystem${showType ? '     Type' : ''}${inodes ? '      Inodes  IUsed   IFree IUse% Mounted on' : h ? '      Size  Used Avail Use% Mounted on' : '     1K-blocks     Used Available Use% Mounted on'}\n`);
    for (const r of [...virtual.slice(0, 1), ...rows, ...virtual.slice(1)]) {
      const pct = r.size ? Math.ceil((r.used / r.size) * 100) : 0;
      const type = showType ? ` ${r.fstype.padEnd(8)}` : '';
      if (inodes) {
        ctx.stdout.write(`${r.device.padEnd(14)}${type} ${String(1_310_720).padStart(10)} ${String(Math.round(r.used / 40_000)).padStart(6)} ${String(1_310_720 - Math.round(r.used / 40_000)).padStart(7)} ${String(Math.ceil(r.used / 40_000 / 13_107)).padStart(4)}% ${r.target}\n`);
        continue;
      }
      ctx.stdout.write(`${r.device.padEnd(14)}${type} ${fmt(r.size).padStart(h ? 5 : 12)} ${fmt(r.used).padStart(h ? 5 : 9)} ${fmt(Math.max(0, r.size - r.used)).padStart(h ? 5 : 9)} ${String(pct).padStart(3)}% ${r.target}\n`);
    }
    return 0;
  },
};

export const duCommand: Command = {
  name: 'du',
  category: 'discos',
  summary: 'Muestra cuánto ocupa cada directorio (-sh resumen legible)',
  execute(ctx) {
    const flags = ctx.args.filter((a) => a.startsWith('-')).join('');
    const h = /h/.test(flags);
    const summary = /s/.test(flags.replace('--max-depth', ''));
    const all = /(^|-)a/.test(flags) && !flags.includes('max');
    const total = /c/.test(flags);
    const depthArg = ctx.args.find((a) => a.startsWith('--max-depth=') || a.startsWith('-d'));
    const maxDepth = summary ? 0 : depthArg ? Number(depthArg.replace(/^(--max-depth=|-d)/, '')) : Infinity;
    const paths = ctx.args.filter((a, i) => !a.startsWith('-') && ctx.args[i - 1] !== '-d');
    if (paths.length === 0) paths.push('.');
    const fmt = (bytes: number): string => (h ? human(bytes) : String(Math.ceil(bytes / 1024)));
    let exitCode = 0;
    let grand = 0;
    const walk = (abs: string, shown: string, depth: number): number => {
      let node: FsNode;
      try {
        node = ctx.fs.stat(abs, false);
      } catch {
        return 0;
      }
      if (node.type !== 'dir') {
        const size = Math.ceil(nodeSize(node) / 4096) * 4096;
        if ((all && depth <= maxDepth) || depth === 0) ctx.stdout.write(`${fmt(size)}\t${shown}\n`);
        return size;
      }
      let size = 4096;
      let children: FsNode[] = [];
      try {
        children = ctx.fs.readDir(abs);
      } catch (error) {
        if (!isFsError(error)) throw error;
        ctx.stderr.write(`du: cannot read directory '${shown}': ${error.reason}\n`);
        exitCode = 1;
      }
      for (const child of children) size += walk(joinPath(abs, child.name), shown === '/' ? `/${child.name}` : `${shown}/${child.name}`, depth + 1);
      if (depth <= maxDepth) ctx.stdout.write(`${fmt(size)}\t${shown}\n`);
      return size;
    };
    for (const p of paths) {
      const abs = ctx.resolve(p);
      if (!ctx.fs.tryStat(abs, false)) {
        ctx.stderr.write(`du: cannot access '${p}': No such file or directory\n`);
        exitCode = 1;
        continue;
      }
      grand += walk(abs, p.replace(/\/$/, '') || '/', 0);
    }
    if (total) ctx.stdout.write(`${fmt(grand)}\ttotal\n`);
    return exitCode;
  },
};

export const lsblkCommand: Command = {
  name: 'lsblk',
  category: 'discos',
  summary: 'Lista los discos y sus particiones',
  execute(ctx) {
    const machine = readMachine(ctx.fs);
    const fsMode = ctx.args.some((a) => a.includes('f'));
    const mountOf = (dev: string): string => machine.mounts.find((m) => m.device === `/dev/${dev}`)?.target ?? '';
    if (fsMode) ctx.stdout.write('NAME    FSTYPE FSVER LABEL UUID                                 FSAVAIL FSUSE% MOUNTPOINTS\n');
    else ctx.stdout.write('NAME    MAJ:MIN RM  SIZE RO TYPE MOUNTPOINTS\n');
    machine.disks.forEach((disk, d) => {
      if (fsMode) ctx.stdout.write(`${disk.name}\n`);
      else ctx.stdout.write(`${disk.name.padEnd(7)} 8:${String(d * 16).padEnd(5)} 0 ${(disk.sizeGB + 'G').padStart(4)}  0 disk \n`);
      disk.partitions.forEach((part, i) => {
        const branch = i === disk.partitions.length - 1 ? '└─' : '├─';
        if (fsMode) ctx.stdout.write(`${(branch + part.name).padEnd(7)} ${(part.fstype ?? '').padEnd(6)} ${part.fstype === 'ext4' ? '1.0  ' : '     '}       ${part.fstype ? part.uuid.padEnd(36) : ''.padEnd(36)} ${mountOf(part.name) ? '  ' : '        '}${mountOf(part.name)}\n`);
        else ctx.stdout.write(`${(branch + part.name).padEnd(7)} 8:${String(d * 16 + i + 1).padEnd(5)} 0 ${(part.sizeGB + 'G').padStart(4)}  0 part ${mountOf(part.name)}\n`);
      });
    });
    return 0;
  },
};

export const blkidCommand: Command = {
  name: 'blkid',
  category: 'discos',
  summary: 'Muestra el UUID y el tipo de cada partición',
  execute(ctx) {
    if (ctx.session.username !== 'root') return 2;
    const machine = readMachine(ctx.fs);
    for (const disk of machine.disks) {
      for (const p of disk.partitions) {
        if (!p.fstype) continue;
        ctx.stdout.write(`/dev/${p.name}: UUID="${p.uuid}" BLOCK_SIZE="4096" TYPE="${p.fstype}" PARTUUID="${p.uuid.slice(0, 8)}-01"\n`);
      }
    }
    return 0;
  },
};

function randomUuid(): string {
  const hex = (n: number): string => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}

/** Crea una partición que ocupa todo el disco (lo que hace el 99 % de las veces fdisk/parted). */
function createPartition(ctx: CommandContext, device: string): number {
  if (ctx.session.username !== 'root') return fail(ctx, `cannot open ${device}: Permission denied`);
  let exitCode = 0;
  updateMachine(ctx.fs, (machine) => {
    const disk = machine.disks.find((d) => `/dev/${d.name}` === device);
    if (!disk) {
      ctx.stderr.write(`${ctx.name}: cannot open ${device}: No such file or directory\n`);
      exitCode = 1;
      return;
    }
    if (disk.partitions.length) {
      ctx.stderr.write(`${ctx.name}: ${device} ya tiene particiones; no se ha cambiado nada.\n`);
      exitCode = 1;
      return;
    }
    disk.partitions.push({ name: `${disk.name}1`, sizeGB: disk.sizeGB, fstype: null, uuid: randomUuid() });
    ctx.stdout.write(`Created a new partition 1 of type 'Linux filesystem' and of size ${disk.sizeGB} GiB.\nThe partition table has been altered.\nSyncing disks.\n`);
  });
  return exitCode;
}

export const fdiskCommand: Command = {
  name: 'fdisk',
  category: 'discos',
  summary: 'Particiona discos (fdisk -l lista)',
  execute(ctx) {
    if (ctx.session.username !== 'root') return fail(ctx, `cannot open ${ctx.args.find((a) => a.startsWith('/dev')) ?? '/dev/sda'}: Permission denied`);
    if (ctx.args.includes('-l')) {
      const machine = readMachine(ctx.fs);
      for (const disk of machine.disks) {
        ctx.stdout.write(`Disk /dev/${disk.name}: ${disk.sizeGB} GiB, ${disk.sizeGB * GB} bytes, ${disk.sizeGB * GB / 512} sectors\nDisk model: ${disk.model}\nUnits: sectors of 1 * 512 = 512 bytes\nDisklabel type: ${disk.partitions.length ? 'gpt' : 'dos'}\n`);
        if (disk.partitions.length) {
          ctx.stdout.write('\nDevice       Start      End  Sectors Size Type\n');
          for (const p of disk.partitions) ctx.stdout.write(`/dev/${p.name.padEnd(7)} 2048 ${String(p.sizeGB * 2_097_152).padStart(8)} ${String(p.sizeGB * 2_097_152 - 2048).padStart(8)} ${p.sizeGB}G Linux filesystem\n`);
        }
        ctx.stdout.write('\n');
      }
      return 0;
    }
    const device = ctx.args.find((a) => a.startsWith('/dev/'));
    if (!device) return fail(ctx, 'bad usage\nTry \'fdisk --help\' for more information.', EXIT_USAGE);
    // fdisk es interactivo: en scripts se le pasan las respuestas por stdin (n, p, 1, Enter, Enter, w).
    const answers = (ctx.stdin ?? '').split(/\n/).map((l) => l.trim());
    if (!answers.includes('n') || !answers.includes('w')) {
      ctx.stdout.write(`\nWelcome to fdisk (util-linux 2.39.3).\n\nCommand (m for help): \n\x1b[2mfdisk es interactivo. En el simulador pásale las órdenes por una tubería:\n  printf "n\\np\\n1\\n\\n\\nw\\n" | sudo fdisk ${device}\n(o usa: sudo parted ${device} --script mklabel gpt mkpart primary ext4 0% 100%)\x1b[0m\n`);
      return 1;
    }
    return createPartition(ctx, device);
  },
};

export const partedCommand: Command = {
  name: 'parted',
  category: 'discos',
  summary: 'Particiona discos (modo --script para comandos directos)',
  async execute(ctx) {
    const device = ctx.args.find((a) => a.startsWith('/dev/'));
    if (!device) return fail(ctx, 'no device specified', 1);
    if (ctx.args.includes('print')) return ctx.shell.spawn(['fdisk', '-l']);
    if (!ctx.args.includes('mkpart')) {
      if (ctx.args.includes('mklabel')) return 0;
      return fail(ctx, 'usa: parted /dev/sdX --script mklabel gpt mkpart primary ext4 0% 100%');
    }
    return createPartition(ctx, device);
  },
};

function createMkfs(name: string, fixedType?: string): Command {
  return {
    name,
    category: 'discos',
    summary: `Crea un sistema de archivos${fixedType ? ` ${fixedType}` : ''} (formatea: ¡borra lo que hubiera!)`,
    execute(ctx) {
      if (ctx.session.username !== 'root') return fail(ctx, `${ctx.args.at(-1) ?? ''}: Permission denied while trying to determine filesystem size`);
      const tIndex = ctx.args.indexOf('-t');
      const type = fixedType ?? (tIndex !== -1 ? ctx.args[tIndex + 1] : 'ext2');
      const device = ctx.args.find((a) => a.startsWith('/dev/'));
      if (!device) return fail(ctx, 'no device specified', 1);
      let exitCode = 0;
      updateMachine(ctx.fs, (machine) => {
        const part = machine.disks.flatMap((d) => d.partitions).find((p) => `/dev/${p.name}` === device);
        if (!part) {
          const isDisk = machine.disks.some((d) => `/dev/${d.name}` === device);
          ctx.stderr.write(isDisk ? `mke2fs: ${device} es un disco entero: créale primero una partición (fdisk/parted) y formatea esa partición (${device}1).\n` : `The file ${device} does not exist and no size was specified.\n`);
          exitCode = 1;
          return;
        }
        if (machine.mounts.some((m) => m.device === device)) {
          ctx.stderr.write(`mke2fs 1.47.0 (5-Feb-2023)\n${device} contains a ${part.fstype} file system\n\t/dev is mounted; will not make a filesystem here!\n`);
          exitCode = 1;
          return;
        }
        part.fstype = type;
        part.uuid = randomUuid();
        ctx.stdout.write(`mke2fs 1.47.0 (5-Feb-2023)\nCreating filesystem with ${part.sizeGB * 262_144} 4k blocks and ${part.sizeGB * 65_536} inodes\nFilesystem UUID: ${part.uuid}\nAllocating group tables: done\nWriting inode tables: done\nCreating journal (65536 blocks): done\nWriting superblocks and filesystem accounting information: done\n`);
      });
      return exitCode;
    },
  };
}

export const mkfsCommand = createMkfs('mkfs');
export const mkfsExt4Command = createMkfs('mkfs.ext4', 'ext4');
export const mkfsXfsCommand = createMkfs('mkfs.xfs', 'xfs');

/** Monta una partición. Devuelve el error o null. */
function mountDevice(fs: VirtualFileSystem, machine: MachineState, device: string, target: string, options = 'rw,relatime'): string | null {
  const resolved = device.startsWith('UUID=') ? machine.disks.flatMap((d) => d.partitions).find((p) => p.uuid === device.slice(5)) : machine.disks.flatMap((d) => d.partitions).find((p) => `/dev/${p.name}` === device);
  if (!resolved) return `mount: ${target}: special device ${device} does not exist.`;
  if (!resolved.fstype) return `mount: ${target}: wrong fs type, bad option, bad superblock on /dev/${resolved.name}, missing codepage or helper program, or other error.\n       (¿has formateado la partición con mkfs?)`;
  if (!fs.privileged(() => fs.isDirectory(target))) return `mount: ${target}: mount point does not exist.`;
  if (machine.mounts.some((m) => m.target === target)) return `mount: ${target}: /dev/${resolved.name} already mounted on ${target}.`;
  machine.mounts.push({ device: `/dev/${resolved.name}`, target, fstype: resolved.fstype, options });
  return null;
}

export const mountCommand: Command = {
  name: 'mount',
  category: 'discos',
  summary: 'Monta un disco en un directorio (sin argumentos lista los montajes)',
  execute(ctx) {
    const operands = ctx.args.filter((a, i) => !a.startsWith('-') && ctx.args[i - 1] !== '-t' && ctx.args[i - 1] !== '-o');
    if (ctx.args.length === 0 || (operands.length === 0 && !ctx.args.includes('-a'))) {
      const machine = readMachine(ctx.fs);
      for (const m of machine.mounts) ctx.stdout.write(`${m.device} on ${m.target} type ${m.fstype} (${m.options})\n`);
      ctx.stdout.write('tmpfs on /run type tmpfs (rw,nosuid,nodev,noexec,relatime,size=401436k,mode=755)\nproc on /proc type proc (rw,nosuid,nodev,noexec,relatime)\n');
      return 0;
    }
    if (ctx.session.username !== 'root') return fail(ctx, 'only root can do that');
    let exitCode = 0;
    updateMachine(ctx.fs, (machine) => {
      if (ctx.args.includes('-a')) {
        const fstab = ctx.fs.readFile('/etc/fstab').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
        for (const line of fstab) {
          const [device, target, type, options] = line.trim().split(/\s+/);
          if (!device || !target || target === 'none' || type === 'swap') continue;
          if (machine.mounts.some((m) => m.target === target)) continue;
          const error = mountDevice(ctx.fs, machine, device, target, options);
          if (error) {
            ctx.stderr.write(error + '\n');
            exitCode = 32;
          }
        }
        return;
      }
      const [device, target] = operands;
      if (!target) {
        ctx.stderr.write(`mount: ${device}: can't find in /etc/fstab.\n`);
        exitCode = 1;
        return;
      }
      const error = mountDevice(ctx.fs, machine, device, ctx.resolve(target));
      if (error) {
        ctx.stderr.write(error + '\n');
        exitCode = 32;
      }
    });
    return exitCode;
  },
};

export const umountCommand: Command = {
  name: 'umount',
  category: 'discos',
  summary: 'Desmonta un disco',
  execute(ctx) {
    if (ctx.session.username !== 'root') return fail(ctx, 'must be superuser to unmount.');
    const [target] = ctx.args.filter((a) => !a.startsWith('-'));
    if (!target) return fail(ctx, 'bad usage', EXIT_USAGE);
    let exitCode = 0;
    updateMachine(ctx.fs, (machine) => {
      const abs = target.startsWith('/dev/') ? target : ctx.resolve(target);
      const mount = machine.mounts.find((m) => m.target === abs || m.device === abs);
      if (!mount || mount.target === '/') {
        ctx.stderr.write(`umount: ${target}: not mounted.\n`);
        exitCode = 32;
        return;
      }
      if (ctx.session.cwd === mount.target || ctx.session.cwd.startsWith(mount.target + '/')) {
        ctx.stderr.write(`umount: ${mount.target}: target is busy.\n\x1b[2m(estás dentro del directorio: sal con cd antes de desmontar)\x1b[0m\n`);
        exitCode = 32;
        return;
      }
      machine.mounts = machine.mounts.filter((m) => m !== mount);
    });
    return exitCode;
  },
};
