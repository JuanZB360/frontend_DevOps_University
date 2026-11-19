import { describe, expect, it } from 'vitest';
import { createTestShell } from '../testing/createTestShell';
import { LineEditor } from './LineEditor';
import { LineRenderer, visibleLength } from './LineRenderer';
import { TabCompleter } from './TabCompleter';

describe('LineEditor', () => {
  it('edita texto con cursor y envía con Enter', () => {
    const editor = new LineEditor(() => []);
    editor.feed('lss');
    editor.feed('\x1b[D\x7f'); // ← y retroceso: borra la segunda 's'
    expect(editor.buffer).toBe('ls');
    const actions = editor.feed('\x1b[F -la\r'); // Fin y seguir escribiendo
    expect(actions.at(-1)).toEqual({ type: 'submit', line: 'ls -la' });
    expect(editor.buffer).toBe('');
  });

  it('navega el historial con ↑ ↓ y recupera el borrador', () => {
    const editor = new LineEditor(() => ['pwd', 'whoami']);
    editor.feed('ec');
    editor.feed('\x1b[A');
    expect(editor.buffer).toBe('whoami');
    editor.feed('\x1b[A');
    expect(editor.buffer).toBe('pwd');
    editor.feed('\x1b[B\x1b[B');
    expect(editor.buffer).toBe('ec');
  });

  it('Ctrl+W borra la palabra anterior y Ctrl+C cancela', () => {
    const editor = new LineEditor(() => []);
    editor.feed('ls -la /etc');
    editor.feed('\x17');
    expect(editor.buffer).toBe('ls -la ');
    expect(editor.feed('\x03')).toEqual([{ type: 'interrupt' }]);
    expect(editor.buffer).toBe('');
  });
});

describe('LineRenderer', () => {
  it('mide el ancho visible ignorando colores', () => {
    expect(visibleLength('\x1b[1;32mneo\x1b[0m:~$ ')).toBe(7);
  });

  it('coloca el cursor en su columna', () => {
    const renderer = new LineRenderer();
    renderer.markFreshLine(2);
    const out = renderer.render('$ ', 'abc', 1, 80);
    expect(out.endsWith('\x1b[4G')).toBe(true);
  });
});

describe('TabCompleter', () => {
  const setup = () => {
    const sh = createTestShell();
    sh.fs.mkdir('/home/neo/proyectos');
    sh.fs.writeFile('/home/neo/programa.sh', '');
    const completer = new TabCompleter({
      commandNames: () => ['ls', 'less', 'pwd'],
      fs: sh.fs,
      cwd: () => sh.session.cwd,
      home: () => sh.session.home,
    });
    return completer;
  };

  it('completa comandos', () => {
    expect(setup().complete('pw', 2)).toEqual({ kind: 'replace', buffer: 'pwd ', cursor: 4 });
    expect(setup().complete('l', 1)).toEqual({ kind: 'list', candidates: ['less', 'ls'] });
  });

  it('completa rutas y añade / a directorios', () => {
    const completer = setup();
    expect(completer.complete('cd proy', 7)).toEqual({ kind: 'replace', buffer: 'cd proyectos/', cursor: 13 });
    expect(completer.complete('ls pro', 6)).toEqual({ kind: 'list', candidates: ['programa.sh', 'proyectos/'] });
    expect(completer.complete('cat /etc/host', 13)).toEqual({ kind: 'list', candidates: ['hostname', 'hosts'] });
  });
});
