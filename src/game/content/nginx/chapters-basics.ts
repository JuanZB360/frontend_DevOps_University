/**
 * Nginx — capítulos 1 a 5: instalación, anatomía, sitios estáticos,
 * virtual hosts y locations.
 */
import { rewardFor, type Chapter } from '../../domain/curriculum';
import { all, machine, outputMatches, packageInstalled, ran, serviceActive, systemFileMatches } from '../../missions/checks';
import { aptReady, withMachine } from '../../missions/worldHelpers';
import { configValid, ensureNginx, removeSite, responds, rootFiles, writeSite } from './helpers';

const TIENDA_HTML = '<!doctype html>\n<html>\n<head><title>Tienda DevOps</title></head>\n<body><h1>Bienvenido a la Tienda DevOps</h1></body>\n</html>\n';
const BLOG_HTML = '<!doctype html>\n<html>\n<head><title>Blog</title></head>\n<body><h1>Blog de N0X</h1></body>\n</html>\n';

export const nginxChapter01: Chapter = {
  id: 'nginx-01',
  number: 1,
  title: 'Instalación y primer contacto',
  description: 'El servidor web más usado del mundo, funcionando en tu máquina en dos minutos.',
  missions: [
    {
      id: 'nginx-01-01',
      title: 'Instalar nginx',
      difficulty: 2,
      teaches: ['nginx'],
      briefing: [
        'Bienvenido a la carrera de Nginx. Nginx (se pronuncia "engine-x") es un servidor web y proxy inverso:',
        'sirve páginas, reparte tráfico entre aplicaciones y gestiona HTTPS. Lo usan millones de webs.',
        'En Ubuntu se instala con apt y queda arrancado como servicio automáticamente.',
      ],
      objective: 'Instala nginx.',
      hints: ['Como cualquier paquete: apt install, con sudo.', 'sudo apt install -y nginx', 'Escribe: sudo apt update && sudo apt install -y nginx'],
      setup: (world) => aptReady(world),
      solution: 'sudo apt update && sudo apt install -y nginx',
      check: all(packageInstalled('nginx'), serviceActive('nginx')),
      success: 'nginx instalado y en marcha. Ya está sirviendo una página en el puerto 80.',
      reward: rewardFor(2),
    },
    {
      id: 'nginx-01-02',
      title: 'La primera visita',
      difficulty: 2,
      teaches: [],
      briefing: [
        'Pruébalo como lo haría un navegador: `curl http://localhost`',
        'Deberías ver el HTML de "Welcome to nginx!". Con `curl -I` verás las cabeceras: la versión de nginx incluida.',
      ],
      objective: 'Pide la página principal a tu nginx con curl.',
      hints: ['curl a localhost.', 'curl http://localhost', 'Escribe: curl http://localhost'],
      setup: (world) => ensureNginx(world),
      solution: 'curl http://localhost',
      check: outputMatches('curl', /Welcome to nginx/),
      success: 'Tu servidor web responde. Esa página vive en /var/www/html.',
      reward: rewardFor(2),
    },
    {
      id: 'nginx-01-03',
      title: 'El servicio',
      difficulty: 2,
      teaches: [],
      briefing: [
        'nginx es un servicio de systemd: `systemctl status nginx`.',
        'Verás un proceso "master" (root, lee la configuración) y procesos "worker" (www-data, atienden peticiones).',
        'Con `sudo ss -tlnp` comprueba que escucha en el puerto 80.',
      ],
      objective: 'Comprueba qué proceso escucha en el puerto 80.',
      hints: ['ss con -tlnp, como root.', 'sudo ss -tlnp', 'Escribe: sudo ss -tlnp'],
      setup: (world) => ensureNginx(world),
      solution: 'sudo ss -tlnp',
      check: outputMatches('ss', /:http\b|:80\b/),
      success: 'nginx escucha en el 80 (http). Si otro programa lo ocupara, nginx no podría arrancar.',
      reward: rewardFor(2),
    },
    {
      id: 'nginx-01-04',
      title: 'Abrir la puerta',
      difficulty: 3,
      teaches: [],
      briefing: [
        'Si el cortafuegos está activo, nadie desde fuera podrá ver tu web.',
        'nginx trae perfiles para ufw: `sudo ufw app list` → "Nginx HTTP", "Nginx HTTPS", "Nginx Full".',
        '`sudo ufw allow "Nginx Full"` abre 80 y 443 de una vez.',
      ],
      objective: 'Permite el tráfico web (80 y 443) en ufw con el perfil de nginx.',
      hints: ['ufw allow con el perfil entre comillas.', 'sudo ufw allow "Nginx Full"', 'Escribe: sudo ufw allow "Nginx Full"'],
      setup: (world) => {
        ensureNginx(world);
        withMachine(world, (m) => {
          m.firewall.rules = m.firewall.rules.filter((r) => r.to !== 'Nginx Full' && r.to !== '80,443/tcp');
        });
      },
      solution: 'sudo ufw allow "Nginx Full"',
      check: machine((m) => m.firewall.rules.some((r) => r.action === 'allow' && (r.to === 'Nginx Full' || /^80,443/.test(r.to)))),
      success: 'Puertos web abiertos. Tu web ya es accesible desde Internet.',
      reward: rewardFor(3),
    },
  ],
};

