/**
 * Capítulo 7 — Procesar texto.
 * sort, uniq, cut, tr, sed, awk, diff y xargs: la navaja suiza del administrador.
 */
import { rewardFor, type Chapter } from '../../domain/curriculum';
import { all, fileContains, fileLinesAre, finalOutputIs, not, notExists, isFile, ran, usedAll } from '../../missions/checks';
import { plantFiles } from '../../missions/worldHelpers';
import { ACCESS_LOG, SALES_CSV, SALES_UNITS, TOP5_IPS, VISITORS } from './data';

const VISITORS_FILE = VISITORS.join('\n') + '\n';
const uniqueSorted = [...new Set(VISITORS)].sort();

export const chapter07: Chapter = {
  id: 'linux-07',
  number: 7,
  title: 'Procesar texto',
  description: 'Ordenar, filtrar, recortar y transformar datos sin escribir un programa.',
  missions: [
    {
      id: 'linux-07-01',
      title: 'Poner orden',
      difficulty: 2,
      teaches: ['sort'],
      briefing: [
        '`sort` ordena líneas alfabéticamente. Opciones clave:',
        '  `-r` al revés   `-n` numérico (10 va después de 9)   `-u` sin repetidos',
        '  `-k 2` por la segunda columna   `-t ,` columnas separadas por comas',
      ],
      objective: 'Muestra los visitantes de ~/visitas.txt ordenados alfabéticamente y SIN repetidos.',
      hints: [
        'sort tiene una opción para quedarse con valores únicos.',
        'sort -u seguido del archivo.',
        'Escribe: sort -u ~/visitas.txt',
      ],
      setup: (world) => plantFiles(world, { '~/visitas.txt': VISITORS_FILE }),
      solution: 'sort -u ~/visitas.txt',
      check: finalOutputIs(uniqueSorted.join('\n')),
      success: 'Lista limpia y ordenada.',
      reward: rewardFor(2),
    },
    {
      id: 'linux-07-02',
      title: 'Contar repetidos',
      difficulty: 3,
      teaches: ['uniq'],
      briefing: [
        '`uniq` elimina líneas repetidas CONSECUTIVAS. Por eso casi siempre va después de sort.',
        '`uniq -c` además cuenta cuántas veces aparecía cada una.',
        'El combo `sort | uniq -c | sort -rn` es un clásico: "¿qué es lo que más se repite?"',
      ],
      objective: 'Cuenta cuántas visitas hizo cada persona de ~/visitas.txt, de más a menos visitas.',
      hints: [
        'Ordena, cuenta con uniq -c y vuelve a ordenar numéricamente al revés.',
        'sort ~/visitas.txt | uniq -c | sort -rn',
        'Escribe: sort ~/visitas.txt | uniq -c | sort -rn',
      ],
      setup: (world) => plantFiles(world, { '~/visitas.txt': VISITORS_FILE }),
      solution: 'sort ~/visitas.txt | uniq -c | sort -rn',
      check: all(usedAll('sort', 'uniq'), (ctx) => /^\s*4 ana/.test(ctx.report.commands.at(-1)?.stdout ?? '')),
      success: 'Ana es la reina del sitio con 4 visitas. Esta tubería te servirá para cualquier log.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-07-03',
      title: 'Recortar columnas',
      difficulty: 3,
      teaches: ['cut'],
      briefing: [
        '`cut` extrae columnas: `-d` indica el separador y `-f` los campos.',
        '/etc/passwd separa sus campos con ":" y el primero es el nombre de usuario.',
        'Ejemplo: `cut -d: -f1,7 /etc/passwd` → usuario y su shell.',
      ],
      objective: 'Muestra solo los nombres de usuario de /etc/passwd (el primer campo).',
      hints: [
        'El separador es ":" y quieres el campo 1.',
        'cut -d: -f1 /etc/passwd',
        'Escribe: cut -d: -f1 /etc/passwd',
      ],
      solution: 'cut -d: -f1 /etc/passwd',
      check: finalOutputIs((ctx) => ctx.fs.readFile('/etc/passwd').split('\n').filter(Boolean).map((l) => l.split(':')[0]).join('\n')),
      success: 'Todos los usuarios del sistema. Muchos son "de servicio" (www-data, syslog...): no son personas.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-07-04',
      title: 'Transformar caracteres',
      difficulty: 2,
      teaches: ['tr'],
      briefing: [
        '`tr` traduce caracteres uno a uno: `tr a-z A-Z` pasa a mayúsculas.',
        '`tr -d "0-9"` borra los dígitos y `tr -s " "` comprime espacios repetidos.',
        'Solo lee de la entrada estándar: se usa siempre con una tubería o con <.',
      ],
      objective: 'Muestra el contenido de ~/grito.txt convertido a MAYÚSCULAS.',
      hints: [
        'tr no acepta archivos como argumento: pásaselo con cat y una tubería (o con <).',
        'cat ~/grito.txt | tr a-z A-Z',
        'Escribe: cat ~/grito.txt | tr a-z A-Z',
      ],
      setup: (world) => plantFiles(world, { '~/grito.txt': 'el servidor esta caido\n' }),
      solution: 'cat ~/grito.txt | tr a-z A-Z',
      check: all(ran('tr'), finalOutputIs('EL SERVIDOR ESTA CAIDO')),
      success: 'EL SERVIDOR ESTÁ CAÍDO (pero tú no).',
      reward: rewardFor(2),
    },
    {
      id: 'linux-07-05',
      title: 'Buscar y reemplazar',
      difficulty: 3,
      teaches: ['sed'],
      briefing: [
        '`sed` edita texto en flujo. Su uso estrella: `sed "s/viejo/nuevo/" archivo`.',
        'La `g` final (`s/a/b/g`) reemplaza TODAS las apariciones de cada línea.',
        'Con `-i` modifica el archivo directamente (sin -i solo muestra el resultado).',
        'Así se cambian configuraciones en scripts sin abrir un editor.',
      ],
      objective: 'En ~/app/config.ini cambia "debug=true" por "debug=false" modificando el archivo.',
      hints: [
        'Necesitas sed con la orden s/// y la opción para editar el archivo en su sitio.',
        "sed -i 's/debug=true/debug=false/' ~/app/config.ini",
        "Escribe: sed -i 's/debug=true/debug=false/' ~/app/config.ini",
      ],
      setup: (world) => plantFiles(world, { '~/app/config.ini': '[app]\nnombre=tienda\ndebug=true\npuerto=8080\n' }),
      solution: "sed -i 's/debug=true/debug=false/' ~/app/config.ini",
      check: all(fileContains('~/app/config.ini', /^debug=false$/m), not(fileContains('~/app/config.ini', /debug=true/)), fileContains('~/app/config.ini', /puerto=8080/)),
      success: 'Modo debug desactivado en producción. Nunca dejes debug=true en un servidor real.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-07-06',
      title: 'Calculadora de columnas',
      difficulty: 4,
      teaches: ['awk'],
      briefing: [
        '`awk` procesa texto por columnas: `$1` es la primera, `$2` la segunda, `$0` la línea entera.',
        '`awk -F, "{print $1}"` usa la coma como separador.',
        'Puede filtrar (`NR > 1` salta la cabecera) y calcular: `{s += $2} END {print s}` suma la columna 2.',
      ],
      objective: 'Suma el total de unidades (columna 2) de ~/ventas.csv sin contar la cabecera.',
      hints: [
        'Separador coma, salta la línea 1 (NR > 1), acumula $2 y muéstralo en END.',
        "awk -F, 'NR > 1 {s += $2} END {print s}' ~/ventas.csv",
        "Escribe: awk -F, 'NR > 1 {s += $2} END {print s}' ~/ventas.csv",
      ],
      setup: (world) => plantFiles(world, { '~/ventas.csv': SALES_CSV }),
      solution: "awk -F, 'NR > 1 {s += $2} END {print s}' ~/ventas.csv",
      check: all(ran('awk'), finalOutputIs(String(SALES_UNITS))),
      success: `${SALES_UNITS} unidades vendidas. awk es un lenguaje entero: con esto ya cubres el 90 % de su uso real.`,
      reward: rewardFor(4),
    },
    {
      id: 'linux-07-07',
      title: 'Encuentra las diferencias',
      difficulty: 3,
      teaches: ['diff'],
      briefing: [
        '`diff a b` compara dos archivos línea a línea.',
        '`<` son líneas de a, `>` líneas de b. `diff -u` usa el formato "unificado" de git y los parches.',
      ],
      objective: 'Compara ~/config/produccion.conf con ~/config/staging.conf y escribe con echo el puerto que tiene staging.',
      hints: [
        'Ejecuta diff con los dos archivos y fíjate en la línea marcada con >.',
        'diff ~/config/produccion.conf ~/config/staging.conf',
        'Escribe: echo 8443',
      ],
      setup: (world) => plantFiles(world, {
        '~/config/produccion.conf': 'host=0.0.0.0\nport=443\nworkers=8\nlog=warn\n',
        '~/config/staging.conf': 'host=0.0.0.0\nport=8443\nworkers=8\nlog=warn\n',
      }),
      solution: 'diff ~/config/produccion.conf ~/config/staging.conf; echo 8443',
      check: (ctx) => ctx.report.commands.some((c) => c.name === 'echo' && c.stdout.trim() === '8443'),
      success: 'La única diferencia: el puerto. diff es la base de git, que verás más adelante.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-07-08',
      title: 'De lista a argumentos',
      difficulty: 3,
      teaches: ['xargs'],
      briefing: [
        'Algunos comandos (rm, mkdir, touch...) no leen de una tubería: necesitan argumentos.',
        '`xargs` convierte la entrada en argumentos: `cat lista.txt | xargs rm` borra todo lo de la lista.',
      ],
      objective: 'Borra todos los archivos que aparecen en ~/limpieza/borrar.txt usando xargs.',
      hints: [
        'Pasa el contenido de la lista a xargs y que xargs llame a rm.',
        'cd ~/limpieza && cat borrar.txt | xargs rm',
        'Escribe: cd ~/limpieza && cat borrar.txt | xargs rm',
      ],
      setup: (world) => plantFiles(world, {
        '~/limpieza/borrar.txt': 'temp1.log\ntemp2.log\ncache.dat\n',
        '~/limpieza/temp1.log': '', '~/limpieza/temp2.log': '', '~/limpieza/cache.dat': '', '~/limpieza/importante.db': 'datos',
      }),
      solution: 'cd ~/limpieza && cat borrar.txt | xargs rm',
      check: all(ran('xargs'), notExists('~/limpieza/temp1.log'), notExists('~/limpieza/temp2.log'), notExists('~/limpieza/cache.dat'), isFile('~/limpieza/importante.db')),
      success: 'Limpieza masiva hecha. xargs + find es una combinación muy potente.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-07-09',
      title: 'JEFE: Top 5 de IPs',
      difficulty: 5,
      boss: true,
      teaches: [],
      briefing: [
        '⚠ La tienda va lenta. Sospechamos que unas pocas IPs están saturando el servidor web.',
        'En ~/logs/access.log cada línea es una petición y la IP es la PRIMERA columna.',
        'Guarda en ~/top5.txt las 5 IPs con más peticiones, de más a menos, SOLO la IP (una por línea).',
      ],
      objective: 'Crea ~/top5.txt con las 5 IPs que más peticiones hacen en ~/logs/access.log (solo las IPs, de más a menos).',
      hints: [
        'Extrae la 1.ª columna, ordena, cuenta repetidos, ordena por número y quédate con 5. Al final, quita los números.',
        "awk '{print $1}' ... | sort | uniq -c | sort -rn | head -5 | awk '{print $2}' > ~/top5.txt",
        "Escribe: awk '{print $1}' ~/logs/access.log | sort | uniq -c | sort -rn | head -5 | awk '{print $2}' > ~/top5.txt",
      ],
      setup: (world) => plantFiles(world, { '~/logs/access.log': ACCESS_LOG }),
      solution: "awk '{print $1}' ~/logs/access.log | sort | uniq -c | sort -rn | head -5 | awk '{print $2}' > ~/top5.txt",
      check: fileLinesAre('~/top5.txt', TOP5_IPS),
      success: 'Tienes a los sospechosos. Esta tubería de 6 comandos es exactamente lo que haría un SRE en un incidente real.',
      reward: rewardFor(5, true),
    },
  ],
};
