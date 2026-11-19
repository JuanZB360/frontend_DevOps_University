/**
 * Manual: archivos comprimidos, discos, red, SSH, servicios, logs, seguridad y
 * rendimiento (capítulos 14 a 23).
 */
import type { CommandDoc } from '../../manual/CommandDoc';
import { alias, doc } from './docHelper';

const gzip = doc('gzip', 'Comprime archivos (.gz)', 'gzip [-k] [-d] ARCHIVO...',
  ['Sustituye el archivo por archivo.gz. Es la compresión estándar de logs y tarballs.'],
  [['-k', 'Conserva el original'], ['-d', 'Descomprime'], ['-c', 'A la salida estándar'], ['-l', 'Ratio de compresión']],
  [['gzip app.log', 'app.log → app.log.gz'], ['gunzip app.log.gz', 'Lo devuelve'], ['zcat app.log.gz | grep ERROR', 'Buscar sin descomprimir']]);

const mkfs = doc('mkfs', 'Crea un sistema de archivos (formatea)', 'sudo mkfs.ext4 PARTICIÓN  |  sudo mkfs -t TIPO PARTICIÓN',
  ['⚠ Borra todo lo que hubiera en la partición. ext4 es el estándar; xfs es habitual en servidores grandes.'], [],
  [['sudo mkfs.ext4 /dev/sdb1', 'Formatea la partición 1 de sdb']]);

const ss = doc('ss', 'Muestra sockets: puertos en escucha y conexiones', 'ss [-tulpn]',
  ['Sustituto moderno de netstat.'],
  [['-t / -u', 'TCP / UDP'], ['-l', 'Solo en escucha'], ['-p', 'Proceso (con sudo)'], ['-n', 'Números en vez de nombres'], ['-s', 'Resumen']],
  [['sudo ss -tulpn', 'Qué escucha y quién'], ["ss -tn state established", 'Conexiones abiertas']]);

const systemctl = doc('systemctl', 'Controla systemd: servicios, arranque y temporizadores', 'systemctl ACCIÓN [UNIDAD]...',
  ['Las acciones que cambian algo requieren sudo.'],
  [['status S', 'Estado, PID y últimos logs'], ['start / stop / restart S', 'Arrancar / parar / reiniciar'], ['reload S', 'Recargar configuración sin cortar'], ['enable / disable S', 'Al arrancar el sistema (--now: también ahora)'],
    ['is-active / is-enabled S', 'Para scripts'], ['daemon-reload', 'Relee las unidades tras crearlas o editarlas'], ['list-units --type=service', 'Servicios cargados'], ['--failed', 'Solo los que fallaron'], ['list-timers', 'Temporizadores'], ['cat S', 'Muestra la unidad']],
  [['sudo systemctl restart nginx', 'Aplica cambios'], ['sudo systemctl enable --now fail2ban', 'Activar ya y al arrancar'], ['systemctl --failed', '¿Algo roto?']],
  'Unidad propia en /etc/systemd/system/APP.service: [Unit] Description · [Service] ExecStart, User, Restart=always · [Install] WantedBy=multi-user.target');

const ufw = doc('ufw', 'Cortafuegos sencillo de Ubuntu', 'sudo ufw ACCIÓN',
  ['Orden recomendado: default deny incoming → allow SSH → allow lo necesario → enable.'],
  [['status [verbose|numbered]', 'Estado y reglas'], ['enable / disable', 'Activar / desactivar'], ['default deny incoming', 'Política por defecto'], ['allow 22/tcp | OpenSSH', 'Permitir'], ['allow 80,443/tcp', 'Varios puertos'],
    ['allow from IP to any port 5432', 'Solo desde una IP'], ['deny from IP', 'Bloquear una IP'], ['limit OpenSSH', 'Frena la fuerza bruta'], ['delete N', 'Borra la regla N (ver status numbered)'], ['app list', 'Perfiles de aplicaciones']],
  [['sudo ufw allow OpenSSH && sudo ufw --force enable', 'Activar sin quedarte fuera'], ['sudo ufw allow "Nginx Full"', 'HTTP y HTTPS']],
  '⚠ Permite SSH ANTES de activar ufw en un servidor remoto.');

