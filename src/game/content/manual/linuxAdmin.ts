/**
 * Manual: usuarios, permisos, procesos, paquetes, entorno y scripting (capítulos 8 a 13).
 */
import type { CommandDoc } from '../../manual/CommandDoc';
import { alias, doc } from './docHelper';

const useradd = doc('useradd', 'Crea un usuario', 'sudo useradd [OPCIÓN]... USUARIO',
  ['Crea la cuenta en /etc/passwd. Sin -m no crea el directorio personal y sin -s la shell será /bin/sh.'],
  [['-m', 'Crea /home/USUARIO'], ['-s SHELL', 'Shell (/bin/bash)'], ['-G g1,g2', 'Grupos secundarios'], ['-c "Nombre"', 'Comentario'], ['-r', 'Usuario de sistema (servicios)']],
  [['sudo useradd -m -s /bin/bash ana', 'Usuaria normal'], ['sudo useradd -r -s /usr/sbin/nologin app', 'Usuario para un servicio (no puede iniciar sesión)']]);

const ps = doc('ps', 'Lista los procesos', 'ps [aux | -ef] [--sort=-%cpu]',
  ['`ps aux` (estilo BSD) o `ps -ef` (estilo System V) muestran todos los procesos.'],
  [['aux', 'Todos, con usuario, CPU y memoria'], ['-ef', 'Todos, con el padre (PPID)'], ['-u USUARIO', 'Solo de ese usuario'], ['--sort=-%mem', 'Ordena por memoria (- = de mayor a menor)']],
  [['ps aux | grep nginx', 'Procesos de nginx'], ['ps aux --sort=-%cpu | head', 'Los que más CPU usan']]);

const top = doc('top', 'Monitor de procesos en tiempo real', 'top',
  ['Cabecera: tiempo encendido, load average, tareas y memoria. Teclas: P (CPU), M (memoria), k (matar), q (salir).'],
  [['-b -n 1', 'Una sola foto (para scripts)']], [['top', 'Abrir el monitor']], 'htop es igual pero más visual (sudo apt install htop).');

const kill = doc('kill', 'Envía una señal a un proceso', 'kill [-SEÑAL] PID|%TRABAJO...',
  ['Por defecto TERM (15): pide terminar. KILL (9) lo elimina sin opción a limpiar. HUP (1) suele recargar la configuración.'],
  [['-15 / -TERM', 'Terminar (por defecto)'], ['-9 / -KILL', 'Matar a la fuerza'], ['-1 / -HUP', 'Recargar'], ['-l', 'Lista las señales']],
  [['kill 1234', 'Pide terminar al proceso 1234'], ['kill -9 1234', 'Lo mata si no responde'], ['kill %1', 'Mata el trabajo 1']],
  'Primero TERM; solo si no responde, KILL.');

const pkill = doc('pkill', 'Envía una señal a procesos por nombre', 'pkill [-SEÑAL] [-f] [-u USUARIO] PATRÓN',
  ['Como kill, pero busca los procesos por nombre.'], [['-f', 'Compara con la línea de comandos completa'], ['-u', 'Solo de ese usuario'], ['-9', 'Señal KILL']],
  [['pkill -f "python app.py"', 'Mata ese script concreto'], ['sudo pkill -u alumno', 'Todos los procesos de un usuario']]);

const apt = doc('apt', 'Gestor de paquetes de Debian/Ubuntu', 'sudo apt ACCIÓN [PAQUETE]...',
  ['Instala software de los repositorios oficiales resolviendo las dependencias.'],
  [['update', 'Actualiza el índice (siempre primero)'], ['install P', 'Instala'], ['remove P', 'Desinstala (conserva config)'], ['purge P', 'Desinstala todo'],
    ['upgrade', 'Actualiza todo lo instalado'], ['autoremove', 'Quita dependencias huérfanas'], ['search T', 'Busca'], ['show P', 'Detalles'], ['list --installed', 'Lo instalado'], ['-y', 'Responde sí']],
  [['sudo apt update && sudo apt upgrade -y', 'Mantenimiento rutinario'], ['sudo apt install -y nginx', 'Instalar nginx']],
  'apt-get hace lo mismo con una salida más estable: es lo que se usa en scripts y Dockerfiles.');

