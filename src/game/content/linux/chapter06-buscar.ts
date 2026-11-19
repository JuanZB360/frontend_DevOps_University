/**
 * Capítulo 6 — Buscar.
 * which, find, locate y grep (con expresiones regulares básicas).
 */
import { rewardFor, type Chapter } from '../../domain/curriculum';
import { all, fileLinesAre, finalOutputIs, finalOutputMatches, isFile, notExists, outputMatches, ran, ranWithFlag } from '../../missions/checks';
import { plantFiles, setAge, setSize } from '../../missions/worldHelpers';
import { APP_LOG, APP_LOG_LINES } from './data';

const FAILED_LOGINS = 24;

export const chapter06: Chapter = {
  id: 'linux-06',
  number: 6,
  title: 'Buscar',
  description: 'En un servidor hay cientos de miles de archivos. Encontrar lo que buscas es un superpoder.',
  missions: [
    {
      id: 'linux-06-01',
      title: '¿Dónde está el programa?',
      difficulty: 1,
      teaches: ['which', 'type'],
      briefing: [
        'Cada comando es (casi siempre) un archivo ejecutable en algún directorio del PATH.',
        '`which comando` te dice cuál se ejecuta: `which ls` → /usr/bin/ls',
        '`type comando` además distingue alias y builtins del shell (como cd).',
      ],
      objective: 'Averigua en qué ruta está el programa tar.',
      hints: [
        'Pregunta "¿cuál?" en inglés.',
        'which seguido del nombre del programa.',
        'Escribe: which tar',
      ],
      solution: 'which tar',
      check: outputMatches('which', /\/usr\/bin\/tar/),
      success: '/usr/bin/tar. Cuando un comando "no existe", which es lo primero que debes probar.',
      reward: rewardFor(1),
    },
    {
      id: 'linux-06-02',
      title: 'El archivo perdido',
      difficulty: 3,
      teaches: ['find'],
      briefing: [
        '`find RUTA -name PATRÓN` recorre directorios buscando por nombre.',
        'Ejemplo: `find ~ -name "*.pdf"` busca todos los PDF de tu home.',
        'Pon el patrón entre comillas para que el shell no expanda el asterisco antes de tiempo.',
      ],
      objective: 'Alguien guardó credenciales.txt en algún lugar de ~/archivo. Encuéntralo y muévelo a tu home (~).',
      hints: [
        'Primero busca la ruta con find, después muévelo con mv.',
        'find ~/archivo -name credenciales.txt te dirá dónde está.',
        'Escribe: mv $(find ~/archivo -name credenciales.txt) ~/',
      ],
      setup: (world) => plantFiles(world, {
        '~/archivo/2019/q1/facturas.pdf': '', '~/archivo/2019/q2/': '', '~/archivo/2021/viejo/backup/notas/credenciales.txt': 'usuario: admin\nclave: hunter2\n',
        '~/archivo/2022/fotos/equipo.jpg': '', '~/archivo/2023/README.md': 'Nada interesante aquí\n',
      }),
      solution: 'mv $(find ~/archivo -name credenciales.txt) ~/',
      check: all(isFile('~/credenciales.txt'), notExists('~/archivo/2021/viejo/backup/notas/credenciales.txt')),
      success: 'Encontrado y rescatado. Sin find habrías tenido que abrir carpeta por carpeta.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-06-03',
      title: 'Archivos pesados',
      difficulty: 3,
      teaches: [],
      briefing: [
        'find también busca por tipo y tamaño:',
        '  `-type f` solo archivos, `-type d` solo directorios',
        '  `-size +100M` más de 100 MB, `-size -1k` menos de 1 KB',
        'Y puede actuar: `-delete` borra lo encontrado (⚠ prueba siempre SIN -delete primero).',
      ],
      objective: 'Borra con find todos los archivos de más de 50 MB dentro de ~/descargas (los pequeños deben quedarse).',
      hints: [
        'Combina -type f y -size +50M. Comprueba la lista antes de borrar.',
        'Añade -delete al final cuando estés seguro.',
        'Escribe: find ~/descargas -type f -size +50M -delete',
      ],
      setup: (world) => {
        plantFiles(world, {
          '~/descargas/ubuntu.iso': '', '~/descargas/pelicula.mkv': '', '~/descargas/video/curso.mp4': '',
          '~/descargas/factura.pdf': 'pdf', '~/descargas/notas.txt': 'notas', '~/descargas/video/subtitulos.srt': 'srt',
        });
        setSize(world, '~/descargas/ubuntu.iso', 2_500_000_000);
        setSize(world, '~/descargas/pelicula.mkv', 900_000_000);
        setSize(world, '~/descargas/video/curso.mp4', 300_000_000);
        setSize(world, '~/descargas/factura.pdf', 180_000);
      },
      solution: 'find ~/descargas -type f -size +50M -delete',
      check: all(notExists('~/descargas/ubuntu.iso'), notExists('~/descargas/pelicula.mkv'), notExists('~/descargas/video/curso.mp4'), isFile('~/descargas/factura.pdf'), isFile('~/descargas/notas.txt'), isFile('~/descargas/video/subtitulos.srt')),
      success: '3,7 GB liberados sin tocar nada importante. Así se limpia un disco de verdad.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-06-04',
      title: 'Buscar dentro de los archivos',
      difficulty: 2,
      teaches: ['grep'],
      briefing: [
        'find busca ARCHIVOS. `grep` busca TEXTO dentro de los archivos.',
        '`grep PATRÓN archivo` muestra solo las líneas que contienen el patrón.',
        'Es, probablemente, el comando más útil para leer logs.',
      ],
      objective: 'Muestra solo las líneas con ERROR de /var/log/app.log',
      hints: [
        'grep recibe primero lo que buscas y después el archivo.',
        'Las mayúsculas importan: busca ERROR tal cual.',
        'Escribe: grep ERROR /var/log/app.log',
      ],
      setup: (world) => plantFiles(world, { '/var/log/app.log': APP_LOG }),
      solution: 'grep ERROR /var/log/app.log',
      check: finalOutputIs(APP_LOG_LINES.filter((l) => l.includes('ERROR')).join('\n')),
      success: 'De 60 líneas a las que importan. grep es tu lupa.',
      reward: rewardFor(2),
    },
    {
      id: 'linux-06-05',
      title: 'Contar ataques',
      difficulty: 3,
      teaches: [],
      briefing: [
        'Opciones de grep que usarás a diario:',
        '  `-i` ignora mayúsculas   `-n` muestra el número de línea   `-v` invierte (lo que NO coincide)',
        '  `-c` cuenta las coincidencias en vez de mostrarlas',
        '/var/log/auth.log registra los inicios de sesión. Cada "Failed password" es un intento fallido.',
      ],
      objective: 'Cuenta cuántos intentos "Failed password" hay en /var/log/auth.log',
      hints: [
        'No necesitas wc: grep tiene una opción para contar.',
        'grep -c "Failed password" seguido del archivo.',
        'Escribe: grep -c "Failed password" /var/log/auth.log',
      ],
      solution: 'grep -c "Failed password" /var/log/auth.log',
      check: finalOutputIs(String(FAILED_LOGINS)),
      success: `${FAILED_LOGINS} intentos de entrar por fuerza bruta. Bienvenido a Internet: esto le pasa a TODOS los servidores.`,
      reward: rewardFor(3),
    },
    {
      id: 'linux-06-06',
      title: 'La fuga',
      difficulty: 3,
      teaches: [],
      briefing: [
        '`grep -r PATRÓN directorio` busca de forma recursiva en todos los archivos.',
        'Combinado con `-n` e `-i`, encuentras cualquier cosa en un proyecto entero.',
        'Un clásico de seguridad: buscar contraseñas escritas a mano en el código.',
      ],
      objective: 'Alguien dejó una contraseña en el código de ~/webapp. Encuentra el archivo con grep -r (busca "password", sin importar mayúsculas).',
      hints: [
        'Necesitas búsqueda recursiva e ignorar mayúsculas.',
        'grep -rin password seguido del directorio.',
        'Escribe: grep -rin password ~/webapp',
      ],
      setup: (world) => plantFiles(world, {
        '~/webapp/index.js': "const app = require('./app');\napp.listen(3000);\n",
        '~/webapp/src/db/conexion.js': "module.exports = {\n  host: 'db01',\n  user: 'tienda',\n  PASSWORD: 'Sup3rS3cr3t0',\n};\n",
        '~/webapp/src/rutas/usuarios.js': "// TODO: validar la contraseña del formulario\n",
        '~/webapp/README.md': '# Tienda online\n',
      }),
      solution: 'grep -rin password ~/webapp',
      check: all(ranWithFlag('grep', 'r'), finalOutputMatches(/conexion\.js.*Sup3rS3cr3t0/)),
      success: 'Fuga localizada en src/db/conexion.js. Las contraseñas van en variables de entorno, nunca en el código.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-06-07',
      title: 'Patrones',
      difficulty: 3,
      teaches: ['egrep'],
      briefing: [
        'grep entiende expresiones regulares (regex):',
        '  `^` inicio de línea   `$` final   `.` cualquier carácter   `*` repetir   `[0-9]` un dígito',
        'Con `-E` (extendidas) también: `+` (una o más), `|` (o) y paréntesis: `grep -E "WARN|ERROR"`',
      ],
      objective: 'Muestra las líneas de /var/log/app.log que son WARN o ERROR (en un solo grep).',
      hints: [
        'Necesitas "esto O aquello": la barra | de las regex extendidas.',
        'grep -E con el patrón "WARN|ERROR" entre comillas.',
        'Escribe: grep -E "WARN|ERROR" /var/log/app.log',
      ],
      setup: (world) => plantFiles(world, { '/var/log/app.log': APP_LOG }),
      solution: 'grep -E "WARN|ERROR" /var/log/app.log',
      check: finalOutputIs(APP_LOG_LINES.filter((l) => /WARN|ERROR/.test(l)).join('\n')),
      success: 'Regex básicas desbloqueadas. Son un idioma universal: grep, sed, awk, Python, JavaScript...',
      reward: rewardFor(3),
    },
    {
      id: 'linux-06-08',
      title: 'Búsqueda instantánea',
      difficulty: 2,
      teaches: ['locate', 'updatedb'],
      briefing: [
        'find recorre el disco cada vez: es exacto pero lento en discos grandes.',
        '`locate nombre` busca en un índice precalculado: es instantáneo.',
        'El índice se actualiza cada noche (o a mano con `sudo updatedb`), así que no ve archivos recién creados.',
      ],
      objective: 'Localiza dónde está el archivo de configuración sshd_config con locate.',
      hints: [
        'locate recibe solo el nombre (o parte del nombre).',
        'No hace falta indicar dónde buscar.',
        'Escribe: locate sshd_config',
      ],
      solution: 'locate sshd_config',
      check: outputMatches('locate', /\/etc\/ssh\/sshd_config/),
      success: 'Encontrado en milisegundos. Usa locate para buscar rápido y find para buscar con precisión.',
      reward: rewardFor(2),
    },
    {
      id: 'linux-06-09',
      title: 'JEFE: Configuraciones modificadas',
      difficulty: 4,
      boss: true,
      teaches: [],
      briefing: [
        '⚠ Anoche alguien tocó la configuración del servidor de pruebas (copiado en ~/servidor).',
        'Necesitamos la lista EXACTA de archivos .conf modificados en los últimos 2 días.',
        'Guárdala en ~/modificados.txt (una ruta por línea, tal como la imprime find).',
        'Pista de N0X: `-mtime -2` significa "modificado hace menos de 2 días".',
      ],
      objective: 'Guarda en ~/modificados.txt los .conf de ~/servidor modificados hace menos de 2 días.',
      hints: [
        'find puede combinar -name y -mtime; y su salida se puede redirigir con >.',
        'find ~/servidor -name "*.conf" -mtime -2',
        'Escribe: find ~/servidor -name "*.conf" -mtime -2 > ~/modificados.txt',
      ],
      setup: (world) => {
        plantFiles(world, {
          '~/servidor/etc/nginx/nginx.conf': 'worker_processes auto;\n', '~/servidor/etc/nginx/sites.conf': 'server { listen 80; }\n',
          '~/servidor/etc/mysql/my.conf': '[mysqld]\nport=3306\n', '~/servidor/etc/app/app.conf': 'debug=false\n',
          '~/servidor/etc/app/cache.conf': 'ttl=60\n', '~/servidor/etc/ssh/sshd.conf': 'PermitRootLogin yes\n', '~/servidor/etc/app/notas.txt': 'cambié cosas\n',
        });
        setAge(world, ['~/servidor/etc/nginx/nginx.conf', '~/servidor/etc/mysql/my.conf', '~/servidor/etc/app/cache.conf'], 40);
        setAge(world, ['~/servidor/etc/nginx/sites.conf', '~/servidor/etc/app/app.conf', '~/servidor/etc/ssh/sshd.conf', '~/servidor/etc/app/notas.txt'], 0.3);
      },
      solution: 'find ~/servidor -name "*.conf" -mtime -2 > ~/modificados.txt',
      check: (ctx) => {
        const home = ctx.session.home;
        const expected = ['etc/app/app.conf', 'etc/nginx/sites.conf', 'etc/ssh/sshd.conf'];
        const prefixes = ['~/servidor/', `${home}/servidor/`];
        return prefixes.some((p) => fileLinesAre('~/modificados.txt', expected.map((e) => p + e), false)(ctx)) && ran('find')(ctx);
      },
      success: 'Tres archivos sospechosos localizados: sites.conf, app.conf y sshd.conf. Auditoría superada.',
      reward: rewardFor(4, true),
    },
  ],
};