export const nginxChapter02: Chapter = {
  id: 'nginx-02',
  number: 2,
  title: 'Anatomía de la configuración',
  description: 'Directivas, bloques e includes: cómo piensa nginx.',
  missions: [
    {
      id: 'nginx-02-01',
      title: 'El archivo principal',
      difficulty: 2,
      teaches: [],
      briefing: [
        'Todo empieza en /etc/nginx/nginx.conf. Su estructura:',
        '  directivas simples terminadas en `;`   →  `worker_processes auto;`',
        '  bloques con llaves                    →  `events { ... }`  `http { ... }`',
        'Dentro de http se incluyen los sitios: `include /etc/nginx/sites-enabled/*;`',
      ],
      objective: 'Muestra /etc/nginx/nginx.conf y busca las líneas include.',
      hints: ['grep sobre el archivo.', 'grep include /etc/nginx/nginx.conf', 'Escribe: grep include /etc/nginx/nginx.conf'],
      setup: (world) => ensureNginx(world),
      solution: 'grep include /etc/nginx/nginx.conf',
      check: outputMatches('grep', /sites-enabled/),
      success: 'Cada sitio vive en su propio archivo dentro de sites-enabled.',
      reward: rewardFor(2),
    },
    {
      id: 'nginx-02-02',
      title: 'Comprobar antes de aplicar',
      difficulty: 2,
      teaches: [],
      briefing: [
        'REGLA DE ORO: antes de aplicar cambios, `sudo nginx -t`.',
        'Comprueba la sintaxis de toda la configuración y te dice archivo y línea de cada error.',
        'Si recargas una configuración rota, nginx la rechaza (y en un arranque, ni siquiera arranca).',
      ],
      objective: 'Comprueba la configuración de nginx.',
      hints: ['nginx con la opción de test.', 'sudo nginx -t', 'Escribe: sudo nginx -t'],
      setup: (world) => ensureNginx(world),
      solution: 'sudo nginx -t',
      check: (ctx) => ctx.report.commands.some((c) => c.name === 'nginx' && c.args.includes('-t') && c.exitCode === 0),
      success: '"syntax is ok" y "test is successful": luz verde.',
      reward: rewardFor(2),
    },
    {
      id: 'nginx-02-03',
      title: 'Encuentra el error',
      difficulty: 3,
      teaches: [],
      briefing: [
        'Un compañero editó el sitio "promo" y ahora nginx -t falla. Los errores típicos:',
        '  · falta un `;` al final de una directiva',
        '  · una directiva mal escrita (listne, sever_name...)',
        '  · una llave sin cerrar',
        'nginx -t te dice el archivo y la línea: corrígelo (sudo nano) y vuelve a comprobar.',
      ],
      objective: 'Corrige el error de /etc/nginx/sites-available/promo hasta que nginx -t sea correcto.',
      hints: ['sudo nginx -t te dice la línea exacta.', 'La directiva está mal escrita: "sever_name" debería ser "server_name".', "Escribe: sudo sed -i 's/sever_name/server_name/' /etc/nginx/sites-available/promo && sudo nginx -t"],
      setup: (world) => {
        ensureNginx(world);
        writeSite(world, 'promo', 'server {\n    listen 8081;\n    sever_name promo.devops-u.com;\n    root /var/www/html;\n}\n');
      },
      solution: "sudo sed -i 's/sever_name/server_name/' /etc/nginx/sites-available/promo && sudo nginx -t",
      check: all(configValid, systemFileMatches('/etc/nginx/sites-available/promo', /server_name promo/)),
      success: 'Configuración válida de nuevo. Leer bien los errores de nginx -t te ahorrará horas.',
      reward: rewardFor(3),
    },
    {
      id: 'nginx-02-04',
      title: 'Disponible vs habilitado',
      difficulty: 3,
      teaches: ['ln', 'readlink'],
      briefing: [
        'Ubuntu separa los sitios en dos carpetas:',
        '  /etc/nginx/sites-available/  → TODOS los sitios configurados',
        '  /etc/nginx/sites-enabled/    → enlaces simbólicos a los que están ACTIVOS',
        'Activar = crear el enlace: `sudo ln -s /etc/nginx/sites-available/X /etc/nginx/sites-enabled/`',
        'Desactivar = borrar el enlace (el archivo original no se toca).',
      ],
      objective: 'Desactiva el sitio por defecto (default) eliminando su enlace de sites-enabled.',
      hints: ['Borra solo el enlace de sites-enabled.', 'sudo rm /etc/nginx/sites-enabled/default', 'Escribe: sudo rm /etc/nginx/sites-enabled/default'],
      setup: (world) => {
        ensureNginx(world);
        removeSite(world, 'promo');
        world.fs.privileged(() => {
          if (!world.fs.tryStat('/etc/nginx/sites-enabled/default', false)) world.fs.symlink('/etc/nginx/sites-available/default', '/etc/nginx/sites-enabled/default');
        });
      },
      solution: 'sudo rm /etc/nginx/sites-enabled/default',
      check: (ctx) => ctx.fs.privileged(() => !ctx.fs.tryStat('/etc/nginx/sites-enabled/default', false) && ctx.fs.exists('/etc/nginx/sites-available/default')),
      success: 'Desactivado sin perder el archivo: podrás reactivarlo con ln -s cuando quieras.',
      reward: rewardFor(3),
    },
    {
      id: 'nginx-02-05',
      title: 'Aplicar sin cortar',
      difficulty: 2,
      teaches: [],
      briefing: [
        'Cambiar archivos no cambia nada hasta que nginx los vuelve a leer.',
        '`sudo systemctl reload nginx` (o `sudo nginx -s reload`) aplica la configuración SIN cortar las conexiones abiertas.',
        'restart para y arranca: corta a los usuarios conectados. En producción, siempre reload.',
      ],
      objective: 'Comprueba la configuración y recarga nginx para aplicar que ya no hay sitio por defecto.',
      hints: ['nginx -t y después reload.', 'sudo nginx -t && sudo systemctl reload nginx', 'Escribe: sudo nginx -t && sudo systemctl reload nginx'],
      setup: (world) => {
        ensureNginx(world);
        world.fs.privileged(() => world.fs.tryStat('/etc/nginx/sites-enabled/default', false) && world.fs.remove('/etc/nginx/sites-enabled/default'));
      },
      solution: 'sudo nginx -t && sudo systemctl reload nginx',
      check: (ctx) => ran('systemctl', (a) => a[0] === 'reload')(ctx) || ran('nginx', (a) => a.includes('reload'))(ctx),
      success: 'Recargado. Ahora mismo nginx no tiene ningún sitio en el 80: vamos a crear el tuyo.',
      reward: rewardFor(2),
    },
  ],
};