const bash = doc('bash', 'El intérprete de comandos; ejecuta scripts', 'bash [-c "comandos"] [SCRIPT [ARGS...]]',
  ['Un script empieza por `#!/bin/bash`. Estructuras: `if [ cond ]; then ...; fi`, `for x in lista; do ...; done`, `while cond; do ...; done`, `case $x in a) ...;; esac`, funciones `nombre() { ...; }`.',
    'Variables: `$1 $2` argumentos, `$#` cuántos, `$@` todos, `$?` código del último comando, `$(cmd)` salida de un comando, `$((2+3))` aritmética.'],
  [['-c "cmds"', 'Ejecuta un texto'], ['-n', 'Solo comprueba la sintaxis'], ['-x', 'Muestra cada comando (depurar)']],
  [['bash backup.sh /home', 'Ejecuta un script con un argumento'], ['bash -n script.sh', '¿Tiene errores de sintaxis?']],
  'Pon `set -euo pipefail` al principio de tus scripts: se detienen ante el primer error.');

const test = doc('test', 'Evalúa condiciones (también se escribe [ ... ])', '[ EXPRESIÓN ]',
  ['Devuelve 0 si se cumple. Los espacios dentro de los corchetes son obligatorios.'],
  [['-f / -d / -e RUTA', 'Archivo / directorio / existe'], ['-r / -w / -x', 'Legible / escribible / ejecutable'], ['-z / -n TEXTO', 'Vacío / no vacío'],
    ['A = B / A != B', 'Textos iguales / distintos'], ['N -eq/-ne/-lt/-le/-gt/-ge M', 'Comparaciones numéricas'], ['! / -a / -o', 'No / y / o']],
  [['[ -f /etc/nginx/nginx.conf ] && echo instalado', 'Comprueba un archivo'], ['if [ "$#" -lt 1 ]; then echo "Uso: $0 nombre"; exit 1; fi', 'Valida argumentos']]);

const nano = doc('nano', 'Editor de texto sencillo', 'nano ARCHIVO',
  ['Los atajos aparecen abajo (^ = Ctrl): ^O guardar, ^X salir, ^K cortar línea, ^U pegar, ^W buscar, ^C posición.'],
  [], [['nano ~/.bashrc', 'Edita tu configuración'], ['sudo nano /etc/hosts', 'Edita un archivo del sistema']],
  'vi/vim es el otro editor universal: i para escribir, Esc y :wq para guardar y salir.');

