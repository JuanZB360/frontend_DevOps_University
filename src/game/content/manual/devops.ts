/**
 * Manual de las herramientas de los módulos DevOps (Nginx, Docker, Git...).
 */
import type { CommandDoc } from '../../manual/CommandDoc';
import { doc } from './docHelper';

export const DEVOPS_DOCS: CommandDoc[] = [
  doc('ln', 'Crea enlaces entre archivos', 'ln [-s] [-f] DESTINO [NOMBRE_DEL_ENLACE]',
    ['Un enlace simbólico (-s) es un "acceso directo": apunta a otra ruta. Si borras el enlace, el original sigue intacto.'],
    [['-s', 'Simbólico (el habitual)'], ['-f', 'Sustituye si ya existe']],
    [['sudo ln -s /etc/nginx/sites-available/tienda /etc/nginx/sites-enabled/', 'Activa un sitio de nginx'], ['ln -s /opt/app/v2 /opt/app/actual', 'Apuntar "actual" a la versión 2']],
    'Despliegues sin caída: sube la versión nueva a otra carpeta y cambia el enlace de golpe.'),
  doc('readlink', 'Muestra a dónde apunta un enlace', 'readlink [-f] ENLACE', [], [['-f', 'Ruta real final']], [['readlink /etc/nginx/sites-enabled/tienda', 'Ver el destino']]),
  doc('nginx', 'Servidor web y proxy inverso', 'sudo nginx -t | -T | -s reload|stop | -v',
    ['Configuración: /etc/nginx/nginx.conf + sitios en /etc/nginx/sites-available/ (activos con un enlace en sites-enabled/) y /etc/nginx/conf.d/*.conf.',
      'Logs: /var/log/nginx/access.log (cada petición) y error.log (los fallos y su porqué).'],
    [['-t', 'Comprueba la configuración (¡siempre antes de recargar!)'], ['-T', 'Comprueba y muestra la configuración completa'], ['-s reload', 'Recarga sin cortar conexiones'], ['-v / -V', 'Versión / módulos']],
    [['sudo nginx -t && sudo systemctl reload nginx', 'El ritual de cada cambio'], ['sudo tail -f /var/log/nginx/error.log', 'Ver errores en directo']],
    'Estructura de un sitio: server { listen 80; server_name dominio; root /var/www/sitio; location / { try_files $uri $uri/ =404; } }'),
];

DEVOPS_DOCS.push(
  doc('node', 'Ejecuta aplicaciones JavaScript (Node.js)', 'node SCRIPT.js', ['Las apps web de Node escuchan en un puerto (3000 por convención). En producción se lanzan como servicio de systemd o en un contenedor, detrás de nginx.'], [['-v', 'Versión']], [['node server.js &', 'Arranca la app en segundo plano'], ['PORT=3001 node server.js &', 'Otra instancia en otro puerto']]),
  doc('certbot', "Certificados HTTPS gratuitos de Let's Encrypt", 'sudo certbot --nginx -d DOMINIO | certificates | renew [--dry-run]',
    ['Verifica que controlas el dominio (DNS apuntando al servidor y puerto 80 accesible), guarda el certificado en /etc/letsencrypt/live/DOMINIO/ y configura nginx (listen 443 ssl + redirección).'],
    [['--nginx', 'Usa y configura nginx'], ['-d DOMINIO', 'Dominio (puede repetirse)'], ['--non-interactive --agree-tos -m CORREO', 'Sin preguntas (scripts)'], ['certificates', 'Lista los certificados'], ['renew --dry-run', 'Simula la renovación']],
    [['sudo certbot --nginx -d tienda.com -d www.tienda.com', 'HTTPS para dos nombres'], ['sudo certbot renew --dry-run', 'Comprobar la renovación automática']]),
  doc('htpasswd', 'Gestiona usuarios para la autenticación básica', 'htpasswd [-c] [-b] ARCHIVO USUARIO [CLAVE]', ['Paquete apache2-utils. Se usa con auth_basic y auth_basic_user_file en nginx.'], [['-c', 'Crea el archivo (¡lo sobrescribe!)'], ['-b', 'Contraseña en la línea de comandos']], [['sudo htpasswd -c /etc/nginx/.htpasswd admin', 'Primer usuario'], ['sudo htpasswd /etc/nginx/.htpasswd ana', 'Añadir otro']]),
);

DEVOPS_DOCS.push(
  doc('newgrp', 'Aplica un grupo nuevo sin cerrar sesión', 'newgrp GRUPO', ['Tras usermod -aG, tu sesión actual no ve el grupo hasta volver a entrar; newgrp lo aplica ya.'], [], [['newgrp docker', 'Usar docker sin sudo tras añadirte al grupo']]),
  doc('docker', 'Contenedores: imágenes, ejecución, volúmenes, redes y compose', 'docker COMANDO [OPCIONES]',
    ['Ciclo de vida: imagen (docker pull / docker build) → contenedor (docker run) → logs / exec → stop / rm.',
      'Dockerfile: FROM, WORKDIR, COPY, RUN, ENV, EXPOSE, USER, CMD. Multi-stage: varios FROM y COPY --from=etapa.',
      'Compose (compose.yaml): services (image/build, ports, environment, volumes, networks, depends_on, healthcheck, restart), volumes, networks.'],
    [['run -d --name N -p H:C -e K=V -v vol:/ruta IMAGEN', 'Crear y arrancar un contenedor'], ['ps [-a]', 'Contenedores (en marcha / todos)'], ['logs [-f] C', 'Su salida'], ['exec C CMD', 'Ejecutar dentro'],
      ['build -t nombre:ver .', 'Construir imagen'], ['images / rmi', 'Imágenes'], ['volume ls|create|inspect|rm', 'Volúmenes'], ['network ls|create|connect', 'Redes'], ['inspect -f "{{...}}" X', 'Detalles'], ['system df / system prune', 'Espacio y limpieza'],
      ['compose up -d [--build] / ps / logs / down [-v]', 'Proyectos multi-contenedor']],
    [['docker run -d --name web -p 8080:80 nginx', 'Un nginx en el 8080'], ['docker exec -it web sh', 'Shell dentro del contenedor'], ['docker build -t api:1.0 . && docker run -d -p 3000:3000 api:1.0', 'Construir y ejecutar'], ['docker compose up -d --build', 'Levantar un proyecto']],
    'Nunca uses :latest en producción y nunca metas contraseñas en la imagen: van en variables de entorno o secretos.'),
);
