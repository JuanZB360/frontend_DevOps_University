/**
 * Capítulo 13 — Bash scripting.
 * Scripts, argumentos, condiciones, bucles, funciones, códigos de salida y $(...).
 */
import { formatDate } from '../../../engine/commands/system/identity';
import { rewardFor, type Chapter, type MissionCheck } from '../../domain/curriculum';
import { all, fileContains, isDirectory, isFile, outputMatches } from '../../missions/checks';
import { plantFiles } from '../../missions/worldHelpers';

/** El archivo existe y el dueño puede ejecutarlo. */
const isExecutable = (path: string): MissionCheck => (ctx) => {
  const abs = path.startsWith('~/') ? ctx.session.home + path.slice(1) : path;
  const node = ctx.fs.tryStat(abs);
  return node?.type === 'file' && (node.mode & 0o100) !== 0;
};

/** Algún echo de la línea imprimió algo que cumple el patrón (salida de un script). */
const echoed = (pattern: RegExp): MissionCheck => (ctx) => ctx.report.commands.some((c) => (c.name === 'echo' || c.name === 'printf') && pattern.test(c.stdout));

export const chapter13: Chapter = {
  id: 'linux-13',
  number: 13,
  title: 'Bash scripting',
  description: 'Automatiza. Todo lo que hagas dos veces, conviértelo en un script.',
  missions: [
    {
      id: 'linux-13-01',
      title: 'Tu primer script',
      difficulty: 2,
      teaches: ['bash', 'sh', 'printf'],
      briefing: [
        'Un script es un archivo de texto con comandos. La primera línea (shebang) dice quién lo ejecuta:',
        '  `#!/bin/bash`',
        'Créalo con nano, o en una línea con printf (que entiende \\n como salto de línea): `printf \'línea1\\nlínea2\\n\' > archivo`',
        'Dale permiso de ejecución y lánzalo con ./script.sh',
        'También puedes ejecutarlo sin permiso x con: `bash script.sh`',
      ],
      objective: 'Crea ~/hola.sh que imprima "Hola desde un script", hazlo ejecutable y ejecútalo.',
      hints: [
        'Escribe las dos líneas en el archivo (nano ~/hola.sh), luego chmod +x.',
        "printf '#!/bin/bash\\necho \"Hola desde un script\"\\n' > ~/hola.sh",
        "Escribe: printf '#!/bin/bash\\necho \"Hola desde un script\"\\n' > ~/hola.sh && chmod +x ~/hola.sh && ~/hola.sh",
      ],
      solution: "printf '#!/bin/bash\\necho \"Hola desde un script\"\\n' > ~/hola.sh && chmod +x ~/hola.sh && ~/hola.sh",
      check: all(isExecutable('~/hola.sh'), fileContains('~/hola.sh', /^#!\/bin\/(ba)?sh/), echoed(/Hola desde un script/)),
      success: 'Has programado tu primer script. A partir de aquí, todo es automatizable.',
      reward: rewardFor(2),
    },
    {
      id: 'linux-13-02',
      title: 'Argumentos',
      difficulty: 3,
      teaches: [],
      briefing: [
        'Un script recibe argumentos: `$1` es el primero, `$2` el segundo, `$#` cuántos hay y `$@` todos.',
        'Ejemplo: ./saluda.sh Trinity → dentro, $1 vale "Trinity".',
      ],
      objective: 'Crea ~/saluda.sh que imprima "Hola, NOMBRE" usando $1, y ejecútalo con el argumento Trinity.',
      hints: [
        'El script es: #!/bin/bash y echo "Hola, $1"',
        "printf '#!/bin/bash\\necho \"Hola, $1\"\\n' > ~/saluda.sh && chmod +x ~/saluda.sh",
        "Escribe: printf '#!/bin/bash\\necho \"Hola, $1\"\\n' > ~/saluda.sh && chmod +x ~/saluda.sh && ~/saluda.sh Trinity",
      ],
      solution: "printf '#!/bin/bash\\necho \"Hola, $1\"\\n' > ~/saluda.sh && chmod +x ~/saluda.sh && ~/saluda.sh Trinity",
      check: all(fileContains('~/saluda.sh', /\$1|\$\{1\}/), echoed(/^Hola, Trinity$/m)),
      success: 'El mismo script sirve para cualquier nombre. Los argumentos hacen reutilizables tus herramientas.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-13-03',
      title: 'Decisiones',
      difficulty: 3,
      teaches: ['test', '[', 'true', 'false'],
      briefing: [
        '`if [ condición ]; then ... else ... fi` decide qué hacer. ¡Los espacios dentro de [ ] son obligatorios!',
        'Condiciones útiles: `-f archivo` existe, `-d dir` es directorio, `-z "$x"` vacío,',
        '`"$a" = "$b"` textos iguales, `$n -gt 5` mayor que (-lt, -eq, -ne, -ge, -le).',
      ],
      objective: 'Crea ~/existe.sh: si el archivo $1 existe imprime "EXISTE", si no "NO EXISTE". Pruébalo con /etc/passwd.',
      hints: [
        'Usa if [ -f "$1" ]; then echo EXISTE; else echo "NO EXISTE"; fi',
        "printf '#!/bin/bash\\nif [ -f \"$1\" ]; then\\n  echo EXISTE\\nelse\\n  echo \"NO EXISTE\"\\nfi\\n' > ~/existe.sh",
        "Escribe: printf '#!/bin/bash\\nif [ -f \"$1\" ]; then\\n  echo EXISTE\\nelse\\n  echo \"NO EXISTE\"\\nfi\\n' > ~/existe.sh && bash ~/existe.sh /etc/passwd",
      ],
      solution: "printf '#!/bin/bash\\nif [ -f \"$1\" ]; then\\n  echo EXISTE\\nelse\\n  echo \"NO EXISTE\"\\nfi\\n' > ~/existe.sh && bash ~/existe.sh /etc/passwd",
      check: all(fileContains('~/existe.sh', /\bif\b[\s\S]*\bfi\b/), echoed(/^EXISTE$/m)),
      success: 'Tu script ya toma decisiones.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-13-04',
      title: 'Repetir',
      difficulty: 3,
      teaches: ['seq'],
      briefing: [
        '`for x in a b c; do ... ; done` repite algo para cada elemento.',
        'Con números: `for i in $(seq 1 5); do echo $i; done`',
        'Se puede escribir en una línea, directamente en la terminal.',
      ],
      objective: 'Con un bucle for, crea los directorios ~/semana/dia1 hasta ~/semana/dia7.',
      hints: [
        'Recorre del 1 al 7 con seq y crea cada directorio con mkdir -p.',
        'for i in $(seq 1 7); do mkdir -p ~/semana/dia$i; done',
        'Escribe: for i in $(seq 1 7); do mkdir -p ~/semana/dia$i; done',
      ],
      solution: 'for i in $(seq 1 7); do mkdir -p ~/semana/dia$i; done',
      check: all(...[1, 2, 3, 4, 5, 6, 7].map((n) => isDirectory(`~/semana/dia${n}`)), (ctx) => /\b(for|while)\b/.test(ctx.report.line)),
      success: 'Siete directorios en una línea. Ahora imagina 500 usuarios o 1000 servidores.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-13-05',
      title: 'Leer línea a línea',
      difficulty: 4,
      teaches: ['read'],
      briefing: [
        '`while read linea; do ... done < archivo` procesa un archivo línea a línea.',
        'read puede separar en varias variables: `while read nombre edad; do ...`',
      ],
      objective: 'Para cada usuario de ~/nuevos.txt crea un archivo vacío ~/fichas/USUARIO.txt usando while read.',
      hints: [
        'Crea ~/fichas y recorre el archivo con while read u; do touch ~/fichas/$u.txt; done < ~/nuevos.txt',
        'mkdir -p ~/fichas && while read u; do touch ~/fichas/$u.txt; done < ~/nuevos.txt',
        'Escribe: mkdir -p ~/fichas && while read u; do touch ~/fichas/$u.txt; done < ~/nuevos.txt',
      ],
      setup: (world) => plantFiles(world, { '~/nuevos.txt': 'ana\nluis\nmarta\npedro\n' }),
      solution: 'mkdir -p ~/fichas && while read u; do touch ~/fichas/$u.txt; done < ~/nuevos.txt',
      check: all(isFile('~/fichas/ana.txt'), isFile('~/fichas/luis.txt'), isFile('~/fichas/marta.txt'), isFile('~/fichas/pedro.txt')),
      success: 'Has procesado un archivo de datos. Con esto se dan de alta usuarios en lote.',
      reward: rewardFor(4),
    },
    {
      id: 'linux-13-06',
      title: '¿Funcionó?',
      difficulty: 3,
      teaches: [],
      briefing: [
        'Todo comando termina con un CÓDIGO DE SALIDA: 0 = éxito, otro número = error. `$?` guarda el último.',
        'Por eso funcionan && (si fue bien) y || (si falló).',
        'En un script, `exit 1` termina indicando error: así otros programas saben que algo falló.',
      ],
      objective: 'Crea ~/check.sh que haga `exit 0` si /etc/hosts existe y `exit 1` si no. Ejecútalo y muestra su código con echo $?.',
      hints: [
        'if [ -f /etc/hosts ]; then exit 0; else exit 1; fi',
        "printf '#!/bin/bash\\nif [ -f /etc/hosts ]; then exit 0; else exit 1; fi\\n' > ~/check.sh",
        "Escribe: printf '#!/bin/bash\\nif [ -f /etc/hosts ]; then exit 0; else exit 1; fi\\n' > ~/check.sh && bash ~/check.sh; echo $?",
      ],
      solution: "printf '#!/bin/bash\\nif [ -f /etc/hosts ]; then exit 0; else exit 1; fi\\n' > ~/check.sh && bash ~/check.sh; echo $?",
      check: all(fileContains('~/check.sh', /exit\s+1/), fileContains('~/check.sh', /exit\s+0/), outputMatches('echo', /^0$/m)),
      success: 'Código 0: todo bien. Los sistemas de monitoreo y CI/CD funcionan exactamente así.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-13-07',
      title: 'Funciones',
      difficulty: 4,
      teaches: ['local', 'return', 'type'],
      briefing: [
        'Una función agrupa comandos con nombre: `saludar() { echo "Hola $1"; }`',
        'Se llama como un comando: `saludar Neo`. Dentro, $1 es el argumento de la FUNCIÓN.',
        '`local x=...` crea variables que solo existen dentro de la función.',
      ],
      objective: 'Crea ~/log.sh con una función log que imprima "[INFO] MENSAJE" y llámala con "Backup completado".',
      hints: [
        'log() { echo "[INFO] $1"; } y después: log "Backup completado"',
        "printf '#!/bin/bash\\nlog() {\\n  echo \"[INFO] $1\"\\n}\\nlog \"Backup completado\"\\n' > ~/log.sh",
        "Escribe: printf '#!/bin/bash\\nlog() {\\n  echo \"[INFO] $1\"\\n}\\nlog \"Backup completado\"\\n' > ~/log.sh && bash ~/log.sh",
      ],
      solution: "printf '#!/bin/bash\\nlog() {\\n  echo \"[INFO] $1\"\\n}\\nlog \"Backup completado\"\\n' > ~/log.sh && bash ~/log.sh",
      check: all(fileContains('~/log.sh', /log\s*\(\)\s*\{|function\s+log/), echoed(/^\[INFO\] Backup completado$/m)),
      success: 'Funciones: el código se organiza y se reutiliza. Todos los scripts serios las usan.',
      reward: rewardFor(4),
    },
    {
      id: 'linux-13-08',
      title: 'JEFE: Script de backup con fecha',
      difficulty: 5,
      boss: true,
      teaches: ['date', 'tar'],
      briefing: [
        '⚠ Necesitamos un script de backup reutilizable: ~/backup.sh',
        '  · Comprime ~/documentos en ~/backups/documentos-AAAA-MM-DD.tar.gz (fecha de hoy)',
        '  · Crea ~/backups si no existe',
        '  · Imprime "Backup OK" si todo fue bien',
        'Herramientas: `$(date +%F)` da la fecha AAAA-MM-DD y `tar -czf destino origen` comprime (lo verás a fondo en el capítulo siguiente).',
        'El script debe ser ejecutable y debes ejecutarlo.',
      ],
      objective: 'Crea y ejecuta ~/backup.sh que guarde ~/documentos en ~/backups/documentos-FECHA.tar.gz',
      hints: [
        'Pasos: FECHA=$(date +%F); mkdir -p ~/backups; tar -czf ~/backups/documentos-$FECHA.tar.gz -C ~ documentos && echo "Backup OK"',
        "Escribe el script con nano o con printf, y recuerda chmod +x.",
        "Escribe: printf '#!/bin/bash\\nFECHA=$(date +%%F)\\nmkdir -p ~/backups\\ntar -czf ~/backups/documentos-$FECHA.tar.gz -C ~ documentos && echo \"Backup OK\"\\n' > ~/backup.sh && chmod +x ~/backup.sh && ~/backup.sh",
      ],
      setup: (world) => plantFiles(world, { '~/documentos/contrato.txt': 'Contrato de servicio\n', '~/documentos/clientes.csv': 'id,nombre\n1,ACME\n' }),
      solution: "printf '#!/bin/bash\\nFECHA=$(date +%%F)\\nmkdir -p ~/backups\\ntar -czf ~/backups/documentos-$FECHA.tar.gz -C ~ documentos && echo \"Backup OK\"\\n' > ~/backup.sh && chmod +x ~/backup.sh && ~/backup.sh",
      check: all(
        isExecutable('~/backup.sh'),
        fileContains('~/backup.sh', /date/),
        (ctx) => isFile(`~/backups/documentos-${formatDate(new Date(ctx.fs.now()), '%F')}.tar.gz`)(ctx),
        echoed(/Backup OK/),
      ),
      success: 'Script de backup profesional. En el capítulo de cron lo programarás para que se ejecute solo cada noche.',
      reward: rewardFor(5, true),
    },
  ],
};