const TIENDA_SITE = 'server {\n    listen 80;\n    server_name tienda.devops-u.com;\n    root /var/www/tienda;\n    index index.html;\n}\n';

export const nginxChapter03: Chapter = {
  id: 'nginx-03',
  number: 3,
  title: 'Sitios estáticos',
  description: 'HTML, CSS e imágenes servidos a toda velocidad.',
  missions: [
    {
      id: 'nginx-03-01',
      title: 'Los archivos de la web',
      difficulty: 2,
      teaches: [],
      briefing: [
        'Una web estática es una carpeta con HTML, CSS, JS e imágenes. Por convención: /var/www/NOMBRE',
        'Crea /var/www/tienda con un index.html que contenga "Bienvenido a la Tienda DevOps".',
      ],
      objective: 'Crea /var/www/tienda/index.html con el texto "Bienvenido a la Tienda DevOps".',
      hints: ['mkdir -p y tee, con sudo.', "sudo mkdir -p /var/www/tienda && echo '<h1>Bienvenido a la Tienda DevOps</h1>' | sudo tee /var/www/tienda/index.html", "Escribe: sudo mkdir -p /var/www/tienda && echo '<h1>Bienvenido a la Tienda DevOps</h1>' | sudo tee /var/www/tienda/index.html"],
      setup: (world) => ensureNginx(world),
      solution: "sudo mkdir -p /var/www/tienda && echo '<h1>Bienvenido a la Tienda DevOps</h1>' | sudo tee /var/www/tienda/index.html",
      check: systemFileMatches('/var/www/tienda/index.html', /Bienvenido a la Tienda DevOps/),
      success: 'Contenido listo. Ahora hay que decirle a nginx que lo sirva.',
      reward: rewardFor(2),
    },
    {
      id: 'nginx-03-02',
      title: 'Tu primer bloque server',
      difficulty: 4,
      teaches: [],
      briefing: [
        'Un sitio se define con un bloque server:',
        '  server {',
        '      listen 80;                         # puerto',
        '      server_name tienda.devops-u.com;   # dominio',
        '      root /var/www/tienda;              # carpeta de la web',
        '      index index.html;                  # archivo por defecto',
        '  }',
        'Guárdalo en /etc/nginx/sites-available/tienda, enlázalo en sites-enabled, comprueba y recarga.',
      ],
      objective: 'Publica /var/www/tienda como tienda.devops-u.com (sitio "tienda" habilitado y nginx recargado).',
      hints: [
        'Cuatro pasos: escribir el archivo, ln -s, nginx -t, reload.',
        "printf 'server {\\n    listen 80;\\n    server_name tienda.devops-u.com;\\n    root /var/www/tienda;\\n    index index.html;\\n}\\n' | sudo tee /etc/nginx/sites-available/tienda",
        "Escribe: printf 'server {\\n    listen 80;\\n    server_name tienda.devops-u.com;\\n    root /var/www/tienda;\\n    index index.html;\\n}\\n' | sudo tee /etc/nginx/sites-available/tienda && sudo ln -s /etc/nginx/sites-available/tienda /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx",
      ],
      setup: (world) => {
        ensureNginx(world);
        removeSite(world, 'tienda');
        rootFiles(world, { '/var/www/tienda/index.html': TIENDA_HTML });
      },
      solution: "printf 'server {\\n    listen 80;\\n    server_name tienda.devops-u.com;\\n    root /var/www/tienda;\\n    index index.html;\\n}\\n' | sudo tee /etc/nginx/sites-available/tienda && sudo ln -s /etc/nginx/sites-available/tienda /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx",
      check: responds('http://tienda.devops-u.com/', (r) => r.status === 200 && /Tienda DevOps/.test(r.body)),
      success: 'http://tienda.devops-u.com sirve tu web. Pruébalo: curl http://tienda.devops-u.com',
      reward: rewardFor(4),
    },
    {
      id: 'nginx-03-03',
      title: 'Página 404 propia',
      difficulty: 3,
      teaches: [],
      briefing: [
        '`error_page 404 /404.html;` muestra tu propia página cuando algo no existe.',
        'Añádelo al bloque server de la tienda y crea /var/www/tienda/404.html.',
      ],
      objective: 'Haz que la tienda muestre /404.html (con el texto "Página no encontrada") en los errores 404.',
      hints: [
        'Crea el 404.html y añade error_page 404 /404.html; dentro del server (sed o nano).',
        "sudo sed -i 's|index index.html;|index index.html;\\n    error_page 404 /404.html;|' /etc/nginx/sites-available/tienda",
        "Escribe: echo 'Página no encontrada' | sudo tee /var/www/tienda/404.html && sudo sed -i 's|index index.html;|index index.html;\\n    error_page 404 /404.html;|' /etc/nginx/sites-available/tienda && sudo nginx -t && sudo systemctl reload nginx",
      ],
      setup: (world) => {
        ensureNginx(world);
        rootFiles(world, { '/var/www/tienda/index.html': TIENDA_HTML });
        writeSite(world, 'tienda', TIENDA_SITE);
      },
      solution: "echo 'Página no encontrada' | sudo tee /var/www/tienda/404.html && sudo sed -i 's|index index.html;|index index.html;\\n    error_page 404 /404.html;|' /etc/nginx/sites-available/tienda && sudo nginx -t && sudo systemctl reload nginx",
      check: responds('http://tienda.devops-u.com/no-existe', (r) => /Página no encontrada/.test(r.body)),
      success: 'Una 404 con tu marca. Pequeño detalle, gran diferencia.',
      reward: rewardFor(3),
    },
    {
      id: 'nginx-03-04',
      title: 'Permisos de la web',
      difficulty: 4,
      teaches: [],
      briefing: [
        'La web nueva /var/www/privada devuelve 403 Forbidden. ¿Por qué?',
        'Los workers de nginx son el usuario www-data: necesitan permiso de LECTURA en los archivos',
        'y de ENTRADA (x) en cada directorio del camino. Mira el error.log: "Permission denied".',
      ],
      objective: 'Arregla los permisos de /var/www/privada para que http://localhost:8082 deje de dar 403.',
      hints: [
        'sudo tail /var/log/nginx/error.log y ls -l /var/www/privada.',
        'El directorio tiene permisos 700 y es de root. Dale 755 (o cámbialo a www-data).',
        'Escribe: sudo chmod 755 /var/www/privada && sudo chmod 644 /var/www/privada/index.html',
      ],
      setup: (world) => {
        ensureNginx(world);
        rootFiles(world, { '/var/www/privada/index.html': '<h1>Zona privada</h1>\n' });
        world.fs.privileged(() => {
          world.fs.chmod('/var/www/privada', 0o700);
          world.fs.chmod('/var/www/privada/index.html', 0o600);
        });
        writeSite(world, 'privada', 'server {\n    listen 8082;\n    root /var/www/privada;\n    index index.html;\n}\n');
        rootFiles(world, {});
        reloadAfter(world);
      },
      solution: 'sudo chmod 755 /var/www/privada && sudo chmod 644 /var/www/privada/index.html',
      check: responds('http://localhost:8082/', (r) => r.status === 200 && /Zona privada/.test(r.body)),
      success: '403 resuelto. Error clásico: el 90 % de los 403 en nginx son permisos.',
      reward: rewardFor(4),
    },
  ],
};

