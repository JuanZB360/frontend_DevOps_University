import { describe, expect, it } from 'vitest';
import { basename, dirname, isSameOrDescendant, normalize, prettifyPath, resolvePath } from './path';
import { formatMode, formatOctal } from './permissions';
import { createTestShell } from '../testing/createTestShell';

describe('path', () => {
  it('normaliza . .. y barras duplicadas', () => {
    expect(normalize('/home//neo/../neo/./docs/')).toBe('/home/neo/docs');
    expect(normalize('/../..')).toBe('/');
  });

  it('resuelve rutas relativas respecto al cwd', () => {
    expect(resolvePath('/home/neo', 'docs/../x')).toBe('/home/neo/x');
    expect(resolvePath('/home/neo', '/etc')).toBe('/etc');
  });

  it('calcula dirname, basename y descendencia', () => {
    expect(dirname('/a/b/c')).toBe('/a/b');
    expect(basename('/a/b/c.txt')).toBe('c.txt');
    expect(isSameOrDescendant('/a', '/a/b')).toBe(true);
    expect(isSameOrDescendant('/a', '/ab')).toBe(false);
    expect(prettifyPath('/home/neo/x', '/home/neo')).toBe('~/x');
  });
});

describe('permissions', () => {
  it('formatea modos como ls -l', () => {
    const base = { name: 'x', owner: 'root', group: 'root', mtime: 0 };
    expect(formatMode({ ...base, type: 'dir', children: {}, mode: 0o755 })).toBe('drwxr-xr-x');
    expect(formatMode({ ...base, type: 'dir', children: {}, mode: 0o1777 })).toBe('drwxrwxrwt');
    expect(formatMode({ ...base, type: 'file', content: '', mode: 0o4755 })).toBe('-rwsr-xr-x');
    expect(formatOctal(0o1777)).toBe('1777');
  });
});

describe('VirtualFileSystem', () => {
  it('crea, lee y añade contenido a archivos', () => {
    const { fs } = createTestShell();
    fs.writeFile('/home/neo/a.txt', 'hola\n');
    fs.writeFile('/home/neo/a.txt', 'mundo\n', true);
    expect(fs.readFile('/home/neo/a.txt')).toBe('hola\nmundo\n');
    expect(fs.stat('/home/neo/a.txt').owner).toBe('neo');
  });

  it('respeta permisos: un usuario normal no puede escribir en /etc ni entrar en /root', () => {
    const { fs } = createTestShell();
    expect(() => fs.writeFile('/etc/x', '')).toThrowError('Permission denied');
    expect(() => fs.readDir('/root')).toThrowError('Permission denied');
  });

  it('mkdir -p crea padres y falla sin -p si falta un padre', () => {
    const { fs } = createTestShell();
    expect(() => fs.mkdir('/home/neo/a/b')).toThrowError('No such file or directory');
    fs.mkdir('/home/neo/a/b/c', true);
    expect(fs.isDirectory('/home/neo/a/b/c')).toBe(true);
  });

  it('sigue enlaces simbólicos (/bin → /usr/bin)', () => {
    const { fs } = createTestShell();
    expect(fs.isDirectory('/bin')).toBe(true);
    expect(fs.stat('/bin', false).type).toBe('symlink');
    expect(fs.realPath('/bin/ls')).toBe('/usr/bin/ls');
  });

  it('cp -r fusiona en directorios existentes y mv impide mover dentro de sí mismo', () => {
    const { fs } = createTestShell();
    fs.mkdir('/home/neo/src/sub', true);
    fs.writeFile('/home/neo/src/sub/f', 'x');
    fs.mkdir('/home/neo/dst/sub', true);
    fs.writeFile('/home/neo/dst/sub/g', 'y');
    fs.copy('/home/neo/src', '/home/neo/dst', true);
    expect(fs.readFile('/home/neo/dst/sub/f')).toBe('x');
    expect(fs.readFile('/home/neo/dst/sub/g')).toBe('y');
    expect(() => fs.move('/home/neo/src', '/home/neo/src/sub/x')).toThrowError('Invalid argument');
  });

  it('el sticky bit de /tmp impide borrar archivos ajenos', () => {
    const t = createTestShell();
    t.session.switchUser('root', ['root'], '/root');
    t.fs.writeFile('/tmp/de-root', 'secreto');
    t.session.switchUser('neo', ['neo'], '/home/neo');
    expect(() => t.fs.remove('/tmp/de-root')).toThrowError('Operation not permitted');
  });

  it('la instantánea es una copia independiente', () => {
    const { fs } = createTestShell();
    const snap = fs.snapshot();
    fs.writeFile('/home/neo/nuevo', '');
    expect(snap.children.home.type === 'dir' && snap.children.home.children.neo).toBeTruthy();
    expect(JSON.stringify(snap)).not.toContain('nuevo');
  });
});
