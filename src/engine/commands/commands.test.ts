import { describe, expect, it } from 'vitest';
import { createTestShell } from '../testing/createTestShell';

describe('cd / pwd', () => {
  it('navega con rutas relativas, absolutas, ~ y -', async () => {
    const sh = createTestShell();
    await sh.run('cd /etc');
    expect((await sh.run('pwd')).output).toBe('/etc\n');
    await sh.run('cd ..');
    expect(sh.session.cwd).toBe('/');
    expect((await sh.run('cd -')).output).toBe('/etc\n');
    await sh.run('cd');
    expect(sh.session.cwd).toBe('/home/neo');
  });

  it('muestra errores con el formato de bash', async () => {
    const sh = createTestShell();
    expect((await sh.run('cd /nada')).output).toBe('bash: cd: /nada: No such file or directory\n');
    expect((await sh.run('cd /root')).output).toBe('bash: cd: /root: Permission denied\n');
    expect((await sh.run('cd /etc/hosts')).output).toBe('bash: cd: /etc/hosts: Not a directory\n');
  });
});

describe('ls', () => {
  it('oculta archivos ocultos salvo con -a', async () => {
    const sh = createTestShell();
    expect((await sh.run('ls -1')).output).toBe('');
    const all = (await sh.run('ls -a | cat')).output.split('\n');
    expect(all).toEqual(expect.arrayContaining(['.', '..', '.bashrc', '.profile']));
  });

  it('muestra formato largo con permisos y dueño', async () => {
    const sh = createTestShell();
    sh.fs.writeFile('/home/neo/notas.txt', 'hola');
    const { output } = await sh.run('ls -l notas.txt');
    expect(output).toMatch(/^-rw-r--r-- 1 neo neo 4 \w{3} [ \d]\d ( \d{4}|\d\d:\d\d) notas.txt\n$/);
  });

  it('reporta rutas inexistentes con código 2', async () => {
    const sh = createTestShell();
    const { output, report } = await sh.run('ls fantasma');
    expect(output).toBe("ls: cannot access 'fantasma': No such file or directory\n");
    expect(report.exitCode).toBe(2);
  });
});

describe('manipulación de archivos', () => {
  it('touch, mkdir, cp, mv y rm funcionan juntos', async () => {
    const sh = createTestShell();
    await sh.run('touch a.txt && mkdir -p docs/viejos && cp a.txt docs/ && mv docs/a.txt docs/b.txt');
    expect(sh.fs.isFile('/home/neo/docs/b.txt')).toBe(true);
    await sh.run('rm -r docs');
    expect(sh.fs.exists('/home/neo/docs')).toBe(false);
  });

  it('cp sin -r omite directorios y rm sin -r se niega', async () => {
    const sh = createTestShell();
    await sh.run('mkdir d');
    expect((await sh.run('cp d e')).output).toBe("cp: -r not specified; omitting directory 'd'\n");
    expect((await sh.run('rm d')).output).toBe("rm: cannot remove 'd': Is a directory\n");
  });

  it('mv con varios orígenes exige un directorio destino', async () => {
    const sh = createTestShell();
    await sh.run('touch x y');
    expect((await sh.run('mv x y z')).output).toBe("mv: target 'z' is not a directory\n");
    await sh.run('mkdir z && mv x y z');
    expect(sh.fs.readDir('/home/neo/z').map((n) => n.name)).toEqual(['x', 'y']);
  });

  it('rm protege la raíz y rmdir solo borra vacíos', async () => {
    const sh = createTestShell();
    expect((await sh.run('rm -rf /')).output).toContain('dangerous');
    await sh.run('mkdir -p a/b');
    expect((await sh.run('rmdir a')).output).toBe("rmdir: failed to remove 'a': Directory not empty\n");
  });
});

describe('lectura', () => {
  it('head, tail y wc', async () => {
    const sh = createTestShell();
    sh.fs.writeFile('/home/neo/n.txt', Array.from({ length: 15 }, (_, i) => `l${i + 1}`).join('\n') + '\n');
    expect((await sh.run('head -3 n.txt')).output).toBe('l1\nl2\nl3\n');
    expect((await sh.run('tail -n 2 n.txt')).output).toBe('l14\nl15\n');
    expect((await sh.run('wc -l n.txt')).output).toBe('15 n.txt\n');
  });
});

describe('otros', () => {
  it('echo -n / -e, history y clear', async () => {
    const sh = createTestShell();
    expect((await sh.run('echo -n hola')).output).toBe('hola');
    expect((await sh.run('echo -e "a\\tb"')).output).toBe('a\tb\n');
    await sh.run('clear');
    expect(sh.cleared()).toBe(1);
    expect((await sh.run('history')).output).toContain('    4  history');
  });

  it('tree dibuja el árbol y cuenta elementos', async () => {
    const sh = createTestShell();
    await sh.run('mkdir -p p/src && touch p/README p/src/main.ts');
    expect((await sh.run('tree p')).output).toBe('p\n├── README\n└── src\n    └── main.ts\n\n1 directory, 2 files\n');
  });

  it('man usa el proveedor inyectado', async () => {
    const sh = createTestShell();
    expect((await sh.run('man ls')).output).toBe('LS(1)\n');
    expect((await sh.run('man nada')).output).toBe('No manual entry for nada\n');
  });
});