/** Recarga nginx tras preparar un escenario. */
function reloadAfter(world: Parameters<typeof ensureNginx>[0]): void {
  ensureNginx(world);
}

export const nginxChapter04: Chapter = {
  id: 'nginx-04',
  number: 4,
  title: 'Virtual hosts',
  description: 'Muchas webs en un solo servidor, distinguidas por su dominio.',
  missions: [
    {
      id: 'nginx-04-01',
      title: 'Dos webs, una IP',
      difficulty: 4,
      teaches: [],
      briefing: [
        'Con server_name, nginx decide qué web servir según el dominio que pide el navegador (cabecera Host).',
        'Todas pueden compartir el puerto 80. Esto se llama "virtual hosts".',
        'Crea el sitio blog (blog.devops-u.com → /var/www/blog).',
      ],
      objective: 'Publica /var/www/blog como blog.devops-u.com en el puerto 80, junto a la tienda.',
      hints: [
        'Igual que la tienda: archivo en sites-available, enlace, test y reload.',
        "printf 'server {\\n    listen 80;\\n    server_name blog.devops-u.com;\\n    root /var/www/blog;\\n    index index.html;\\n}\\n' | sudo tee /etc/nginx/sites-available/blog",
        "Escribe: printf 'server {\\n    listen 80;\\n    server_name blog.devops-u.com;\\n    root /var/www/blog;\\n    index index.html;\\n}\\n' | sudo tee /etc/nginx/sites-available/blog && sudo ln -s /etc/nginx/sites-available/blog /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx",
      ],
      setup: (world) => {
        ensureNginx(world);
        rootFiles(world, { '/var/www/tienda/index.html': TIENDA_HTML, '/var/www/blog/index.html': BLOG_HTML });
        writeSite(world, 'tienda', TIENDA_SITE);
        removeSite(world, 'blog');
        ensureNginx(world);
      },
      solution: "printf 'server {\\n    listen 80;\\n    server_name blog.devops-u.com;\\n    root /var/www/blog;\\n    index index.html;\\n}\\n' | sudo tee /etc/nginx/sites-available/blog && sudo ln -s /etc/nginx/sites-available/blog /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx",
      check: all(responds('http://blog.devops-u.com/', (r) => /Blog de N0X/.test(r.body)), responds('http://tienda.devops-u.com/', (r) => /Tienda DevOps/.test(r.body))),
      success: 'Dos dominios, dos webs, un servidor. Así funcionan los hostings.',
      reward: rewardFor(4),
    },
    {
      id: 'nginx-04-02',
      title: 'Probar sin DNS',
      difficulty: 3,
      teaches: [],
      briefing: [
        'Para probar un virtual host sin tocar el DNS, envía tú la cabecera Host:',
        '  `curl -H "Host: blog.devops-u.com" http://localhost`',
        'nginx elige el sitio por esa cabecera, no por la IP.',
      ],
      objective: 'Pide la web del blog a localhost indicando la cabecera Host.',
      hints: ['curl con -H "Host: ..."', 'curl -H "Host: blog.devops-u.com" http://localhost', 'Escribe: curl -H "Host: blog.devops-u.com" http://localhost'],
      setup: (world) => {
        rootFiles(world, { '/var/www/blog/index.html': BLOG_HTML });
        writeSite(world, 'blog', 'server {\n    listen 80;\n    server_name blog.devops-u.com;\n    root /var/www/blog;\n    index index.html;\n}\n');
        ensureNginx(world);
      },
      solution: 'curl -H "Host: blog.devops-u.com" http://localhost',
      check: outputMatches('curl', /Blog de N0X/),
      success: 'Truco imprescindible para depurar webs antes de cambiar el DNS.',
      reward: rewardFor(3),
    },
    {
      id: 'nginx-04-03',
      title: 'El servidor por defecto',
      difficulty: 4,
      teaches: [],
      briefing: [
        'Si llega un dominio que no coincide con ningún server_name, nginx usa el servidor "por defecto".',
        'Lo seguro es que ese servidor no muestre nada: `return 444;` (cierra la conexión sin responder).',
        '  server {\n      listen 80 default_server;\n      server_name _;\n      return 444;\n  }',
      ],
      objective: 'Crea el sitio "catchall" como default_server en el 80 que responda con return 444.',
      hints: [
        'Un bloque server con listen 80 default_server, server_name _ y return 444.',
        "printf 'server {\\n    listen 80 default_server;\\n    server_name _;\\n    return 444;\\n}\\n' | sudo tee /etc/nginx/sites-available/catchall",
        "Escribe: printf 'server {\\n    listen 80 default_server;\\n    server_name _;\\n    return 444;\\n}\\n' | sudo tee /etc/nginx/sites-available/catchall && sudo ln -s /etc/nginx/sites-available/catchall /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx",
      ],
      setup: (world) => {
        world.fs.privileged(() => world.fs.tryStat('/etc/nginx/sites-enabled/default', false) && world.fs.remove('/etc/nginx/sites-enabled/default'));
        removeSite(world, 'catchall');
        ensureNginx(world);
      },
      solution: "printf 'server {\\n    listen 80 default_server;\\n    server_name _;\\n    return 444;\\n}\\n' | sudo tee /etc/nginx/sites-available/catchall && sudo ln -s /etc/nginx/sites-available/catchall /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx",
      check: all(responds('http://localhost/', (r) => r.status === 444), responds('http://blog.devops-u.com/', (r) => r.status === 200)),
      success: 'Los bots que escanean IPs ya no ven ninguna de tus webs.',
      reward: rewardFor(4),
    },
  ],
};