export const LINUX_ADMIN_DOCS: readonly CommandDoc[] = [
  // Usuarios
  doc('id', 'Muestra UID, GID y grupos', 'id [USUARIO]', ['El UID 0 es root; los usuarios humanos empiezan en 1000.'], [['-u', 'Solo el UID'], ['-nG', 'Nombres de los grupos']], [['id', 'Tu identidad'], ['id ana', 'La de ana']]),
  doc('groups', 'Muestra los grupos de un usuario', 'groups [USUARIO]', ['Los cambios de grupo se aplican en el siguiente inicio de sesión.'], [], [['groups ana', 'Grupos de ana']]),
  doc('sudo', 'Ejecuta un comando como root (u otro usuario)', 'sudo [-u USUARIO] COMANDO  |  sudo -i',
    ['Permitido a quien aparece en /etc/sudoers (normalmente el grupo sudo). Queda registrado en /var/log/auth.log.'],
    [['-u USUARIO', 'Como otro usuario'], ['-i', 'Abre una sesión de root (exit para salir)'], ['-l', 'Qué puedes ejecutar']],
    [['sudo apt update', 'Tarea de administrador'], ['sudo -u www-data ls /var/www', 'Ver lo que ve el servidor web']],
    'Antes de un comando peligroso con sudo, léelo dos veces.'),
  useradd,
  alias('adduser', useradd, 'versión interactiva de Debian que pregunta todo'),
  doc('passwd', 'Cambia una contraseña', 'passwd [USUARIO]', ['Sin argumentos cambia la tuya. Como root puedes cambiar la de cualquiera.'], [['-l / -u', 'Bloquea / desbloquea'], ['-S', 'Estado'], ['-d', 'Borra la contraseña']], [['sudo passwd ana', 'Nueva contraseña para ana']]),
  doc('chpasswd', 'Cambia contraseñas en lote', 'echo "usuario:clave" | sudo chpasswd', ['Lee líneas usuario:contraseña. Ideal para scripts.'], [], [["echo 'ana:Clave123' | sudo chpasswd", 'Sin preguntas']]),
  doc('groupadd', 'Crea un grupo', 'sudo groupadd GRUPO', [], [], [['sudo groupadd devs', 'Grupo para el equipo']]),
  doc('groupdel', 'Borra un grupo', 'sudo groupdel GRUPO', [], [], [['sudo groupdel becarios', 'Elimina el grupo']]),
  doc('usermod', 'Modifica un usuario', 'sudo usermod [OPCIÓN] USUARIO',
    ['⚠ -G sin -a REEMPLAZA los grupos secundarios: usa siempre -aG para añadir.'],
    [['-aG g1,g2', 'Añade a grupos'], ['-s SHELL', 'Cambia la shell'], ['-L / -U', 'Bloquea / desbloquea la cuenta'], ['-d DIR', 'Cambia el home']],
    [['sudo usermod -aG docker ana', 'Ana podrá usar docker'], ['sudo usermod -s /usr/sbin/nologin bot', 'Impide iniciar sesión']]),
  doc('gpasswd', 'Añade o quita miembros de un grupo', 'sudo gpasswd -a|-d USUARIO GRUPO', [], [['-a', 'Añadir'], ['-d', 'Quitar']], [['sudo gpasswd -d ana devs', 'Saca a ana del grupo']]),
  doc('su', 'Cambia de usuario', 'su [-] [USUARIO] [-c CMD]', ['Pide la contraseña del usuario DESTINO. Con "-" abre una sesión completa (su entorno y su home).'], [['-', 'Sesión de login'], ['-c CMD', 'Solo ejecuta CMD']], [['su - ana', 'Ser ana (exit para volver)'], ['sudo su -', 'Sesión de root (mejor: sudo -i)']]),
  doc('exit', 'Cierra la sesión o termina un script', 'exit [CÓDIGO]', ['En un script, el código indica si terminó bien (0) o con error (1-255).'], [], [['exit', 'Vuelve a la sesión anterior (tras su, sudo -i o ssh)'], ['exit 1', 'Termina un script indicando error']]),
  doc('userdel', 'Elimina un usuario', 'sudo userdel [-r] USUARIO', [], [['-r', 'Borra también su home']], [['sudo userdel -r temporal', 'Baja completa']]),
  doc('visudo', 'Edita sudoers de forma segura', 'sudo visudo [-c] [-f ARCHIVO]',
    ['Comprueba la sintaxis antes de guardar: un error en sudoers puede dejarte sin sudo. Formato: `quién host=(como) comandos`; `%grupo` para grupos.'],
    [['-c', 'Solo comprobar'], ['-f ARCHIVO', 'Editar otro archivo (de /etc/sudoers.d)']],
    [['sudo visudo -f /etc/sudoers.d/devs', 'Regla para el equipo'], ['sudo visudo -c', 'Comprobar todo']],
    'Ejemplo de regla limitada: %devs ALL=(ALL) /usr/bin/systemctl restart nginx'),
  // Permisos
  doc('chmod', 'Cambia los permisos', 'chmod [-R] MODO ARCHIVO...',
    ['Octal: r=4 w=2 x=1, una cifra para dueño, grupo y otros (755, 644, 600). Simbólico: [ugoa][+-=][rwx] (u+x, go-w, a=r). Una 4.ª cifra delante: 4 SUID, 2 SGID, 1 sticky.'],
    [['-R', 'Recursivo'], ['+x', 'Hacer ejecutable']],
    [['chmod +x script.sh', 'Ejecutable'], ['chmod 600 clave.pem', 'Solo el dueño'], ['chmod -R g+w /srv/proyecto', 'El grupo puede escribir'], ['chmod 1777 /srv/subidas', 'Como /tmp']],
    'Nunca uses chmod 777 "para que funcione": es abrir la puerta a todo el mundo.'),
  doc('stat', 'Muestra todos los metadatos de un archivo', 'stat [-c FORMATO] ARCHIVO', ['Permisos en octal y simbólico, dueño, tamaño y fechas.'], [['-c %a', 'Solo los permisos en octal'], ['-c %U:%G', 'Dueño y grupo']], [['stat /etc/shadow', 'Metadatos completos']]),
  doc('chown', 'Cambia el dueño (y el grupo)', 'sudo chown [-R] USUARIO[:GRUPO] ARCHIVO...', ['Solo root puede regalar archivos a otro usuario.'], [['-R', 'Recursivo']], [['sudo chown -R www-data:www-data /var/www', 'La web para nginx'], ['sudo chown ana: informe.txt', 'Para ana y su grupo']]),
  doc('chgrp', 'Cambia el grupo', 'chgrp [-R] GRUPO ARCHIVO...', [], [['-R', 'Recursivo']], [['sudo chgrp -R devs /srv/proyecto', 'Del equipo devs']]),
  doc('umask', 'Máscara de permisos de los archivos nuevos', 'umask [MÁSCARA]', ['Archivos: 666 - umask; directorios: 777 - umask. Para que dure, ponla en ~/.bashrc.'], [['-S', 'En formato simbólico']], [['umask 027', 'Nuevos archivos 640 y directorios 750']]),
  // Procesos
  ps, top, alias('htop', top, 'versión interactiva y en color'), kill, pkill,
  doc('pgrep', 'Busca procesos y muestra su PID', 'pgrep [-l] [-f] [-u U] PATRÓN', [], [['-l', 'Con el nombre'], ['-a', 'Con la línea completa'], ['-f', 'Compara con la línea completa']], [['pgrep -a nginx', 'PIDs y comandos de nginx']]),
  alias('killall', pkill, 'mata por nombre exacto'),
  doc('jobs', 'Lista los trabajos en segundo plano', 'jobs [-l]', ['Un comando con & al final se ejecuta en segundo plano. Ctrl+Z pausa el que está en primer plano.'], [['-l', 'Con PID']], [['sleep 100 & jobs', 'Lanza y lista']]),
  doc('fg', 'Trae un trabajo al primer plano', 'fg [%N]', [], [], [['fg %1', 'Trae el trabajo 1']]),
  doc('bg', 'Reanuda un trabajo pausado en segundo plano', 'bg [%N]', [], [], [['bg %1', 'Continúa el 1 en segundo plano']]),
  doc('sleep', 'Espera unos segundos', 'sleep N[s|m|h]', ['Útil en scripts y bucles de reintento.'], [], [['sleep 5', 'Espera 5 s'], ['while ! curl -s localhost; do sleep 2; done', 'Espera a que la web responda']]),
  doc('nice', 'Lanza un comando con otra prioridad', 'nice [-n N] COMANDO', ['De -20 (máxima) a 19 (mínima). Subir prioridad requiere sudo.'], [['-n N', 'Prioridad']], [['nice -n 19 tar -czf backup.tgz /home', 'Backup sin molestar']]),
  doc('renice', 'Cambia la prioridad de un proceso en marcha', 'renice -n N -p PID', [], [], [['renice -n 10 -p 4321', 'Menos prioridad para el 4321']]),
  doc('nohup', 'Ejecuta un comando inmune al cierre de sesión', 'nohup COMANDO &', ['La salida va a nohup.out.'], [], [['nohup ./migracion.sh &', 'Sigue aunque cierres SSH']], 'Para procesos que deben vivir siempre, crea un servicio de systemd.'),
  // Paquetes
  apt, alias('apt-get', apt, 'la versión clásica, preferida en scripts'),
  doc('apt-cache', 'Consulta el índice de paquetes', 'apt-cache search|show|policy', [], [], [['apt-cache policy nginx', 'Versión instalada y candidata']]),
  doc('dpkg', 'Gestor de bajo nivel de paquetes .deb', 'dpkg [OPCIÓN]', ['apt usa dpkg por debajo. Si una instalación se interrumpe: sudo dpkg --configure -a.'],
    [['-l [patrón]', 'Lista instalados (ii = correcto)'], ['-L P', 'Archivos de un paquete'], ['-S RUTA', 'Qué paquete instaló ese archivo'], ['-i X.deb', 'Instala un .deb'], ['--configure -a', 'Termina instalaciones interrumpidas']],
    [['dpkg -l | grep nginx', '¿Está instalado?'], ['dpkg -S /usr/bin/curl', '¿De qué paquete es?']]),
  // Entorno
  doc('env', 'Muestra el entorno o ejecuta un comando con variables', 'env [VAR=valor]... [COMANDO]', [], [], [['env | sort', 'Todas las variables'], ['env TZ=UTC date', 'Un comando con otra zona horaria']]),
  doc('printenv', 'Muestra variables de entorno', 'printenv [VAR]...', [], [], [['printenv PATH', 'Tu PATH']]),
  doc('export', 'Exporta variables a los procesos hijos', 'export VAR[=valor]', ['Sin export, una variable solo existe en tu shell actual.'], [], [['export EDITOR=nano', 'Editor por defecto'], ['export PATH="$PATH:$HOME/bin"', 'Añade tus scripts al PATH']]),
  doc('unset', 'Elimina una variable', 'unset VAR', [], [], [['unset PROYECTO', 'Adiós variable']]),
  doc('alias', 'Crea atajos de comandos', "alias NOMBRE='COMANDO'", ['Para que sean permanentes, ponlos en ~/.bashrc.'], [], [["alias ll='ls -alF'", 'Listado completo'], ['alias', 'Lista los alias']]),
  doc('unalias', 'Elimina un alias', 'unalias NOMBRE', [], [['-a', 'Todos']], [['unalias ll', 'Quita ll']]),
  doc('source', 'Ejecuta un archivo en el shell actual', 'source ARCHIVO  (o: . ARCHIVO)', ['A diferencia de bash script.sh, sus variables y alias se quedan en tu sesión.'], [], [['source ~/.bashrc', 'Aplica los cambios de .bashrc']]),
  nano, alias('vi', nano, 'en el simulador abre nano'), alias('vim', nano, 'en el simulador abre nano'),
  // Scripting
  bash, alias('sh', bash, 'shell POSIX, más básica que bash'),
  doc('printf', 'Imprime con formato', "printf 'FORMATO' [ARGS...]", ['Como echo pero sin salto de línea automático y con formatos: %s texto, %d número, %5.2f decimales, \\n salto.'], [], [["printf '%-10s %5d\\n' cpu 42", 'Columnas alineadas'], ["printf '#!/bin/bash\\necho hola\\n' > s.sh", 'Crear un script en una línea']]),
  test, alias('[', test, 'forma habitual en los if'),
  doc('true', 'Termina con éxito (código 0)', 'true', [], [], [['while true; do date; sleep 60; done', 'Bucle infinito']]),
  doc('false', 'Termina con error (código 1)', 'false', [], [], [['false || echo "falló"', 'Probar ||']]),
  doc('seq', 'Genera secuencias de números', 'seq [INICIO [PASO]] FIN', [], [['-w', 'Rellena con ceros']], [['for i in $(seq 1 5); do echo $i; done', 'Del 1 al 5']]),
  doc('read', 'Lee una línea de la entrada', 'read [-r] [-p "pregunta"] VAR...', [], [['-r', 'No interpreta \\'], ['-p', 'Muestra una pregunta']], [['while read linea; do echo "$linea"; done < archivo', 'Recorre un archivo']]),
  doc('local', 'Variable local de una función', 'local VAR=valor', [], [], [['f() { local x=1; echo $x; }', 'x solo existe en f']]),
  doc('return', 'Sale de una función con un código', 'return [N]', [], [], [['es_root() { [ "$(whoami)" = root ]; return $?; }', 'Función que responde sí/no']]),
  doc('date', 'Muestra la fecha (y la formatea)', 'date [+FORMATO]', ['Formatos: %Y año, %m mes, %d día, %H:%M:%S hora, %F = %Y-%m-%d, %s segundos desde 1970.'], [['-d "yesterday"', 'Otra fecha']], [['date +%F', '2024-11-16'], ['tar -czf backup-$(date +%F).tgz /etc', 'Fecha en el nombre de un backup']]),
];

