/**
 * Capítulo 4 — Leer contenido.
 * cat, less, head, tail y wc: leer archivos y logs sin abrir un editor.
 */
import { rewardFor, type Chapter } from '../../domain/curriculum';
import { all, finalOutputIs, outputEquals, outputMatches, ran, ranWithFlag } from '../../missions/checks';
import { plantFiles } from '../../missions/worldHelpers';
import { APP_LOG, APP_LOG_LINES } from './data';

const REPORT = 'INFORME DEL SERVIDOR devops-u\n=============================\nEstado: operativo\nUsuarios activos: 12\nÚltima copia de seguridad: hace 2 días\nCódigo de verificación: ORION-7\n';

const CHANGELOG = Array.from({ length: 80 }, (_, i) => `v1.${80 - i}.0 - ${['Corrige errores menores', 'Mejora el rendimiento', 'Añade soporte para HTTPS', 'Actualiza dependencias'][i % 4]}`).join('\n') + '\n';

export const chapter04: Chapter = {
  id: 'linux-04',
  number: 4,
  title: 'Leer contenido',
  description: 'Un administrador pasa la mitad del día leyendo archivos y logs. Aprende a hacerlo rápido.',
  missions: [
    {
      id: 'linux-04-01',
      title: 'Abre el informe',
      difficulty: 1,
      teaches: ['cat'],
      briefing: [
        '`cat archivo` (de "concatenate") muestra el contenido de un archivo en la pantalla.',
        'Es perfecto para archivos cortos: configuraciones, notas, scripts...',
        'Si le das varios archivos, los muestra uno detrás de otro: `cat a.txt b.txt`.',
      ],
      objective: 'Muestra el contenido de ~/informes/servidor.txt',
      hints: [
        'El comando para mostrar archivos cortos tiene tres letras.',
        'cat seguido de la ruta del archivo.',
        'Escribe: cat ~/informes/servidor.txt',
      ],
      setup: (world) => plantFiles(world, { '~/informes/servidor.txt': REPORT }),
      solution: 'cat ~/informes/servidor.txt',
      check: outputMatches('cat', /ORION-7/),
      success: 'Código ORION-7 recibido. cat será tu herramienta más usada para echar un vistazo rápido.',
      reward: rewardFor(1),
    },
    {
      id: 'linux-04-02',
      title: 'Líneas numeradas',
      difficulty: 2,
      teaches: [],
      briefing: [
        'Cuando un error dice "línea 23", necesitas ver los números de línea.',
        '`cat -n archivo` numera todas las líneas.',
      ],
      objective: 'Muestra ~/informes/servidor.txt con las líneas numeradas.',
      hints: [
        'cat tiene una opción para numerar ("number").',
        'Usa la opción -n.',
        'Escribe: cat -n ~/informes/servidor.txt',
      ],
      setup: (world) => plantFiles(world, { '~/informes/servidor.txt': REPORT }),
      solution: 'cat -n ~/informes/servidor.txt',
      check: ranWithFlag('cat', 'n'),
      success: 'Ahora sabes en qué línea está cada cosa. Muy útil cuando un programa se queja de "error en la línea 4".',
      reward: rewardFor(2),
    },
    {
      id: 'linux-04-03',
      title: 'Archivos largos',
      difficulty: 2,
      teaches: ['less', 'more'],
      briefing: [
        'Si un archivo tiene cientos de líneas, cat lo vuelca de golpe y solo ves el final.',
        '`less archivo` lo muestra página a página: ↑↓ para moverte, `/texto` para buscar, `q` para salir.',
        '(En el simulador verás el texto completo, pero en un servidor real less es interactivo.)',
      ],
      objective: 'Abre ~/proyecto/CHANGELOG.txt con less.',
      hints: [
        'El paginador moderno se llama "menos" en inglés (es mejor que "more").',
        'less seguido del archivo.',
        'Escribe: less ~/proyecto/CHANGELOG.txt',
      ],
      setup: (world) => plantFiles(world, { '~/proyecto/CHANGELOG.txt': CHANGELOG }),
      solution: 'less ~/proyecto/CHANGELOG.txt',
      check: ran('less', (args) => args.some((a) => a.includes('CHANGELOG'))),
      success: 'Recuerda: "less is more". En un servidor, less te salva de inundar la pantalla.',
      reward: rewardFor(2),
    },
    {
      id: 'linux-04-04',
      title: 'Solo el principio',
      difficulty: 2,
      teaches: ['head'],
      briefing: [
        '`head archivo` muestra las primeras 10 líneas.',
        'Con `-n N` eliges cuántas: `head -n 3 archivo` (o la forma corta `head -3`).',
        'Ideal para ver la cabecera de un CSV o el inicio de un log.',
      ],
      objective: 'Muestra solo las 5 primeras líneas de /var/log/app.log',
      hints: [
        'El comando se llama "cabeza" en inglés.',
        'head con la opción -n y el número de líneas.',
        'Escribe: head -n 5 /var/log/app.log',
      ],
      setup: (world) => plantFiles(world, { '/var/log/app.log': APP_LOG }),
      solution: 'head -n 5 /var/log/app.log',
      check: finalOutputIs(APP_LOG_LINES.slice(0, 5).join('\n')),
      success: 'Las 5 primeras líneas, ni una más.',
      reward: rewardFor(2),
    },
    {
      id: 'linux-04-05',
      title: 'Lo más reciente',
      difficulty: 2,
      teaches: ['tail'],
      briefing: [
        'Los logs crecen por abajo: lo más reciente está al FINAL.',
        '`tail archivo` muestra las últimas 10 líneas; `tail -n 3` las últimas 3.',
        'En un servidor real, `tail -f` sigue el archivo en directo mientras se escribe. Lo usarás muchísimo.',
      ],
      objective: 'Muestra las 3 últimas líneas de /var/log/app.log',
      hints: [
        'Lo contrario de head es "cola".',
        'tail -n seguido del número.',
        'Escribe: tail -n 3 /var/log/app.log',
      ],
      setup: (world) => plantFiles(world, { '/var/log/app.log': APP_LOG }),
      solution: 'tail -n 3 /var/log/app.log',
      check: finalOutputIs(APP_LOG_LINES.slice(-3).join('\n')),
      success: 'Has leído lo último que pasó en la aplicación. Así empieza cualquier diagnóstico.',
      reward: rewardFor(2),
    },
    {
      id: 'linux-04-06',
      title: 'Contar',
      difficulty: 2,
      teaches: ['wc'],
      briefing: [
        '`wc` (word count) cuenta líneas, palabras y bytes.',
        '`wc -l archivo` cuenta solo las líneas: en un log, cada línea suele ser un evento.',
      ],
      objective: 'Cuenta cuántas líneas tiene /var/log/app.log',
      hints: [
        'Abreviatura de "word count".',
        'wc con la opción -l (lines).',
        'Escribe: wc -l /var/log/app.log',
      ],
      setup: (world) => plantFiles(world, { '/var/log/app.log': APP_LOG }),
      solution: 'wc -l /var/log/app.log',
      check: outputMatches('wc', new RegExp(`^\\s*${APP_LOG_LINES.length}\\b`)),
      success: `${APP_LOG_LINES.length} eventos registrados hoy. Contar es el primer paso para medir.`,
      reward: rewardFor(2),
    },
    {
      id: 'linux-04-07',
      title: 'JEFE: Analiza un log',
      difficulty: 3,
      boss: true,
      teaches: [],
      briefing: [
        '⚠ El equipo de seguridad necesita dos datos de /var/log/app.log antes de que acabe el turno:',
        '  1) cuántas líneas tiene en total',
        '  2) la clave que aparece al final de la ÚLTIMA línea',
        'Responde con echo, en este formato exacto: `echo "NÚMERO CLAVE"`  (ej. echo "42 PINGUINO")',
      ],
      objective: 'Averigua las líneas y la clave final de /var/log/app.log y responde con echo "NÚMERO CLAVE"',
      hints: [
        'Necesitas dos comandos de este capítulo: uno cuenta, el otro muestra el final.',
        'wc -l para contar y tail -n 1 para la última línea.',
        `Escribe: echo "${APP_LOG_LINES.length} KERNEL"`,
      ],
      setup: (world) => plantFiles(world, { '/var/log/app.log': APP_LOG }),
      solution: `echo "${APP_LOG_LINES.length} KERNEL"`,
      check: all(outputEquals('echo', `${APP_LOG_LINES.length} KERNEL`)),
      success: 'Datos entregados. Ya sabes leer cualquier log del sistema.',
      reward: rewardFor(3, true),
    },
  ],
};