export const nginxChapter05: Chapter = {
  id: 'nginx-05',
  number: 5,
  title: 'Locations a fondo',
  description: 'Reglas distintas para cada ruta de tu web.',
  missions: [
    {
      id: 'nginx-05-01',
      title: 'Rutas exactas',
      difficulty: 3,
      teaches: [],
      briefing: [
        '`location` aplica reglas según la URL. Tipos (por orden de prioridad):',
        '  `location = /ruta`   exacta (máxima prioridad)',
        '  `location ^~ /img/`  prefijo que gana a las regex',
        '  `location ~ \\.php$`  expresión regular (~* sin distinguir mayúsculas)',
        '  `location /docs/`    prefijo (gana el más largo)',
        'Ejemplo: `location = /salud { return 200 "OK"; }`',
      ],
      objective: 'Añade a la tienda una ruta exacta /salud que responda 200 con el texto OK.',
      hints: [
        'Dentro del server: location = /salud { return 200 "OK"; }',
        "sudo sed -i 's|index index.html;|index index.html;\\n    location = /salud {\\n        return 200 \"OK\";\\n    }|' /etc/nginx/sites-available/tienda",
        "Escribe: sudo sed -i 's|index index.html;|index index.html;\\n    location = /salud {\\n        return 200 \"OK\";\\n    }|' /etc/nginx/sites-available/tienda && sudo nginx -t && sudo systemctl reload nginx",
      ],
      setup: (world) => {
        rootFiles(world, { '/var/www/tienda/index.html': TIENDA_HTML });
        writeSite(world, 'tienda', TIENDA_SITE);
        ensureNginx(world);
      },
      solution: "sudo sed -i 's|index index.html;|index index.html;\\n    location = /salud {\\n        return 200 \"OK\";\\n    }|' /etc/nginx/sites-available/tienda && sudo nginx -t && sudo systemctl reload nginx",
      check: responds('http://tienda.devops-u.com/salud', (r) => r.status === 200 && r.body.trim() === 'OK'),
      success: 'Un "healthcheck": los balanceadores y monitores lo consultan para saber si estás vivo.',
      reward: rewardFor(3),
    },
    {
      id: 'nginx-05-02',
      title: 'Aplicación de una sola página',
      difficulty: 4,
      teaches: [],
      briefing: [
        'React, Vue o Angular generan SPAs: un solo index.html que gestiona todas las rutas en el navegador.',
        'Si alguien entra directo a /productos/42, ese archivo no existe → 404.',
        'Solución: `try_files $uri $uri/ /index.html;` → si no existe el archivo, sirve index.html.',
      ],
      objective: 'Haz que la tienda sirva index.html para cualquier ruta que no exista (try_files).',
      hints: [
        'location / { try_files $uri $uri/ /index.html; } dentro del server.',
        "sudo sed -i 's|index index.html;|index index.html;\\n    location / {\\n        try_files $uri $uri/ /index.html;\\n    }|' /etc/nginx/sites-available/tienda",
        "Escribe: sudo sed -i 's|index index.html;|index index.html;\\n    location / {\\n        try_files $uri $uri/ /index.html;\\n    }|' /etc/nginx/sites-available/tienda && sudo nginx -t && sudo systemctl reload nginx",
      ],
      setup: (world) => {
        rootFiles(world, { '/var/www/tienda/index.html': TIENDA_HTML });
        writeSite(world, 'tienda', TIENDA_SITE);
        ensureNginx(world);
      },
      solution: "sudo sed -i 's|index index.html;|index index.html;\\n    location / {\\n        try_files $uri $uri/ /index.html;\\n    }|' /etc/nginx/sites-available/tienda && sudo nginx -t && sudo systemctl reload nginx",
      check: responds('http://tienda.devops-u.com/productos/42', (r) => r.status === 200 && /Tienda DevOps/.test(r.body)),
      success: 'La configuración estándar de cualquier frontend moderno.',
      reward: rewardFor(4),
    },
    {
      id: 'nginx-05-03',
      title: 'Otra carpeta para una ruta',
      difficulty: 4,
      teaches: [],
      briefing: [
        '`alias` sirve una ruta desde otra carpeta: con `location /descargas/ { alias /srv/descargas/; }`,',
        'la URL /descargas/manual.pdf se lee de /srv/descargas/manual.pdf.',
        '(Con root se añadiría la ruta completa: /srv/descargas/descargas/manual.pdf. Error muy común.)',
      ],
      objective: 'Haz que http://tienda.devops-u.com/descargas/catalogo.txt sirva /srv/descargas/catalogo.txt.',
      hints: [
        'location /descargas/ { alias /srv/descargas/; }',
        "sudo sed -i 's|index index.html;|index index.html;\\n    location /descargas/ {\\n        alias /srv/descargas/;\\n    }|' /etc/nginx/sites-available/tienda",
        "Escribe: sudo sed -i 's|index index.html;|index index.html;\\n    location /descargas/ {\\n        alias /srv/descargas/;\\n    }|' /etc/nginx/sites-available/tienda && sudo nginx -t && sudo systemctl reload nginx",
      ],
      setup: (world) => {
        rootFiles(world, { '/var/www/tienda/index.html': TIENDA_HTML, '/srv/descargas/catalogo.txt': 'Catálogo 2024: 120 productos\n' });
        writeSite(world, 'tienda', TIENDA_SITE);
        ensureNginx(world);
      },
      solution: "sudo sed -i 's|index index.html;|index index.html;\\n    location /descargas/ {\\n        alias /srv/descargas/;\\n    }|' /etc/nginx/sites-available/tienda && sudo nginx -t && sudo systemctl reload nginx",
      check: responds('http://tienda.devops-u.com/descargas/catalogo.txt', (r) => r.status === 200 && /Catálogo 2024/.test(r.body)),
      success: 'Rutas que salen de otra carpeta sin mover archivos.',
      reward: rewardFor(4),
    },
    {
      id: 'nginx-05-04',
      title: 'JEFE: El sitio completo',
      difficulty: 5,
      boss: true,
      teaches: [],
      briefing: [
        '⚠ Configura desde cero el sitio "tienda" (sites-available/tienda, habilitado) con:',
        '  · server_name tienda.devops-u.com en el puerto 80, root /var/www/tienda',
        '  · SPA: cualquier ruta inexistente sirve index.html',
        '  · /salud responde exactamente 200 "OK"',
        '  · /descargas/ sale de /srv/descargas/',
        'Compruébalo con nginx -t, recárgalo y prueba cada ruta con curl.',
      ],
      objective: 'Sitio tienda con SPA (try_files), /salud y /descargas/ (alias), funcionando.',
      hints: [
        'Escribe el archivo completo con sudo nano /etc/nginx/sites-available/tienda.',
        'Tres bloques location dentro del server: = /salud, /descargas/ y /.',
        "Escribe: printf 'server {\\n    listen 80;\\n    server_name tienda.devops-u.com;\\n    root /var/www/tienda;\\n    index index.html;\\n    location = /salud {\\n        return 200 \"OK\";\\n    }\\n    location /descargas/ {\\n        alias /srv/descargas/;\\n    }\\n    location / {\\n        try_files $uri $uri/ /index.html;\\n    }\\n}\\n' | sudo tee /etc/nginx/sites-available/tienda && sudo nginx -t && sudo systemctl reload nginx",
      ],
      setup: (world) => {
        rootFiles(world, { '/var/www/tienda/index.html': TIENDA_HTML, '/srv/descargas/catalogo.txt': 'Catálogo 2024: 120 productos\n' });
        writeSite(world, 'tienda', TIENDA_SITE);
        ensureNginx(world);
      },
      solution: "printf 'server {\\n    listen 80;\\n    server_name tienda.devops-u.com;\\n    root /var/www/tienda;\\n    index index.html;\\n    location = /salud {\\n        return 200 \"OK\";\\n    }\\n    location /descargas/ {\\n        alias /srv/descargas/;\\n    }\\n    location / {\\n        try_files $uri $uri/ /index.html;\\n    }\\n}\\n' | sudo tee /etc/nginx/sites-available/tienda && sudo nginx -t && sudo systemctl reload nginx",
      check: all(
        responds('http://tienda.devops-u.com/salud', (r) => r.status === 200 && r.body.trim() === 'OK'),
        responds('http://tienda.devops-u.com/descargas/catalogo.txt', (r) => /Catálogo 2024/.test(r.body)),
        responds('http://tienda.devops-u.com/carrito/3', (r) => r.status === 200 && /Tienda DevOps/.test(r.body)),
      ),
      success: 'Sitio estático profesional terminado. Siguiente nivel: poner aplicaciones detrás de nginx.',
      reward: rewardFor(5, true),
    },
  ],
};
