import { describe, expect, it } from 'vitest';
import { createTestShell } from '../testing/createTestShell';

describe('scripts de bash', () => {
  it('if / elif / else con test y [', async () => {
    const sh = createTestShell();
    const script = 'N=5\nif [ $N -gt 10 ]; then echo grande\nelif [ $N -gt 3 ]; then echo mediano\nelse echo chico\nfi';
    expect((await sh.run(script)).output).toBe('mediano\n');
    expect((await sh.run('[ -d /etc ] && echo dir')).output).toBe('dir\n');
    expect((await sh.run('test -f /etc/nada || echo no')).output).toBe('no\n');
  });

  it('bucles for, while, break y continue', async () => {
    const sh = createTestShell();
    expect((await sh.run('for x in a b c; do echo $x; done')).output).toBe('a\nb\nc\n');
    expect((await sh.run('i=0; while [ $i -lt 3 ]; do echo $i; i=$((i+1)); done')).output).toBe('0\n1\n2\n');
    expect((await sh.run('for i in 1 2 3 4; do [ $i -eq 2 ] && continue; [ $i -eq 4 ] && break; echo $i; done')).output).toBe('1\n3\n');
  });

  it('sustitución de comandos y separación de palabras', async () => {
    const sh = createTestShell();
    sh.fs.writeFile('/home/neo/a.txt', '');
    sh.fs.writeFile('/home/neo/b.txt', '');
    expect((await sh.run('echo "Soy $(whoami)"')).output).toBe('Soy neo\n');
    expect((await sh.run('for f in $(ls); do echo "-> $f"; done')).output).toBe('-> a.txt\n-> b.txt\n');
    expect((await sh.run('echo $((2 + 3 * 4))')).output).toBe('14\n');
  });

  it('funciones, argumentos, local y return', async () => {
    const sh = createTestShell();
    const script = 'saluda() {\n  local nombre=$1\n  echo "Hola $nombre ($#)"\n  return 3\n}\nsaluda Trinity x; echo $?';
    expect((await sh.run(script)).output).toBe('Hola Trinity (2)\n3\n');
    expect(sh.session.getVar('nombre')).toBeUndefined();
  });

  it('case con varios patrones', async () => {
    const sh = createTestShell();
    const script = 'for f in a.jpg b.txt c.png; do case $f in\n *.jpg|*.png) echo "img $f" ;;\n *) echo "otro $f" ;;\nesac; done';
    expect((await sh.run(script)).output).toBe('img a.jpg\notro b.txt\nimg c.png\n');
  });

  it('ejecuta scripts con shebang, argumentos y permisos', async () => {
    const sh = createTestShell();
    sh.fs.writeFile('/home/neo/hola.sh', '#!/bin/bash\necho "args: $@"\necho "primero: $1"\nexit 4\n');
    expect((await sh.run('./hola.sh')).output).toBe('bash: ./hola.sh: Permission denied\n');
    await sh.run('chmod +x hola.sh 2>/dev/null || true');
    sh.fs.chmod('/home/neo/hola.sh', 0o755);
    const { output, report } = await sh.run('./hola.sh uno dos');
    expect(output).toBe('args: uno dos\nprimero: uno\n');
    expect(report.exitCode).toBe(4);
    expect((await sh.run('bash hola.sh x; echo $?')).output).toBe('args: x\nprimero: x\n4\n');
  });

  it('un script no cambia las variables ni el directorio del padre; source sí', async () => {
    const sh = createTestShell();
    sh.fs.writeFile('/home/neo/cfg.sh', 'COLOR=verde\ncd /tmp\n');
    await sh.run('bash cfg.sh');
    expect(sh.session.getVar('COLOR')).toBeUndefined();
    expect(sh.session.cwd).toBe('/home/neo');
    await sh.run('source cfg.sh');
    expect(sh.session.getVar('COLOR')).toBe('verde');
    expect(sh.session.cwd).toBe('/tmp');
  });

  it('solo los procesos hijos ven las variables exportadas', async () => {
    const sh = createTestShell();
    await sh.run('LOCAL=1; export GLOBAL=2');
    expect((await sh.run('bash -c \'echo "[$LOCAL][$GLOBAL]"\'')).output).toBe('[][2]\n');
    expect((await sh.run('printenv GLOBAL')).output).toBe('2\n');
  });

  it('while read con redirección y here-document', async () => {
    const sh = createTestShell();
    sh.fs.writeFile('/home/neo/u.txt', 'ana 30\nluis 25\n');
    expect((await sh.run('while read nombre edad; do echo "$nombre tiene $edad"; done < u.txt')).output).toBe('ana tiene 30\nluis tiene 25\n');
    expect((await sh.run('cat <<EOF\nHola $USER\nEOF')).output).toBe('Hola neo\n');
    expect((await sh.run("cat <<'EOF'\nHola $USER\nEOF")).output).toBe('Hola $USER\n');
  });

  it('alias y expansión de parámetros', async () => {
    const sh = createTestShell();
    await sh.run("alias saludo='echo hola'");
    expect((await sh.run('saludo mundo')).output).toBe('hola mundo\n');
    await sh.run('F=backup.tar.gz');
    expect((await sh.run('echo ${F%.gz} ${F%%.*} ${#F} ${NADA:-defecto}')).output).toBe('backup.tar backup 13 defecto\n');
  });

  it('detiene los bucles infinitos sin congelar la página', async () => {
    const sh = createTestShell();
    const { output } = await sh.run('while true; do :; done');
    expect(output).toContain('ejecución detenida');
  });
});

