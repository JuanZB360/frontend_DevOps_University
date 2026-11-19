import { describe, expect, it } from 'vitest';
import { createTestShell } from '../testing/createTestShell';
import { parse } from './parser';
import { tokenize } from './tokenizer';

describe('tokenizer', () => {
  it('respeta comillas simples, dobles y escapes', () => {
    const tokens = tokenize(`echo 'a b' "c $X" d\\ e`);
    expect(tokens).toHaveLength(4);
    expect(tokens[1]).toEqual({ kind: 'word', segments: [{ text: 'a b', quote: 'single' }] });
    expect(tokens[2]).toEqual({ kind: 'word', segments: [{ text: 'c $X', quote: 'double' }] });
  });

  it('reconoce operadores y redirecciones', () => {
    const kinds = tokenize('ls -l | wc -l > out 2>&1 && echo ok').map((t) => (t.kind === 'word' ? 'w' : t.value));
    expect(kinds).toEqual(['w', 'w', '|', 'w', 'w', '>', 'w', '2>&1', '&&', 'w', 'w']);
  });

  it('detecta comillas sin cerrar', () => {
    expect(() => tokenize('echo "hola')).toThrowError(/matching/);
  });
});

describe('parser', () => {
  it('construye listas y pipelines', () => {
    const script = parse('a | b && c ; d');
    expect(script).toHaveLength(3);
    expect(script[0].pipeline.commands).toHaveLength(2);
    expect(script[0].next).toBe('&&');
    expect(script[2].next).toBeNull();
  });

  it('rechaza operadores sin comando', () => {
    expect(() => parse('| ls')).toThrowError(/unexpected token/);
    expect(() => parse('ls &&')).toThrowError(/unexpected end/);
  });
});

describe('Shell', () => {
  it('ejecuta comandos básicos y registra el reporte', async () => {
    const sh = createTestShell();
    const { output, report } = await sh.run('whoami');
    expect(output).toBe('neo\n');
    expect(report.commands[0]).toMatchObject({ name: 'whoami', exitCode: 0 });
  });

  it('expande ~ y variables, y no expande dentro de comillas simples', async () => {
    const sh = createTestShell();
    expect((await sh.run('echo ~ $USER')).output).toBe('/home/neo neo\n');
    expect((await sh.run("echo '$USER'")).output).toBe('$USER\n');
    await sh.run('NOMBRE=Trinity');
    expect((await sh.run('echo "hola $NOMBRE"')).output).toBe('hola Trinity\n');
  });

  it('conecta comandos con tuberías', async () => {
    const sh = createTestShell();
    sh.fs.writeFile('/home/neo/f.txt', 'a\nb\nc\n');
    expect((await sh.run('cat f.txt | wc -l')).output).toBe('3\n');
    expect((await sh.run('cat f.txt | head -n 2 | tail -1')).output).toBe('b\n');
  });

  it('redirige stdout y stderr a archivos', async () => {
    const sh = createTestShell();
    await sh.run('echo uno > log.txt');
    await sh.run('echo dos >> log.txt');
    expect(sh.fs.readFile('/home/neo/log.txt')).toBe('uno\ndos\n');
    await sh.run('ls /no-existe 2> err.txt');
    expect(sh.fs.readFile('/home/neo/err.txt')).toContain('No such file or directory');
    const { output } = await sh.run('ls /no-existe 2>/dev/null');
    expect(output).toBe('');
  });

  it('respeta && y ||', async () => {
    const sh = createTestShell();
    expect((await sh.run('ls /nada && echo si || echo no')).output).toMatch(/no\n$/);
    expect((await sh.run('true; echo $?')).output).toBe('0\n');
    expect((await sh.run('false || echo rescate')).output).toBe('rescate\n');
    expect((await sh.run('false && echo no || echo si')).output).toBe('si\n');
  });

  it('expande comodines y deja el patrón literal si no hay coincidencias', async () => {
    const sh = createTestShell();
    sh.fs.writeFile('/home/neo/a.txt', '');
    sh.fs.writeFile('/home/neo/b.txt', '');
    sh.fs.writeFile('/home/neo/c.log', '');
    expect((await sh.run('echo *.txt')).output).toBe('a.txt b.txt\n');
    expect((await sh.run('echo *.jpg')).output).toBe('*.jpg\n');
    expect((await sh.run('echo "*.txt"')).output).toBe('*.txt\n');
  });

  it('informa de comandos inexistentes y bloqueados', async () => {
    const sh = createTestShell({ isAllowed: (n) => n !== 'rm' });
    const notFound = await sh.run('hackear');
    expect(notFound.output).toBe('hackear: command not found\n');
    expect(notFound.report.exitCode).toBe(127);
    const locked = await sh.run('rm x');
    expect(locked.output).toContain('ENCRIPTADO');
    expect(locked.report.exitCode).toBe(126);
  });

  it('guarda el historial', async () => {
    const sh = createTestShell();
    await sh.run('pwd');
    await sh.run('pwd');
    await sh.run('whoami');
    expect(sh.history.list()).toEqual(['pwd', 'whoami']);
  });
});