export const LINUX_SERVER_DOCS: readonly CommandDoc[] = [
  // Archivos comprimidos
  doc('tar', 'Empaqueta (y comprime) archivos', 'tar -c|-x|-t [-z] [-v] -f ARCHIVO [RUTAS...]',
    ['La f va siempre al final de las letras, seguida del nombre del archivo.'],
    [['-c', 'Crear'], ['-x', 'Extraer'], ['-t', 'Listar'], ['-z', 'Con gzip (.tar.gz)'], ['-v', 'Muestra los archivos'], ['-f ARCHIVO', 'Nombre del archivo'], ['-C DIR', 'Extraer en DIR'], ['--exclude=PATRÓN', 'Excluir']],
    [['tar -czvf web.tar.gz /var/www', 'Crear comprimido'], ['tar -tzvf web.tar.gz', 'Ver contenido'], ['tar -xzvf web.tar.gz -C /tmp', 'Extraer en /tmp'], ['sudo tar -xzf etc.tar.gz -C / etc/hosts', 'Restaurar un solo archivo']],
    'Truco para recordarlo: Crear Zip Verboso File / eXtraer Zip Verboso File.'),
  gzip, alias('gunzip', gzip, 'descomprime .gz'), alias('zcat', gzip, 'muestra un .gz sin descomprimir'),
  doc('zip', 'Crea archivos .zip', 'zip [-r] ARCHIVO.zip RUTAS...', ['Formato compatible con Windows y macOS.'], [['-r', 'Directorios recursivos']], [['zip -r informes.zip informes/', 'Comprimir una carpeta']]),
  doc('unzip', 'Extrae archivos .zip', 'unzip [-l] ARCHIVO.zip [-d DESTINO]', [], [['-l', 'Listar'], ['-d DIR', 'Extraer en DIR']], [['unzip -l web.zip', 'Ver contenido'], ['unzip web.zip -d /tmp/web', 'Extraer']]),
  // Discos
  doc('df', 'Espacio libre de los sistemas de archivos', 'df [-h] [-T] [-i] [RUTA]', ['Mira el Use%: por encima del 90 % hay que actuar.'], [['-h', 'Legible'], ['-T', 'Tipo'], ['-i', 'Inodos (se pueden agotar con millones de archivos pequeños)']], [['df -h', 'Todos los discos'], ['df -h /var', '¿Dónde está /var y cuánto queda?']]),
  doc('du', 'Cuánto ocupa cada directorio', 'du [-sh] [--max-depth=N] [RUTA]...', [], [['-s', 'Solo el total'], ['-h', 'Legible'], ['-c', 'Total general'], ['--max-depth=1', 'Un nivel']], [['sudo du -sh /var/log/* | sort -h', 'Qué log ocupa más'], ['du -h --max-depth=1 /home', 'Por usuario']]),
  doc('lsblk', 'Discos y particiones en árbol', 'lsblk [-f]', [], [['-f', 'Sistemas de archivos y UUID']], [['lsblk', 'Ver discos'], ['lsblk -f', 'Con formato y UUID']]),
  doc('blkid', 'UUID y tipo de cada partición', 'sudo blkid', ['El UUID identifica una partición aunque cambie su nombre (sdb ↔ sdc).'], [], [['sudo blkid', 'Para /etc/fstab']]),
  doc('fdisk', 'Particiona discos', 'sudo fdisk -l | sudo fdisk /dev/sdX', ['Interactivo: n (nueva), p (primaria), w (escribir y salir), q (salir sin guardar).'], [['-l', 'Lista discos y particiones']], [['sudo fdisk -l', 'Ver particiones'], ['printf "n\\np\\n1\\n\\n\\nw\\n" | sudo fdisk /dev/sdb', 'Una partición de todo el disco']], '⚠ Comprueba el disco con lsblk antes: equivocarse de letra borra datos.'),
  doc('parted', 'Particiona discos (también GPT y discos grandes)', 'sudo parted DISCO --script ÓRDENES', [], [], [['sudo parted /dev/sdb --script mklabel gpt mkpart primary ext4 0% 100%', 'Partición única GPT']]),
  mkfs, alias('mkfs.ext4', mkfs, 'formatea en ext4'),
  doc('mount', 'Monta un sistema de archivos en un directorio', 'sudo mount [DISPOSITIVO DIRECTORIO] | sudo mount -a', ['Sin argumentos lista lo montado. -a monta todo lo de /etc/fstab (pruébalo siempre tras editar fstab).'], [['-a', 'Todo lo de fstab'], ['-t TIPO', 'Tipo de sistema de archivos']], [['sudo mount /dev/sdb1 /data', 'Monta el disco'], ['sudo mount -a', 'Comprobar /etc/fstab']],
    'Línea de /etc/fstab: UUID=xxxx  /data  ext4  defaults  0  2'),
  doc('umount', 'Desmonta un sistema de archivos', 'sudo umount DIRECTORIO|DISPOSITIVO', ['"target is busy": alguien (quizá tú) está dentro del directorio.'], [], [['sudo umount /data', 'Desmontar']]),
  doc('truncate', 'Cambia el tamaño de un archivo', 'truncate -s 0 ARCHIVO', ['Vacía un archivo SIN borrarlo: ideal para logs abiertos por un servicio.'], [['-s TAMAÑO', 'Tamaño final']], [['sudo truncate -s 0 /var/log/app/debug.log', 'Libera espacio al instante']]),
  // Red
  doc('ip', 'Red: direcciones, rutas e interfaces', 'ip a | ip r | ip link', ['Sustituye a ifconfig y route.'], [['a (address)', 'IPs de cada interfaz'], ['r (route)', 'Tabla de rutas (default via = puerta de enlace)'], ['link', 'Interfaces'], ['-br', 'Formato breve']], [['ip -br a', 'IPs en una línea por interfaz'], ['ip r', '¿Por dónde sale el tráfico?']]),
  doc('hostname', 'Nombre de la máquina', 'hostname [-I]', [], [['-I', 'Todas sus IPs']], [['hostname -I', 'IPs del servidor']]),
  doc('ping', 'Comprueba si un equipo responde', 'ping [-c N] HOST', ['Mide la latencia (ms) y la pérdida de paquetes. Algunos servidores bloquean ping aunque estén vivos.'], [['-c N', 'Envía N paquetes y termina']], [['ping -c 4 8.8.8.8', '¿Hay Internet?'], ['ping -c 2 db01', '¿Responde la base de datos?']]),
  doc('traceroute', 'Muestra el camino hasta un equipo', 'traceroute HOST', ['Cada línea es un router intermedio. Los * indican saltos que no responden.'], [], [['traceroute google.com', 'Ver la ruta']]),
  doc('dig', 'Consulta el DNS', 'dig [+short] NOMBRE [TIPO]', [], [['+short', 'Solo la respuesta'], ['MX / NS / TXT', 'Otros tipos de registro']], [['dig +short github.com', 'IP de github'], ['dig example.com MX', 'Servidores de correo']]),
  doc('nslookup', 'Consulta el DNS (clásico)', 'nslookup NOMBRE', [], [], [['nslookup example.com', 'Resuelve el nombre']]),
  doc('host', 'Resolución DNS directa e inversa', 'host NOMBRE|IP', [], [], [['host 1.1.1.1', 'Nombre de una IP']]),
  doc('curl', 'Cliente HTTP: probar webs y APIs', 'curl [OPCIÓN]... URL',
    [],
    [['-I', 'Solo cabeceras'], ['-i', 'Cabeceras y cuerpo'], ['-L', 'Sigue redirecciones'], ['-o F / -O', 'Guarda en F / con su nombre'], ['-s', 'Silencioso'], ['-X MÉTODO', 'POST, PUT, DELETE...'],
      ['-H "K: V"', 'Cabecera'], ['-d DATOS', 'Cuerpo (POST)'], ['-w "%{http_code}"', 'Imprime el código HTTP'], ['-f', 'Error si el código es ≥400']],
    [['curl -I https://example.com', '¿Responde la web?'], ['curl -s -o /dev/null -w "%{http_code}" localhost', 'Solo el código (healthcheck)'], ['curl -X POST -H "Content-Type: application/json" -d \'{"a":1}\' localhost:3000/api', 'Probar una API']]),
  doc('wget', 'Descarga archivos', 'wget [-O ARCHIVO] [-q] URL', [], [['-O F', 'Nombre de destino (- = pantalla)'], ['-q', 'Silencioso']], [['wget https://example.com/app.tar.gz', 'Descargar']]),
  ss, alias('netstat', ss, 'versión antigua (paquete net-tools)'),
  doc('lsof', 'Archivos y puertos abiertos por los procesos', 'lsof [-i :PUERTO] [-u USUARIO] [+L1] [RUTA]', ['En Linux todo es un archivo: también las conexiones de red.'], [['-i :80', 'Quién usa el puerto 80'], ['-u U', 'De un usuario'], ['+L1', 'Archivos borrados aún abiertos (ocupan disco)']], [['sudo lsof -i :8080', 'Quién ocupa el 8080'], ['sudo lsof +L1', 'Espacio "fantasma"']]),
  // SSH
  doc('ssh-keygen', 'Crea un par de claves SSH', 'ssh-keygen [-t ed25519] [-C comentario] [-f ruta] [-N frase]', ['Genera ~/.ssh/id_TIPO (privada, 600) e id_TIPO.pub (pública). ed25519 es la opción moderna recomendada.'], [['-t', 'Tipo'], ['-C', 'Comentario (tu correo)'], ['-f', 'Ruta'], ['-N', 'Frase de paso']], [['ssh-keygen -t ed25519 -C "yo@empresa.com"', 'Par de claves nuevo']], 'La clave privada NUNCA se copia a ningún servidor ni se sube a git.'),
  doc('ssh-copy-id', 'Instala tu clave pública en un servidor', 'ssh-copy-id [-i CLAVE] USUARIO@HOST', ['Añade tu .pub al ~/.ssh/authorized_keys remoto con los permisos correctos. Pide la contraseña una última vez.'], [], [['ssh-copy-id deploy@10.0.0.11', 'A partir de ahora, sin contraseña']]),
  doc('ssh', 'Sesión remota segura', 'ssh [-p PUERTO] [-i CLAVE] USUARIO@HOST [COMANDO]', ['Sin comando abre una shell remota (exit para salir). Con comando, lo ejecuta y vuelve.'], [['-p', 'Puerto'], ['-i', 'Clave privada concreta'], ['-v', 'Detalle (depurar conexiones)']], [['ssh deploy@web01', 'Entrar'], ['ssh deploy@web01 "df -h"', 'Un comando remoto']], 'En ~/.ssh/config puedes definir alias: Host web → HostName, User, Port, IdentityFile.'),
  doc('scp', 'Copia archivos por SSH', 'scp [-r] ORIGEN USUARIO@HOST:DESTINO', [], [['-r', 'Directorios'], ['-P', 'Puerto (P mayúscula)']], [['scp app.tar.gz deploy@web01:/tmp/', 'Subir'], ['scp deploy@web01:/var/log/app.log .', 'Bajar']]),
  doc('rsync', 'Sincroniza directorios (local o por SSH)', 'rsync -av [--delete] ORIGEN/ DESTINO/', ['Solo transfiere lo que cambió. La barra final de ORIGEN importa: "dir/" copia el contenido; "dir" copia la carpeta.'], [['-a', 'Modo archivo (conserva permisos y fechas)'], ['-v', 'Detalle'], ['--delete', 'Borra en destino lo que ya no está en origen'], ['-n', 'Simulación']], [['rsync -av /var/www/ deploy@web02:/var/www/', 'Replica una web']]),
  doc('sshd', 'Servidor SSH', 'sudo sshd -t | sudo sshd -T', ['Configuración en /etc/ssh/sshd_config. Opciones clave: Port, PermitRootLogin no, PasswordAuthentication no, AllowUsers.'], [['-t', 'Comprueba la sintaxis'], ['-T', 'Muestra la configuración efectiva']], [['sudo sshd -t && sudo systemctl restart ssh', 'Aplicar cambios con seguridad']], '⚠ No cierres tu sesión hasta probar en OTRA terminal que puedes volver a entrar.'),
  // Servicios y logs
  systemctl,
  doc('service', 'Forma clásica de controlar servicios', 'sudo service SERVICIO start|stop|restart|status', [], [], [['sudo service nginx restart', 'Equivale a systemctl restart nginx']]),
  doc('journalctl', 'Lee el registro de systemd', 'journalctl [-u UNIDAD] [-p PRIORIDAD] [-n N] [-f] [--since ...]', [], [['-u S', 'De un servicio'], ['-p err', 'Errores o peor'], ['-n 50', 'Últimas 50'], ['-f', 'En directo'], ['--since "1 hour ago"', 'Desde hace una hora'], ['-k', 'Solo el kernel'], ['-xe', 'Final con explicaciones']], [['journalctl -u nginx --since today', 'Hoy en nginx'], ['journalctl -p err -b', 'Errores desde el arranque']]),
  doc('crontab', 'Tareas programadas de cada usuario', 'crontab [-u USUARIO] -l|-e|-r | crontab ARCHIVO',
    ['Línea: minuto hora día-mes mes día-semana comando. * = cualquiera, */5 = cada 5, 1-5 = rango, 1,15 = lista. Atajos: @reboot @daily @hourly.'],
    [['-l', 'Listar'], ['-e', 'Editar'], ['-r', '⚠ Borrar TODO'], ['-u U', 'De otro usuario (root)']],
    [['crontab -e', 'Editar tus tareas'], ["(crontab -l; echo '0 3 * * * /usr/local/bin/backup.sh') | crontab -", 'Añadir una línea desde un script'], ['sudo crontab -l', 'Tareas de root']],
    'Redirige siempre la salida: comando >> /var/log/tarea.log 2>&1'),
  doc('dmesg', 'Mensajes del kernel', 'sudo dmesg [-T]', ['Hardware, discos, red y el temido "Out of memory".'], [['-T', 'Fechas legibles']], [['sudo dmesg -T | tail', 'Lo último del kernel'], ['sudo dmesg | grep -i oom', '¿Ha matado procesos por falta de memoria?']]),
  doc('logger', 'Escribe en el log del sistema', 'logger [-t ETIQUETA] MENSAJE', [], [['-t', 'Etiqueta']], [['logger -t backup "Copia completada"', 'Desde un script']]),
  doc('logrotate', 'Rota, comprime y borra logs antiguos', 'sudo logrotate [-d] [-f] CONFIG',
    ['Se ejecuta a diario automáticamente. Configuraciones en /etc/logrotate.d/. Directivas: daily/weekly, rotate N, compress, delaycompress, missingok, notifempty, create MODO USUARIO GRUPO, postrotate ... endscript.'],
    [['-d', 'Prueba (no cambia nada)'], ['-f', 'Fuerza la rotación ahora']], [['sudo logrotate -d /etc/logrotate.d/miapp', 'Comprobar la configuración']]),
  // Seguridad
  ufw,
  doc('iptables', 'Reglas del cortafuegos del kernel (bajo nivel)', 'sudo iptables [-L -n] [-A|-I|-D CADENA REGLA]', ['ufw genera estas reglas por ti. Cadenas: INPUT (entrante), OUTPUT (saliente), FORWARD. Acciones: ACCEPT, DROP, REJECT.'], [['-L -n -v', 'Listar'], ['-A INPUT -s IP -j DROP', 'Añadir al final'], ['-I', 'Insertar al principio'], ['-D', 'Borrar'], ['-F', 'Vaciar']], [['sudo iptables -L -n', 'Ver reglas'], ['sudo iptables -I INPUT -s 203.0.113.9 -j DROP', 'Bloquear una IP']]),
  doc('fail2ban-client', 'Controla fail2ban', 'sudo fail2ban-client status [JAULA] | set JAULA banip|unbanip IP', ['fail2ban banea las IPs que fallan demasiado. Configuración propia en /etc/fail2ban/jail.local.'], [], [['sudo fail2ban-client status sshd', 'IPs baneadas en SSH'], ['sudo fail2ban-client set sshd unbanip 10.0.0.5', 'Desbanear (¡te pasará!)']]),
  // Rendimiento
  doc('uptime', 'Tiempo encendido y carga media', 'uptime [-p]', ['Load average de 1, 5 y 15 minutos: compáralo con el número de CPUs (nproc).'], [['-p', 'Formato bonito']], [['uptime', 'Estado rápido']]),
  doc('w', 'Quién está conectado y qué hace', 'w', [], [], [['w', 'Sesiones abiertas']]),
  doc('who', 'Quién está conectado', 'who', [], [], [['who', 'Usuarios conectados']]),
  doc('free', 'Memoria RAM y swap', 'free [-h]', ['Fíjate en "available", no en "free": Linux usa la RAM libre como caché.'], [['-h', 'Legible']], [['free -h', 'Memoria']]),
  doc('vmstat', 'Resumen de CPU, memoria, swap y E/S', 'vmstat [INTERVALO [N]]', ['r: procesos esperando CPU · si/so: swap (≠0 = falta RAM) · wa: CPU esperando al disco.'], [], [['vmstat 1 5', '5 muestras de 1 segundo']]),
  doc('iostat', 'Actividad de los discos', 'iostat [-x] [INTERVALO]', ['Paquete sysstat.'], [['-x', 'Detalle extendido (%util)']], [['iostat -x 2', 'Cada 2 segundos']]),
];