describe('comandos de texto', () => {
  const log = '10.0.0.1 GET /a 200\n10.0.0.2 GET /b 404\n10.0.0.1 POST /c 500\n10.0.0.3 GET /a 200\n10.0.0.1 GET /d 200\n';

  it('grep con opciones habituales', async () => {
    const sh = createTestShell();
    sh.fs.writeFile('/home/neo/app.log', 'INFO inicio\nERROR disco\nwarn algo\nerror red\n');
    expect((await sh.run('grep ERROR app.log')).output).toBe('ERROR disco\n');
    expect((await sh.run('grep -i error app.log')).output).toBe('ERROR disco\nerror red\n');
    expect((await sh.run('grep -c -v INFO app.log')).output).toBe('3\n');
    expect((await sh.run('grep -n red app.log')).output).toBe('4:error red\n');
    expect((await sh.run('grep -E "^(INFO|warn)" app.log')).output).toBe('INFO inicio\nwarn algo\n');
    expect((await sh.run('grep -rl disco ~')).output).toBe('/home/neo/app.log\n');
  });

  it('sort, uniq, cut y head: top de IPs', async () => {
    const sh = createTestShell();
    sh.fs.writeFile('/home/neo/access.log', log);
    const { output } = await sh.run('cut -d" " -f1 access.log | sort | uniq -c | sort -rn | head -1');
    expect(output).toBe('      3 10.0.0.1\n');
    expect((await sh.run('sort -k4 -n access.log | tail -1')).output).toBe('10.0.0.1 POST /c 500\n');
  });

  it('awk: columnas, condiciones, sumas y arrays', async () => {
    const sh = createTestShell();
    sh.fs.writeFile('/home/neo/access.log', log);
    expect((await sh.run("awk '{print $1}' access.log | head -2")).output).toBe('10.0.0.1\n10.0.0.2\n');
    expect((await sh.run("awk '$4 >= 400 {print $3, $4}' access.log")).output).toBe('/b 404\n/c 500\n');
    expect((await sh.run("awk '{n[$1]++} END {for (ip in n) if (n[ip] > 1) print ip, n[ip]}' access.log")).output).toBe('10.0.0.1 3\n');
    expect((await sh.run("awk -F: '$3 == 0 {print $1}' /etc/passwd")).output).toBe('root\n');
    expect((await sh.run("awk 'BEGIN {s=0} {s+=$4} END {printf \"%.1f\\n\", s/NR}' access.log")).output).toBe('300.8\n');
  });

  it('sed: sustituir, borrar, rangos y -i', async () => {
    const sh = createTestShell();
    sh.fs.writeFile('/home/neo/cfg', 'Port 22\n#PermitRootLogin yes\nPasswordAuthentication yes\n');
    expect((await sh.run("sed 's/yes/no/' cfg")).output).toBe('Port 22\n#PermitRootLogin no\nPasswordAuthentication no\n');
    expect((await sh.run("sed '/^#/d' cfg")).output).toBe('Port 22\nPasswordAuthentication yes\n');
    expect((await sh.run("sed -n '2,3p' cfg")).output).toBe('#PermitRootLogin yes\nPasswordAuthentication yes\n');
    await sh.run("sed -i 's/^#\\?PermitRootLogin.*/PermitRootLogin no/' cfg");
    expect(sh.fs.readFile('/home/neo/cfg')).toContain('\nPermitRootLogin no\n');
    expect((await sh.run("echo 'a-b-c' | sed -E 's/([a-z])-/\\1+/g'")).output).toBe('a+b+c\n');
  });

  it('tr, tee, xargs, diff y find', async () => {
    const sh = createTestShell();
    expect((await sh.run("echo hola | tr a-z A-Z")).output).toBe('HOLA\n');
    expect((await sh.run("echo 'a  b   c' | tr -s ' '")).output).toBe('a b c\n');
    expect((await sh.run("echo dato | tee copia.txt")).output).toBe('dato\n');
    expect(sh.fs.readFile('/home/neo/copia.txt')).toBe('dato\n');
    await sh.run('mkdir -p p/q && touch p/a.log p/q/b.log p/c.txt');
    expect((await sh.run('find p -name "*.log" | sort')).output).toBe('p/a.log\np/q/b.log\n');
    expect((await sh.run('find p -type d')).output).toBe('p\np/q\n');
    await sh.run('find p -name "*.log" | xargs rm');
    expect((await sh.run('find p -type f')).output).toBe('p/c.txt\n');
    sh.fs.writeFile('/home/neo/v1', 'a\nb\nc\n');
    sh.fs.writeFile('/home/neo/v2', 'a\nB\nc\n');
    expect((await sh.run('diff v1 v2')).output).toBe('2c2\n< b\n---\n> B\n');
    await sh.run('find p -name "*.txt" -exec rm {} \\;');
    expect(sh.fs.exists('/home/neo/p/c.txt')).toBe(false);
  });
});
