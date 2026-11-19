/**
 * Manual de los comandos básicos de Linux (capítulos 1 a 4).
 */
import type { CommandDoc } from '../../manual/CommandDoc';

export const LINUX_BASICS_DOCS: readonly CommandDoc[] = [
  {
    name: 'whoami',
    summary: 'Muestra el nombre del usuario actual',
    synopsis: 'whoami',
    description: [
      'Imprime el nombre del usuario con el que estás ejecutando comandos.',
      'Es útil tras usar `su` o `sudo` para confirmar con qué identidad estás operando.',
    ],
    examples: [{ command: 'whoami', explanation: 'Muestra tu usuario, por ejemplo: neo' }],
    tip: 'Antes de ejecutar algo peligroso en un servidor, comprueba siempre con whoami si eres root.',
  },
  {
    name: 'clear',
    summary: 'Limpia la pantalla de la terminal',
    synopsis: 'clear',
    description: ['Borra todo lo que hay en pantalla y deja el prompt arriba. No borra el historial.'],
    examples: [{ command: 'clear', explanation: 'Limpia la pantalla. Atajo de teclado: Ctrl+L' }],
  },
  {
    name: 'pwd',
    summary: 'Muestra la ruta del directorio actual',
    synopsis: 'pwd',
    description: [
      'Print Working Directory: imprime la ruta absoluta del directorio en el que estás.',
      'Toda ruta relativa que uses se interpreta a partir de este directorio.',
    ],
    examples: [{ command: 'pwd', explanation: 'Ejemplo de salida: /home/neo' }],
  },
  {
    name: 'ls',
    summary: 'Lista archivos y directorios',
    synopsis: 'ls [OPCIÓN]... [RUTA]...',
    description: [
      'Lista el contenido de los directorios indicados (por defecto, el actual).',
      'Los archivos que empiezan por punto (.) están ocultos y solo aparecen con -a.',
    ],
    options: [
      { flag: '-a, --all', description: 'Muestra también los ocultos, incluidos . y ..' },
      { flag: '-A', description: 'Como -a pero sin . ni ..' },
      { flag: '-l', description: 'Formato largo: permisos, enlaces, dueño, grupo, tamaño, fecha' },
      { flag: '-h', description: 'Con -l, tamaños legibles (4.0K, 1.2M)' },
      { flag: '-R', description: 'Lista los subdirectorios de forma recursiva' },
      { flag: '-t', description: 'Ordena por fecha de modificación, lo más reciente primero' },
      { flag: '-r', description: 'Invierte el orden' },
      { flag: '-d', description: 'Muestra el directorio en sí, no su contenido' },
      { flag: '-1', description: 'Un elemento por línea' },
    ],
    examples: [
      { command: 'ls', explanation: 'Contenido del directorio actual' },
      { command: 'ls -la', explanation: 'Todo, incluidos ocultos, en formato largo' },
      { command: 'ls -lh /var/log', explanation: 'Logs del sistema con tamaños legibles' },
      { command: 'ls -lt', explanation: 'Lo último que se ha modificado aparece primero' },
    ],
    tip: 'Lee la salida de ls -l así: tipo+permisos | enlaces | dueño | grupo | tamaño | fecha | nombre.',
  },
  {
    name: 'cd',
    summary: 'Cambia de directorio',
    synopsis: 'cd [RUTA]',
    description: [
      'Change Directory: cambia el directorio de trabajo.',
      'Rutas especiales: ~ (tu home), .. (directorio padre), . (actual), - (el anterior).',
    ],
    examples: [
      { command: 'cd /etc', explanation: 'Ruta absoluta: funciona desde cualquier sitio' },
      { command: 'cd documentos', explanation: 'Ruta relativa al directorio actual' },
      { command: 'cd ..', explanation: 'Sube un nivel' },
      { command: 'cd ../..', explanation: 'Sube dos niveles' },
      { command: 'cd', explanation: 'Vuelve a tu home (igual que cd ~)' },
      { command: 'cd -', explanation: 'Vuelve al directorio anterior' },
    ],
    tip: 'Pulsa Tab mientras escribes una ruta: la terminal la completa por ti.',
  },
  {
    name: 'echo',
    summary: 'Muestra un texto',
    synopsis: 'echo [-n] [-e] [TEXTO]...',
    description: [
      'Imprime sus argumentos separados por espacios.',
      'Entre comillas dobles se expanden las variables ("$USER"); entre simples no (\'$USER\').',
    ],
    options: [
      { flag: '-n', description: 'No añade el salto de línea final' },
      { flag: '-e', description: 'Interpreta secuencias como \\n (salto) y \\t (tabulador)' },
    ],
    examples: [
      { command: 'echo "Hola mundo"', explanation: 'Imprime Hola mundo' },
      { command: 'echo "Soy $USER"', explanation: 'Expande la variable: Soy neo' },
      { command: 'echo -e "línea1\\nlínea2"', explanation: 'Imprime dos líneas' },
    ],
  },
  {
    name: 'history',
    summary: 'Muestra el historial de comandos',
    synopsis: 'history [N] | history -c',
    description: ['Lista los comandos ejecutados, numerados. Las flechas ↑ ↓ recorren este historial.'],
    options: [
      { flag: 'N', description: 'Muestra solo los últimos N comandos' },
      { flag: '-c', description: 'Borra el historial' },
    ],
    examples: [
      { command: 'history', explanation: 'Todo el historial' },
      { command: 'history 5', explanation: 'Los últimos 5 comandos' },
    ],
  },
  {
    name: 'man',
    summary: 'Muestra el manual de un comando',
    synopsis: 'man COMANDO',
    description: [
      'Abre la documentación de un comando.',
      'En un servidor real se navega con las flechas y se sale con q. Busca dentro con /palabra.',
    ],
    examples: [{ command: 'man ls', explanation: 'Manual completo de ls' }],
    tip: 'Antes de buscar en internet, prueba con man. Funciona sin conexión y siempre corresponde a tu versión.',
  },
  {
    name: 'help',
    summary: 'Lista los comandos disponibles',
    synopsis: 'help',
    description: ['Muestra los comandos que tienes desbloqueados, agrupados por categoría.'],
    examples: [{ command: 'help', explanation: 'Ver qué puedes usar ahora mismo' }],
  },
  {
    name: 'tree',
    summary: 'Muestra directorios en forma de árbol',
    synopsis: 'tree [-a] [-d] [-L NIVEL] [RUTA]',
    description: ['Dibuja la estructura de un directorio y todo su contenido.'],
    options: [
      { flag: '-a', description: 'Incluye archivos ocultos' },
      { flag: '-d', description: 'Solo directorios' },
      { flag: '-L N', description: 'Profundidad máxima N' },
    ],
    examples: [
      { command: 'tree', explanation: 'Árbol del directorio actual' },
      { command: 'tree -L 2 /etc', explanation: 'Dos niveles de /etc' },
    ],
  },
  {
    name: 'touch',
    summary: 'Crea archivos vacíos o actualiza su fecha',
    synopsis: 'touch ARCHIVO...',
    description: ['Si el archivo no existe lo crea vacío; si existe, actualiza su fecha de modificación.'],
    examples: [
      { command: 'touch notas.txt', explanation: 'Crea notas.txt' },
      { command: 'touch a.txt b.txt c.txt', explanation: 'Crea tres archivos' },
    ],
  },
  {
    name: 'mkdir',
    summary: 'Crea directorios',
    synopsis: 'mkdir [-p] [-v] DIRECTORIO...',
    description: ['Make Directory: crea uno o varios directorios.'],
    options: [
      { flag: '-p', description: 'Crea los directorios padre necesarios y no falla si ya existe' },
      { flag: '-v', description: 'Informa de cada directorio creado' },
    ],
    examples: [
      { command: 'mkdir proyectos', explanation: 'Crea un directorio' },
      { command: 'mkdir -p app/src/components', explanation: 'Crea toda la ruta de una vez' },
    ],
  },
  {
    name: 'cp',
    summary: 'Copia archivos y directorios',
    synopsis: 'cp [-r] [-v] ORIGEN... DESTINO',
    description: [
      'Copia archivos. Si el destino es un directorio existente, la copia se guarda dentro.',
      'Para copiar directorios hace falta -r.',
    ],
    options: [
      { flag: '-r, -R', description: 'Copia directorios con todo su contenido' },
      { flag: '-v', description: 'Muestra cada copia realizada' },
    ],
    examples: [
      { command: 'cp a.txt b.txt', explanation: 'Duplica a.txt como b.txt' },
      { command: 'cp a.txt docs/', explanation: 'Copia a.txt dentro de docs' },
      { command: 'cp -r web/ web_backup', explanation: 'Copia un directorio completo' },
    ],
    tip: 'Antes de editar una configuración importante: cp archivo.conf archivo.conf.bak',
  },
  {
    name: 'mv',
    summary: 'Mueve o renombra archivos',
    synopsis: 'mv [-v] ORIGEN... DESTINO',
    description: ['Mueve archivos o directorios. Si origen y destino están en el mismo sitio, equivale a renombrar.'],
    options: [{ flag: '-v', description: 'Muestra cada movimiento' }],
    examples: [
      { command: 'mv viejo.txt nuevo.txt', explanation: 'Renombra' },
      { command: 'mv *.log logs/', explanation: 'Mueve todos los .log al directorio logs' },
    ],
  },
  {
    name: 'rm',
    summary: 'Elimina archivos y directorios',
    synopsis: 'rm [-r] [-f] [-v] RUTA...',
    description: [
      'Elimina archivos de forma PERMANENTE: en Linux no hay papelera.',
      'Para eliminar directorios con contenido se necesita -r.',
    ],
    options: [
      { flag: '-r, -R', description: 'Elimina directorios y todo su contenido' },
      { flag: '-f', description: 'No pregunta ni avisa si el archivo no existe' },
      { flag: '-v', description: 'Muestra cada elemento eliminado' },
    ],
    examples: [
      { command: 'rm archivo.txt', explanation: 'Elimina un archivo' },
      { command: 'rm *.tmp', explanation: 'Elimina todos los .tmp del directorio' },
      { command: 'rm -r carpeta/', explanation: 'Elimina un directorio completo' },
    ],
    tip: 'Antes de un rm con comodines, ejecuta ls con el mismo patrón para ver qué vas a borrar.',
  },
  {
    name: 'rmdir',
    summary: 'Elimina directorios vacíos',
    synopsis: 'rmdir DIRECTORIO...',
    description: ['Elimina directorios solo si están vacíos. Es la opción segura frente a rm -r.'],
    examples: [{ command: 'rmdir vacio/', explanation: 'Falla si el directorio tiene contenido' }],
  },
  {
    name: 'cat',
    summary: 'Muestra el contenido de archivos',
    synopsis: 'cat [-n] [ARCHIVO]...',
    description: ['Concatena archivos y los muestra. Sin archivos, lee la entrada estándar (útil en tuberías).'],
    options: [{ flag: '-n', description: 'Numera las líneas' }],
    examples: [
      { command: 'cat /etc/hosts', explanation: 'Muestra el archivo hosts' },
      { command: 'cat a.txt b.txt > todo.txt', explanation: 'Une dos archivos en uno' },
    ],
  },
  {
    name: 'head',
    summary: 'Muestra las primeras líneas',
    synopsis: 'head [-n N] [ARCHIVO]...',
    description: ['Muestra las primeras 10 líneas (o N con -n).'],
    options: [{ flag: '-n N, -N', description: 'Número de líneas' }],
    examples: [{ command: 'head -n 5 /etc/passwd', explanation: 'Las 5 primeras líneas' }],
  },
  {
    name: 'tail',
    summary: 'Muestra las últimas líneas',
    synopsis: 'tail [-n N] [ARCHIVO]...',
    description: ['Muestra las últimas 10 líneas (o N con -n). Ideal para ver lo más reciente de un log.'],
    options: [{ flag: '-n N, -N', description: 'Número de líneas' }],
    examples: [{ command: 'tail -n 20 /var/log/syslog', explanation: 'Las 20 entradas más recientes' }],
  },
  {
    name: 'wc',
    summary: 'Cuenta líneas, palabras y bytes',
    synopsis: 'wc [-l] [-w] [-c] [ARCHIVO]...',
    description: ['Word Count. Sin opciones muestra líneas, palabras y bytes.'],
    options: [
      { flag: '-l', description: 'Solo líneas' },
      { flag: '-w', description: 'Solo palabras' },
      { flag: '-c', description: 'Solo bytes' },
    ],
    examples: [{ command: 'wc -l /etc/passwd', explanation: 'Cuántos usuarios hay en el sistema' }],
  },
];
