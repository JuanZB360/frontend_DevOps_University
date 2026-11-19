/**
 * Nginx — capítulos 6 a 14: proxy inverso, balanceo, HTTPS, rendimiento,
 * seguridad, redirecciones, depuración y jefe final.
 */
import { rewardFor, type Chapter, type MissionCheck, type MissionWorld } from '../../domain/curriculum';
import { all, machine, outputEquals, packageInstalled, processMatching, ran, systemFileMatches } from '../../missions/checks';
import { withMachine } from '../../missions/worldHelpers';
import { configValid, ensureNginx, ensureNodeApp, ensurePackage, removeSite, request, responds, rootFiles, writeSite } from './helpers';

const TIENDA_HTML = '<!doctype html>\n<html>\n<head><title>Tienda DevOps</title></head>\n<body><h1>Bienvenido a la Tienda DevOps</h1><script src="/static/app.js"></script></body>\n</html>\n';

/** Sitio "api" con proxy a localhost:3000 (para los capítulos que parten de él). */
const API_SITE = 'server {\n    listen 80;\n    server_name api.devops-u.com;\n\n    location / {\n        proxy_pass http://127.0.0.1:3000;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $remote_addr;\n    }\n}\n';

function baseTienda(world: MissionWorld, site?: string): void {
  rootFiles(world, { '/var/www/tienda/index.html': TIENDA_HTML, '/var/www/tienda/static/app.js': 'console.log("tienda");\n', '/var/www/tienda/static/estilo.css': 'body { margin: 0; }\n' });
  writeSite(world, 'tienda', site ?? 'server {\n    listen 80;\n    server_name tienda.devops-u.com;\n    root /var/www/tienda;\n    index index.html;\n    location / {\n        try_files $uri $uri/ /index.html;\n    }\n}\n');
  ensureNginx(world);
}

/** Las instancias de la API (puertos) responden con su número de instancia. */
const instances = (ctx: Parameters<MissionCheck>[0], url: string, times: number): number[] =>
  Array.from({ length: times }, () => {
    const r = request(ctx, url);
    try {
      return r ? (JSON.parse(r.body) as { instancia: number }).instancia : 0;
    } catch {
      return 0;
    }
  });

export const nginxChapter06: Chapter = {
  id: 'nginx-06',
  number: 6,
  title: 'Proxy inverso',
  description: 'nginx delante de tus aplicaciones: el patrón más usado en producción.',
  missions: [
    {
      id: 'nginx-06-01',
      title: 'Una aplicación detrás',
      difficulty: 3,
      teaches: ['node'],
      briefing: [
        'Las aplicaciones (Node, Python, Java...) escuchan en puertos internos como el 3000.',
        'Hay una API en /srv/api/server.js. Instala Node.js y arráncala en segundo plano:',
        '  `node /srv/api/server.js &`   (escucha en el puerto 3000)',
        'Compruébalo con `curl localhost:3000`.',
      ],
      objective: 'Instala nodejs, arranca /srv/api/server.js en segundo plano y comprueba que responde en el 3000.',
      hints: ['apt install nodejs; después node ... &', 'sudo apt install -y nodejs && node /srv/api/server.js &', 'Escribe: sudo apt install -y nodejs && node /srv/api/server.js & curl localhost:3000'],
      setup: (world) => {
        ensureNginx(world);
        rootFiles(world, { '/srv/api/server.js': "// API de pedidos\nconst PORT = process.env.PORT || 3000;\napp.listen(PORT);\n" });
        withMachine(world, (m) => {
          m.processes = m.processes.filter((p) => !p.command.includes('/srv/api/server.js'));
        });
      },
      solution: 'sudo apt install -y nodejs && node /srv/api/server.js & curl localhost:3000',
      check: all(packageInstalled('nodejs'), processMatching(/\/srv\/api\/server\.js/), responds('http://127.0.0.1:3000/', (r) => r.status === 200)),
      success: 'La API responde en el 3000. Pero no queremos exponer ese puerto a Internet...',
      reward: rewardFor(3),
    },
    {
      id: 'nginx-06-02',
      title: 'proxy_pass',
      difficulty: 4,
      teaches: [],
      briefing: [
        'nginx recibe en el 80 y REENVÍA a la aplicación: eso es un proxy inverso.',
        '  location / {',
        '      proxy_pass http://127.0.0.1:3000;',
        '  }',
        'Ventajas: un solo punto de entrada, HTTPS centralizado, caché, balanceo, y la app no se expone.',
      ],
      objective: 'Crea el sitio "api" (api.devops-u.com, puerto 80) que haga proxy_pass a http://127.0.0.1:3000.',
      hints: [
        'Un server con server_name api.devops-u.com y una location / con proxy_pass.',
        "printf 'server {\\n    listen 80;\\n    server_name api.devops-u.com;\\n    location / {\\n        proxy_pass http://127.0.0.1:3000;\\n    }\\n}\\n' | sudo tee /etc/nginx/sites-available/api",
        "Escribe: printf 'server {\\n    listen 80;\\n    server_name api.devops-u.com;\\n    location / {\\n        proxy_pass http://127.0.0.1:3000;\\n    }\\n}\\n' | sudo tee /etc/nginx/sites-available/api && sudo ln -s /etc/nginx/sites-available/api /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx",
      ],
      setup: (world) => {
        removeSite(world, 'api');
        ensureNodeApp(world, '/srv/api/server.js', 3000);
        ensureNginx(world);
      },
      solution: "printf 'server {\\n    listen 80;\\n    server_name api.devops-u.com;\\n    location / {\\n        proxy_pass http://127.0.0.1:3000;\\n    }\\n}\\n' | sudo tee /etc/nginx/sites-available/api && sudo ln -s /etc/nginx/sites-available/api /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx",
      check: responds('http://api.devops-u.com/pedidos', (r) => r.status === 200 && /"instancia":3000/.test(r.body)),
      success: 'curl http://api.devops-u.com/pedidos → nginx → app en el 3000. Proxy inverso funcionando.',
      reward: rewardFor(4),
    },
    {
      id: 'nginx-06-03',
      title: 'Cabeceras del proxy',
      difficulty: 4,
      teaches: [],
      briefing: [
        'Detrás del proxy, la app cree que TODAS las peticiones vienen de 127.0.0.1 y pierde el dominio original.',
        'Se le pasan con cabeceras:',
        '  `proxy_set_header Host $host;`',
        '  `proxy_set_header X-Real-IP $remote_addr;`',
        '  `proxy_set_header X-Forwarded-For $remote_addr;`',
      ],
      objective: 'Añade al sitio api las cabeceras Host, X-Real-IP y X-Forwarded-For.',
      hints: [
        'Tres líneas proxy_set_header dentro de la location.',
        "sudo sed -i 's|proxy_pass http://127.0.0.1:3000;|proxy_pass http://127.0.0.1:3000;\\n        proxy_set_header Host $host;\\n        proxy_set_header X-Real-IP $remote_addr;\\n        proxy_set_header X-Forwarded-For $remote_addr;|' /etc/nginx/sites-available/api",
        "Escribe: sudo sed -i 's|proxy_pass http://127.0.0.1:3000;|proxy_pass http://127.0.0.1:3000;\\n        proxy_set_header Host $host;\\n        proxy_set_header X-Real-IP $remote_addr;\\n        proxy_set_header X-Forwarded-For $remote_addr;|' /etc/nginx/sites-available/api && sudo nginx -t && sudo systemctl reload nginx",
      ],
      setup: (world) => {
        ensureNodeApp(world, '/srv/api/server.js', 3000);
        writeSite(world, 'api', 'server {\n    listen 80;\n    server_name api.devops-u.com;\n    location / {\n        proxy_pass http://127.0.0.1:3000;\n    }\n}\n');
        ensureNginx(world);
      },
      solution: "sudo sed -i 's|proxy_pass http://127.0.0.1:3000;|proxy_pass http://127.0.0.1:3000;\\n        proxy_set_header Host $host;\\n        proxy_set_header X-Real-IP $remote_addr;\\n        proxy_set_header X-Forwarded-For $remote_addr;|' /etc/nginx/sites-available/api && sudo nginx -t && sudo systemctl reload nginx",
      check: all(
        systemFileMatches('/etc/nginx/sites-available/api', /proxy_set_header\s+Host\s+\$host/),
        systemFileMatches('/etc/nginx/sites-available/api', /proxy_set_header\s+X-Real-IP\s+\$remote_addr/),
        systemFileMatches('/etc/nginx/sites-available/api', /proxy_set_header\s+X-Forwarded-For/),
        responds('http://api.devops-u.com/', (r) => /"cliente":"127\.0\.0\.1"/.test(r.body)),
      ),
      success: 'La app ya sabe quién es el cliente real. Imprescindible para logs, límites y seguridad.',
      reward: rewardFor(4),
    },
    {
      id: 'nginx-06-04',
      title: 'Frontend y API juntos',
      difficulty: 5,
      teaches: [],
      briefing: [
        'Un patrón muy común: el mismo dominio sirve el frontend estático y, bajo /api/, la aplicación.',
        '  location /api/ { proxy_pass http://127.0.0.1:3000; }',
        '  location / { try_files $uri $uri/ /index.html; }',
        'Así el navegador no necesita CORS: todo sale del mismo dominio.',
      ],
      objective: 'En el sitio tienda, haz que /api/ vaya a la app del puerto 3000 y el resto siga sirviendo la SPA.',
      hints: [
        'Añade una location /api/ con proxy_pass antes de location /.',
        "sudo sed -i 's|    location / {|    location /api/ {\\n        proxy_pass http://127.0.0.1:3000;\\n    }\\n    location / {|' /etc/nginx/sites-available/tienda",
        "Escribe: sudo sed -i 's|    location / {|    location /api/ {\\n        proxy_pass http://127.0.0.1:3000;\\n    }\\n    location / {|' /etc/nginx/sites-available/tienda && sudo nginx -t && sudo systemctl reload nginx",
      ],
      setup: (world) => {
        ensureNodeApp(world, '/srv/api/server.js', 3000);
        baseTienda(world);
      },
      solution: "sudo sed -i 's|    location / {|    location /api/ {\\n        proxy_pass http://127.0.0.1:3000;\\n    }\\n    location / {|' /etc/nginx/sites-available/tienda && sudo nginx -t && sudo systemctl reload nginx",
      check: all(responds('http://tienda.devops-u.com/api/pedidos', (r) => /"instancia":3000/.test(r.body)), responds('http://tienda.devops-u.com/catalogo', (r) => /Tienda DevOps/.test(r.body))),
      success: 'Frontend + API bajo un mismo dominio. Arquitectura clásica de cualquier startup.',
      reward: rewardFor(5),
    },
  ],
};

export const nginxChapter07: Chapter = {
  id: 'nginx-07',
  number: 7,
  title: 'Proxy directo vs inverso',
  description: 'Dos conceptos que se confunden siempre. Tú no.',
  missions: [
    {
      id: 'nginx-07-01',
      title: '¿Quién protege a quién?',
      difficulty: 2,
      teaches: [],
      briefing: [
        'PROXY DIRECTO (forward): está del lado del CLIENTE. Los empleados de una empresa salen a Internet a través de él',
        '  (filtra webs, cachea, oculta quién navega). El servidor de destino ve la IP del proxy, no la del empleado.',
        'PROXY INVERSO (reverse): está del lado del SERVIDOR. Los usuarios de Internet entran por él a tus aplicaciones',
        '  (balancea, termina HTTPS, oculta tus servidores). Es lo que acabas de montar con nginx.',
      ],
      objective: 'Responde con echo: ¿qué tipo de proxy es nginx delante de tu API? (directo o inverso)',
      hints: ['Está del lado del servidor, protegiendo tus apps.', 'Es un proxy inverso.', 'Escribe: echo inverso'],
      solution: 'echo inverso',
      check: (ctx) => ctx.report.commands.some((c) => c.name === 'echo' && /^inverso$/i.test(c.stdout.trim())),
      success: 'Exacto. Squid es el ejemplo clásico de proxy directo; nginx, HAProxy o Traefik, de inverso.',
      reward: rewardFor(2),
    },
    {
      id: 'nginx-07-02',
      title: 'La IP del cliente real',
      difficulty: 3,
      teaches: [],
      briefing: [
        'Por pasar por un proxy, la conexión que recibe tu app viene del proxy.',
        'La cabecera X-Forwarded-For lleva la cadena de IPs originales: "cliente, proxy1, proxy2".',
        'Comprueba qué IP de cliente recibe la API a través de nginx (el campo "cliente" de su respuesta).',
      ],
      objective: 'Haz una petición a http://api.devops-u.com y escribe con echo la IP del campo "cliente".',
      hints: ['curl -s http://api.devops-u.com y mira el JSON.', 'La petición sale de este mismo servidor.', 'Escribe: echo 127.0.0.1'],
      setup: (world) => {
        ensureNodeApp(world, '/srv/api/server.js', 3000);
        writeSite(world, 'api', API_SITE);
        ensureNginx(world);
      },
      solution: 'curl -s http://api.devops-u.com; echo 127.0.0.1',
      check: outputEquals('echo', '127.0.0.1'),
      success: 'Sin esas cabeceras, la app solo vería la IP de nginx y no podría saber quién es cada cliente.',
      reward: rewardFor(3),
    },
  ],
};

const UPSTREAM_SITE = (method = '') => `upstream api_cluster {\n${method}    server 127.0.0.1:3001;\n    server 127.0.0.1:3002;\n    server 127.0.0.1:3003;\n}\n\nserver {\n    listen 80;\n    server_name api.devops-u.com;\n\n    location / {\n        proxy_pass http://api_cluster;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n    }\n}\n`;

function threeInstances(world: MissionWorld): void {
  for (const port of [3001, 3002, 3003]) ensureNodeApp(world, '/srv/api/server.js', port);
}

export const nginxChapter08: Chapter = {
  id: 'nginx-08',
  number: 8,
  title: 'Balanceo de carga',
  description: 'Una sola aplicación no aguanta todo el tráfico. Varias, sí.',
  missions: [
    {
      id: 'nginx-08-01',
      title: 'Tres instancias',
      difficulty: 3,
      teaches: [],
      briefing: [
        'Para escalar, se arrancan varias copias de la app en distintos puertos.',
        'Arranca la API en los puertos 3001, 3002 y 3003 (la variable PORT elige el puerto):',
        '  `PORT=3001 node /srv/api/server.js &`',
      ],
      objective: 'Arranca la API en los puertos 3001, 3002 y 3003.',
      hints: ['Tres comandos con PORT distinto y & al final.', 'PORT=3001 node /srv/api/server.js & PORT=3002 ...', 'Escribe: PORT=3001 node /srv/api/server.js & PORT=3002 node /srv/api/server.js & PORT=3003 node /srv/api/server.js &'],
      setup: (world) => {
        ensureNodeApp(world, '/srv/api/server.js', 3000);
        withMachine(world, (m) => {
          m.processes = m.processes.filter((p) => !p.ports?.some((x) => x >= 3001 && x <= 3003));
        });
      },
      solution: 'PORT=3001 node /srv/api/server.js & PORT=3002 node /srv/api/server.js & PORT=3003 node /srv/api/server.js &',
      check: machine((m) => [3001, 3002, 3003].every((port) => m.processes.some((p) => p.ports?.includes(port)))),
      success: 'Tres instancias listas. Ahora nginx debe repartir el trabajo.',
      reward: rewardFor(3),
    },
    {
      id: 'nginx-08-02',
      title: 'upstream',
      difficulty: 4,
      teaches: [],
      briefing: [
        'Un bloque upstream agrupa servidores; proxy_pass apunta al grupo:',
        '  upstream api_cluster {',
        '      server 127.0.0.1:3001;',
        '      server 127.0.0.1:3002;',
        '      server 127.0.0.1:3003;',
        '  }',
        '  ... proxy_pass http://api_cluster;',
        'Por defecto reparte por turnos (round robin).',
      ],
      objective: 'Configura el sitio api para balancear entre las tres instancias con un upstream llamado api_cluster.',
      hints: [
        'El upstream va FUERA del server (en el mismo archivo).',
        'Reescribe /etc/nginx/sites-available/api con el upstream y proxy_pass http://api_cluster;',
        "Escribe: printf 'upstream api_cluster {\\n    server 127.0.0.1:3001;\\n    server 127.0.0.1:3002;\\n    server 127.0.0.1:3003;\\n}\\nserver {\\n    listen 80;\\n    server_name api.devops-u.com;\\n    location / {\\n        proxy_pass http://api_cluster;\\n    }\\n}\\n' | sudo tee /etc/nginx/sites-available/api && sudo nginx -t && sudo systemctl reload nginx",
      ],
      setup: (world) => {
        threeInstances(world);
        writeSite(world, 'api', API_SITE);
        ensureNginx(world);
      },
      solution: "printf 'upstream api_cluster {\\n    server 127.0.0.1:3001;\\n    server 127.0.0.1:3002;\\n    server 127.0.0.1:3003;\\n}\\nserver {\\n    listen 80;\\n    server_name api.devops-u.com;\\n    location / {\\n        proxy_pass http://api_cluster;\\n    }\\n}\\n' | sudo tee /etc/nginx/sites-available/api && sudo nginx -t && sudo systemctl reload nginx",
      check: (ctx) => new Set(instances(ctx, 'http://api.devops-u.com/', 6)).size === 3,
      success: 'Haz varias peticiones: for i in 1 2 3 4 5 6; do curl -s api.devops-u.com; done  → verás 3001, 3002, 3003...',
      reward: rewardFor(4),
    },
    {
      id: 'nginx-08-03',
      title: 'Ver el reparto',
      difficulty: 3,
      teaches: [],
      briefing: [
        'Compruébalo tú: un bucle de peticiones y fíjate en el campo "instancia".',
        '  `for i in $(seq 1 6); do curl -s http://api.devops-u.com; done`',
      ],
      objective: 'Haz 6 peticiones seguidas a la API con un bucle y observa el reparto.',
      hints: ['Un for con seq y curl.', 'for i in $(seq 1 6); do curl -s http://api.devops-u.com; done', 'Escribe: for i in $(seq 1 6); do curl -s http://api.devops-u.com; done'],
      setup: (world) => {
        threeInstances(world);
        writeSite(world, 'api', UPSTREAM_SITE());
        ensureNginx(world);
      },
      solution: 'for i in $(seq 1 6); do curl -s http://api.devops-u.com; done',
      check: (ctx) => ctx.report.commands.filter((c) => c.name === 'curl' && /"instancia":300[123]/.test(c.stdout)).length >= 3,
      success: '3001, 3002, 3003, 3001... El round robin en acción.',
      reward: rewardFor(3),
    },
    {
      id: 'nginx-08-04',
      title: 'Una instancia cae',
      difficulty: 4,
      teaches: [],
      briefing: [
        'Si una instancia muere, nginx detecta el fallo de conexión y reintenta en otra: el usuario no lo nota.',
        'Mata la instancia del 3002 y comprueba que la API sigue respondiendo (solo con 3001 y 3003).',
      ],
      objective: 'Detén la instancia del puerto 3002 y comprueba con curl que la API sigue funcionando.',
      hints: ['Busca su PID con sudo lsof -i :3002 o ps.', "kill $(sudo lsof -i :3002 | awk 'NR > 1 {print $2}')", "Escribe: sudo kill $(sudo lsof -i :3002 | awk 'NR > 1 {print $2}') && curl -s http://api.devops-u.com"],
      setup: (world) => {
        threeInstances(world);
        writeSite(world, 'api', UPSTREAM_SITE());
        ensureNginx(world);
      },
      solution: "sudo kill $(sudo lsof -i :3002 | awk 'NR > 1 {print $2}') && curl -s http://api.devops-u.com",
      check: all(machine((m) => !m.processes.some((p) => p.ports?.includes(3002))), (ctx) => instances(ctx, 'http://api.devops-u.com/', 4).every((i) => i === 3001 || i === 3003)),
      success: 'Cero errores para los usuarios. Esto es alta disponibilidad.',
      reward: rewardFor(4),
    },
    {
      id: 'nginx-08-05',
      title: 'Estrategias de reparto',
      difficulty: 4,
      teaches: [],
      briefing: [
        'Además del turno rotatorio, upstream admite:',
        '  `least_conn;`       → envía al servidor con menos conexiones activas',
        '  `ip_hash;`          → cada cliente siempre al mismo servidor (sesiones)',
        '  `server ... weight=3;`  → recibe el triple de tráfico   `server ... backup;` → solo si caen los demás',
      ],
      objective: 'Haz que api_cluster use la estrategia least_conn.',
      hints: ['Añade least_conn; como primera línea dentro de upstream.', "sudo sed -i 's|upstream api_cluster {|upstream api_cluster {\\n    least_conn;|' /etc/nginx/sites-available/api", "Escribe: sudo sed -i 's|upstream api_cluster {|upstream api_cluster {\\n    least_conn;|' /etc/nginx/sites-available/api && sudo nginx -t && sudo systemctl reload nginx"],
      setup: (world) => {
        threeInstances(world);
        writeSite(world, 'api', UPSTREAM_SITE());
        ensureNginx(world);
      },
      solution: "sudo sed -i 's|upstream api_cluster {|upstream api_cluster {\\n    least_conn;|' /etc/nginx/sites-available/api && sudo nginx -t && sudo systemctl reload nginx",
      check: all(systemFileMatches('/etc/nginx/sites-available/api', /upstream api_cluster \{\s*least_conn;/), configValid, machine((m) => /least_conn/.test(Object.values(m.nginxFiles ?? {}).join('\n')))),
      success: 'least_conn es ideal cuando algunas peticiones tardan mucho más que otras.',
      reward: rewardFor(4),
    },
  ],
};

export const nginxChapter09: Chapter = {
  id: 'nginx-09',
  number: 9,
  title: "HTTPS con Let's Encrypt",
  description: 'El candado verde, gratis y renovado automáticamente.',
  missions: [
    {
      id: 'nginx-09-01',
      title: 'Instalar certbot',
      difficulty: 2,
      teaches: ['certbot'],
      briefing: [
        "Let's Encrypt emite certificados HTTPS gratuitos. Su cliente oficial es certbot.",
        'Con el plugin de nginx, certbot obtiene el certificado Y configura nginx por ti.',
      ],
      objective: 'Instala certbot y su plugin para nginx (python3-certbot-nginx).',
      hints: ['Dos paquetes con apt.', 'sudo apt install -y certbot python3-certbot-nginx', 'Escribe: sudo apt install -y certbot python3-certbot-nginx'],
      setup: (world) => {
        baseTienda(world);
        ensurePackage(world, 'curl');
      },
      solution: 'sudo apt install -y certbot python3-certbot-nginx',
      check: all(packageInstalled('certbot'), packageInstalled('python3-certbot-nginx')),
      success: 'Listo para pedir certificados.',
      reward: rewardFor(2),
    },
    {
      id: 'nginx-09-02',
      title: 'El candado',
      difficulty: 4,
      teaches: [],
      briefing: [
        'Requisitos: el dominio debe apuntar a tu servidor (DNS) y el puerto 80 debe estar accesible (ufw).',
        '`sudo certbot --nginx -d tienda.devops-u.com`',
        'certbot verifica que controlas el dominio, guarda el certificado en /etc/letsencrypt/live/ y añade',
        'a tu sitio `listen 443 ssl` y una redirección de HTTP a HTTPS.',
      ],
      objective: 'Obtén un certificado para tienda.devops-u.com y activa HTTPS con redirección.',
      hints: [
        'certbot --nginx -d DOMINIO. En scripts: --non-interactive --agree-tos -m tu@correo',
        "Si falla por el cortafuegos: sudo ufw allow 'Nginx Full'",
        'Escribe: sudo certbot --nginx -d tienda.devops-u.com --non-interactive --agree-tos -m admin@devops-u.com',
      ],
      setup: (world) => {
        ensurePackage(world, 'certbot');
        ensurePackage(world, 'python3-certbot-nginx');
        baseTienda(world);
        withMachine(world, (m) => {
          if (m.firewall.ufwEnabled && !m.firewall.rules.some((r) => r.to === 'Nginx Full')) m.firewall.rules.push({ action: 'allow', to: 'Nginx Full', from: 'Anywhere', direction: 'in' });
        });
      },
      solution: 'sudo certbot --nginx -d tienda.devops-u.com --non-interactive --agree-tos -m admin@devops-u.com',
      check: all(responds('https://tienda.devops-u.com/', (r) => r.status === 200 && /Tienda DevOps/.test(r.body)), responds('http://tienda.devops-u.com/', (r) => r.status === 301 && (r.headers.location ?? '').startsWith('https://'))),
      success: 'https://tienda.devops-u.com funcionando y HTTP redirige a HTTPS. Mira el archivo del sitio: certbot lo ha modificado.',
      reward: rewardFor(4),
    },
    {
      id: 'nginx-09-03',
      title: 'Renovación automática',
      difficulty: 3,
      teaches: [],
      briefing: [
        "Los certificados de Let's Encrypt duran 90 días. certbot instala una tarea que los renueva sola.",
        '`sudo certbot certificates` lista tus certificados y su caducidad.',
        '`sudo certbot renew --dry-run` simula la renovación: si funciona, puedes dormir tranquilo.',
      ],
      objective: 'Simula la renovación de los certificados.',
      hints: ['certbot renew con --dry-run.', 'sudo certbot renew --dry-run', 'Escribe: sudo certbot renew --dry-run'],
      setup: (world) => {
        ensurePackage(world, 'certbot');
        ensurePackage(world, 'python3-certbot-nginx');
      },
      solution: 'sudo certbot renew --dry-run',
      check: ran('certbot', (args) => args.includes('renew') && args.includes('--dry-run')),
      success: 'Renovación verificada. Un certificado caducado tumba una web igual que un servidor caído.',
      reward: rewardFor(3),
    },
  ],
};

export const nginxChapter10: Chapter = {
  id: 'nginx-10',
  number: 10,
  title: 'Rendimiento y caché',
  description: 'Menos bytes y menos peticiones: webs que vuelan.',
  missions: [
    {
      id: 'nginx-10-01',
      title: 'Compresión',
      difficulty: 3,
      teaches: [],
      briefing: [
        'gzip comprime HTML, CSS y JS antes de enviarlos (¡hasta un 80 % menos!).',
        'En nginx.conf: `gzip on;` y `gzip_types text/css application/javascript application/json;`',
        'Pruébalo pidiendo la compresión: `curl -I -H "Accept-Encoding: gzip" URL` → Content-Encoding: gzip',
      ],
      objective: 'Haz que nginx comprima también CSS y JavaScript (gzip_types) y compruébalo con /static/app.js.',
      hints: [
        'Añade gzip_types debajo de gzip on; en /etc/nginx/nginx.conf.',
        "sudo sed -i 's|gzip on;|gzip on;\\n\\tgzip_types text/css application/javascript application/json;|' /etc/nginx/nginx.conf",
        "Escribe: sudo sed -i 's|gzip on;|gzip on;\\n\\tgzip_types text/css application/javascript application/json;|' /etc/nginx/nginx.conf && sudo nginx -t && sudo systemctl reload nginx && curl -I -H 'Accept-Encoding: gzip' http://tienda.devops-u.com/static/app.js",
      ],
      setup: (world) => {
        baseTienda(world, 'server {\n    listen 80;\n    server_name tienda.devops-u.com;\n    root /var/www/tienda;\n    index index.html;\n}\n');
        world.fs.privileged(() => world.fs.writeFile('/etc/nginx/nginx.conf', world.fs.readFile('/etc/nginx/nginx.conf').replace(/\n\tgzip_types[^\n]*/g, '')));
        ensureNginx(world);
      },
      solution: "sudo sed -i 's|gzip on;|gzip on;\\n\\tgzip_types text/css application/javascript application/json;|' /etc/nginx/nginx.conf && sudo nginx -t && sudo systemctl reload nginx && curl -I -H 'Accept-Encoding: gzip' http://tienda.devops-u.com/static/app.js",
      check: responds('http://tienda.devops-u.com/static/app.js', (r) => r.headers['content-encoding'] === 'gzip', { 'accept-encoding': 'gzip' }),
      success: 'JavaScript comprimido. La web carga notablemente más rápido en móviles.',
      reward: rewardFor(3),
    },
    {
      id: 'nginx-10-02',
      title: 'Caché del navegador',
      difficulty: 4,
      teaches: [],
      briefing: [
        'Los archivos estáticos cambian poco: dile al navegador que los guarde.',
        '  location /static/ {',
        '      expires 30d;',
        '  }',
        'nginx añade Expires y Cache-Control: max-age=2592000. El navegador ni siquiera vuelve a pedirlos.',
      ],
      objective: 'Haz que /static/ de la tienda se cachee 30 días en el navegador.',
      hints: [
        'Una location /static/ con expires 30d; dentro del server de la tienda.',
        "sudo sed -i 's|index index.html;|index index.html;\\n    location /static/ {\\n        expires 30d;\\n    }|' /etc/nginx/sites-available/tienda",
        "Escribe: sudo sed -i 's|index index.html;|index index.html;\\n    location /static/ {\\n        expires 30d;\\n    }|' /etc/nginx/sites-available/tienda && sudo nginx -t && sudo systemctl reload nginx",
      ],
      setup: (world) => baseTienda(world, 'server {\n    listen 80;\n    server_name tienda.devops-u.com;\n    root /var/www/tienda;\n    index index.html;\n}\n'),
      solution: "sudo sed -i 's|index index.html;|index index.html;\\n    location /static/ {\\n        expires 30d;\\n    }|' /etc/nginx/sites-available/tienda && sudo nginx -t && sudo systemctl reload nginx",
      check: responds('http://tienda.devops-u.com/static/estilo.css', (r) => r.headers['cache-control'] === 'max-age=2592000'),
      success: 'Visitas repetidas sin descargar de nuevo CSS ni JS. Truco: pon un hash en el nombre (app.3f9a.js) al publicar versiones nuevas.',
      reward: rewardFor(4),
    },
  ],
};

export const nginxChapter11: Chapter = {
  id: 'nginx-11',
  number: 11,
  title: 'Seguridad y rate limiting',
  description: 'Ocultar información, limitar abusos y proteger zonas privadas.',
  missions: [
    {
      id: 'nginx-11-01',
      title: 'Discreción',
      difficulty: 2,
      teaches: [],
      briefing: [
        'Por defecto nginx anuncia su versión exacta en cada respuesta (Server: nginx/1.24.0) y en las páginas de error.',
        'Eso ayuda a los atacantes a buscar vulnerabilidades. En nginx.conf: `server_tokens off;`',
      ],
      objective: 'Oculta la versión de nginx activando server_tokens off.',
      hints: ['En nginx.conf hay una línea comentada: # server_tokens off;', "sudo sed -i 's|# server_tokens off;|server_tokens off;|' /etc/nginx/nginx.conf", "Escribe: sudo sed -i 's|# server_tokens off;|server_tokens off;|' /etc/nginx/nginx.conf && sudo nginx -t && sudo systemctl reload nginx"],
      setup: (world) => {
        baseTienda(world);
        world.fs.privileged(() => world.fs.writeFile('/etc/nginx/nginx.conf', world.fs.readFile('/etc/nginx/nginx.conf').replace(/^(\s*)server_tokens off;/m, '$1# server_tokens off;')));
        ensureNginx(world);
      },
      solution: "sudo sed -i 's|# server_tokens off;|server_tokens off;|' /etc/nginx/nginx.conf && sudo nginx -t && sudo systemctl reload nginx",
      check: responds('http://tienda.devops-u.com/', (r) => r.headers.server === 'nginx'),
      success: 'Server: nginx (sin versión). Un dato menos para los escáneres automáticos.',
      reward: rewardFor(2),
    },
    {
      id: 'nginx-11-02',
      title: 'Zona privada',
      difficulty: 4,
      teaches: ['htpasswd'],
      briefing: [
        'Protege /admin/ con usuario y contraseña (autenticación básica):',
        '  1) `sudo apt install apache2-utils` y `sudo htpasswd -c /etc/nginx/.htpasswd admin`',
        '  2) en la location:  auth_basic "Zona privada";  auth_basic_user_file /etc/nginx/.htpasswd;',
        'Prueba: `curl -u admin:CLAVE http://...`',
      ],
      objective: 'Protege /admin/ de la tienda con el usuario admin (contraseña S3gura!) usando auth_basic.',
      hints: [
        'htpasswd -cb crea el archivo sin preguntar; después añade la location con auth_basic.',
        "sudo htpasswd -cb /etc/nginx/.htpasswd admin 'S3gura!'",
        "Escribe: sudo apt install -y apache2-utils && sudo htpasswd -cb /etc/nginx/.htpasswd admin 'S3gura!' && sudo sed -i 's|index index.html;|index index.html;\\n    location /admin/ {\\n        auth_basic \"Zona privada\";\\n        auth_basic_user_file /etc/nginx/.htpasswd;\\n    }|' /etc/nginx/sites-available/tienda && sudo nginx -t && sudo systemctl reload nginx",
      ],
      setup: (world) => {
        baseTienda(world, 'server {\n    listen 80;\n    server_name tienda.devops-u.com;\n    root /var/www/tienda;\n    index index.html;\n}\n');
        rootFiles(world, { '/var/www/tienda/admin/index.html': '<h1>Panel de administración</h1>\n' });
      },
      solution: "sudo apt install -y apache2-utils && sudo htpasswd -cb /etc/nginx/.htpasswd admin 'S3gura!' && sudo sed -i 's|index index.html;|index index.html;\\n    location /admin/ {\\n        auth_basic \"Zona privada\";\\n        auth_basic_user_file /etc/nginx/.htpasswd;\\n    }|' /etc/nginx/sites-available/tienda && sudo nginx -t && sudo systemctl reload nginx",
      check: all(
        responds('http://tienda.devops-u.com/admin/', (r) => r.status === 401),
        responds('http://tienda.devops-u.com/admin/', (r) => r.status === 200 && /Panel/.test(r.body), { authorization: `Basic ${btoa('admin:S3gura!')}` }),
      ),
      success: 'Sin credenciales: 401. Con ellas: dentro. (Siempre sobre HTTPS: la autenticación básica viaja en claro.)',
      reward: rewardFor(4),
    },
    {
      id: 'nginx-11-03',
      title: 'Frenar abusos',
      difficulty: 5,
      teaches: [],
      briefing: [
        'Un bot hace cientos de peticiones por segundo al login. Limítalo:',
        '  en http (nginx.conf o conf.d):  `limit_req_zone $binary_remote_addr zone=login:10m rate=5r/s;`',
        '  en la location:                  `limit_req zone=login burst=5;`',
        'Lo que exceda recibe 503 (o el código que pongas con limit_req_status 429;).',
      ],
      objective: 'Limita /login de la tienda a 5 peticiones por segundo por IP (burst 5) devolviendo 429.',
      hints: [
        'La zona en /etc/nginx/conf.d/limites.conf; la location /login con limit_req y limit_req_status 429.',
        "echo 'limit_req_zone $binary_remote_addr zone=login:10m rate=5r/s;' | sudo tee /etc/nginx/conf.d/limites.conf",
        "Escribe: echo 'limit_req_zone $binary_remote_addr zone=login:10m rate=5r/s;' | sudo tee /etc/nginx/conf.d/limites.conf && sudo sed -i 's|index index.html;|index index.html;\\n    location /login {\\n        limit_req zone=login burst=5;\\n        limit_req_status 429;\\n        try_files $uri /index.html;\\n    }|' /etc/nginx/sites-available/tienda && sudo nginx -t && sudo systemctl reload nginx",
      ],
      setup: (world) => {
        baseTienda(world, 'server {\n    listen 80;\n    server_name tienda.devops-u.com;\n    root /var/www/tienda;\n    index index.html;\n}\n');
        removeSite(world, 'limites');
        ensureNginx(world);
      },
      solution: "echo 'limit_req_zone $binary_remote_addr zone=login:10m rate=5r/s;' | sudo tee /etc/nginx/conf.d/limites.conf && sudo sed -i 's|index index.html;|index index.html;\\n    location /login {\\n        limit_req zone=login burst=5;\\n        limit_req_status 429;\\n        try_files $uri /index.html;\\n    }|' /etc/nginx/sites-available/tienda && sudo nginx -t && sudo systemctl reload nginx",
      check: all(
        machine((m) => /limit_req_zone[^;]*zone=login:[^;]*rate=5r\/s/.test(Object.values(m.nginxFiles ?? {}).join('\n'))),
        machine((m) => /location \/login[\s\S]*limit_req zone=login/.test(Object.values(m.nginxFiles ?? {}).join('\n'))),
      ),
      success: 'Pruébalo: for i in $(seq 1 20); do curl -s -o /dev/null -w "%{http_code} " http://tienda.devops-u.com/login; done → verás 429.',
      reward: rewardFor(5),
    },
  ],
};

export const nginxChapter12: Chapter = {
  id: 'nginx-12',
  number: 12,
  title: 'Rewrites y redirecciones',
  description: 'Cambiar URLs sin romper enlaces ni perder posicionamiento.',
  missions: [
    {
      id: 'nginx-12-01',
      title: 'Sin www',
      difficulty: 3,
      teaches: [],
      briefing: [
        'Una web debe tener UNA dirección canónica. Redirige www.tienda.devops-u.com → tienda.devops-u.com:',
        '  server {',
        '      listen 80;',
        '      server_name www.tienda.devops-u.com;',
        '      return 301 http://tienda.devops-u.com$request_uri;',
        '  }',
        '301 = "movido para siempre": los buscadores actualizan el enlace.',
      ],
      objective: 'Crea el sitio "www-tienda" que redirija www.tienda.devops-u.com a tienda.devops-u.com con 301 (conservando la ruta).',
      hints: [
        'Un server aparte con return 301 y $request_uri.',
        "printf 'server {\\n    listen 80;\\n    server_name www.tienda.devops-u.com;\\n    return 301 http://tienda.devops-u.com$request_uri;\\n}\\n' | sudo tee /etc/nginx/sites-available/www-tienda",
        "Escribe: printf 'server {\\n    listen 80;\\n    server_name www.tienda.devops-u.com;\\n    return 301 http://tienda.devops-u.com$request_uri;\\n}\\n' | sudo tee /etc/nginx/sites-available/www-tienda && sudo ln -s /etc/nginx/sites-available/www-tienda /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx",
      ],
      setup: (world) => {
        removeSite(world, 'www-tienda');
        baseTienda(world);
      },
      solution: "printf 'server {\\n    listen 80;\\n    server_name www.tienda.devops-u.com;\\n    return 301 http://tienda.devops-u.com$request_uri;\\n}\\n' | sudo tee /etc/nginx/sites-available/www-tienda && sudo ln -s /etc/nginx/sites-available/www-tienda /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx",
      check: responds('http://www.tienda.devops-u.com/ofertas?x=1', (r) => r.status === 301 && r.headers.location === 'http://tienda.devops-u.com/ofertas?x=1'),
      success: 'Una sola URL canónica, sin enlaces rotos.',
      reward: rewardFor(3),
    },
    {
      id: 'nginx-12-02',
      title: 'URLs antiguas',
      difficulty: 4,
      teaches: [],
      briefing: [
        'La web antigua usaba /producto.php?id=7 y la nueva /productos/... Otro caso: /blog/2019/post → /articulos/post.',
        '`rewrite REGEX REEMPLAZO permanent;` redirige con 301 usando grupos de la expresión regular:',
        '  `rewrite ^/blog/(\\d+)/(.*)$ /articulos/$2 permanent;`',
      ],
      objective: 'En la tienda, redirige /blog/AÑO/NOMBRE a /articulos/NOMBRE con 301.',
      hints: [
        'Una línea rewrite dentro del server.',
        "sudo sed -i 's|index index.html;|index index.html;\\n    rewrite ^/blog/([0-9]+)/(.*)$ /articulos/$2 permanent;|' /etc/nginx/sites-available/tienda",
        "Escribe: sudo sed -i 's|index index.html;|index index.html;\\n    rewrite ^/blog/([0-9]+)/(.*)$ /articulos/$2 permanent;|' /etc/nginx/sites-available/tienda && sudo nginx -t && sudo systemctl reload nginx",
      ],
      setup: (world) => baseTienda(world),
      solution: "sudo sed -i 's|index index.html;|index index.html;\\n    rewrite ^/blog/([0-9]+)/(.*)$ /articulos/$2 permanent;|' /etc/nginx/sites-available/tienda && sudo nginx -t && sudo systemctl reload nginx",
      check: responds('http://tienda.devops-u.com/blog/2019/mi-primer-post', (r) => r.status === 301 && /\/articulos\/mi-primer-post$/.test(r.headers.location ?? '')),
      success: 'Enlaces antiguos redirigidos: ni usuarios perdidos ni posicionamiento perdido.',
      reward: rewardFor(4),
    },
  ],
};

export const nginxChapter13: Chapter = {
  id: 'nginx-13',
  number: 13,
  title: 'Logs y depuración',
  description: '502, 403, 404: cada error tiene una causa y un log que la cuenta.',
  missions: [
    {
      id: 'nginx-13-01',
      title: 'Leer el access.log',
      difficulty: 3,
      teaches: [],
      briefing: [
        '/var/log/nginx/access.log tiene una línea por petición: IP, fecha, "MÉTODO RUTA", código, tamaño y navegador.',
        'Con awk y sort obtienes estadísticas al momento. El código es la columna 9.',
      ],
      objective: 'Cuenta cuántas peticiones del access.log terminaron en 404.',
      hints: ["awk '$9 == 404' access.log | wc -l", "sudo awk '$9 == 404' /var/log/nginx/access.log | wc -l", "Escribe: sudo awk '$9 == 404' /var/log/nginx/access.log | wc -l"],
      setup: (world) => {
        ensureNginx(world);
        const lines = Array.from({ length: 30 }, (_, i) => `198.51.100.${i % 7} - - [16/Nov/2024:10:${String(i).padStart(2, '0')}:00 +0000] "GET ${i % 5 === 0 ? '/wp-admin' : '/'} HTTP/1.1" ${i % 5 === 0 ? 404 : 200} 512 "-" "Mozilla/5.0"`);
        world.fs.privileged(() => world.fs.writeFile('/var/log/nginx/access.log', lines.join('\n') + '\n'));
      },
      solution: "sudo awk '$9 == 404' /var/log/nginx/access.log | wc -l",
      check: (ctx) => ctx.report.commands.at(-1)?.stdout.trim() === '6',
      success: '6 peticiones a /wp-admin: bots buscando WordPress. Normal en cualquier servidor público.',
      reward: rewardFor(3),
    },
    {
      id: 'nginx-13-02',
      title: '502 Bad Gateway',
      difficulty: 4,
      teaches: [],
      briefing: [
        '⚠ La API devuelve 502 Bad Gateway: nginx funciona, pero la aplicación de detrás no responde.',
        'El error.log lo explica: "connect() failed (111: Connection refused) while connecting to upstream".',
        'La app corre como servicio de systemd ("api"). Encuentra por qué no responde y arréglalo.',
      ],
      objective: 'Haz que http://api.devops-u.com vuelva a responder 200.',
      hints: ['sudo tail /var/log/nginx/error.log y systemctl status api.', 'El servicio api está parado.', 'Escribe: sudo systemctl start api'],
      setup: (world) => {
        ensurePackage(world, 'nodejs');
        rootFiles(world, { '/srv/api/server.js': "const PORT = process.env.PORT || 3000;\napp.listen(PORT);\n" });
        withMachine(world, (m) => {
          m.processes = m.processes.filter((p) => !p.ports?.includes(3000));
          m.services.api = { active: false, enabled: true, since: world.fs.now(), failed: 'Main process exited, code=killed, status=9/KILL' };
        });
        world.fs.privileged(() => world.fs.writeFile('/etc/systemd/system/api.service', '[Unit]\nDescription=API de pedidos\n[Service]\nExecStart=/usr/bin/node /srv/api/server.js\nUser=www-data\nRestart=on-failure\n[Install]\nWantedBy=multi-user.target\n'));
        withMachine(world, (m) => {
          const content = world.fs.privileged(() => world.fs.readFile('/etc/systemd/system/api.service'));
          let h = 0;
          for (const ch of content) h = (h * 31 + ch.charCodeAt(0)) | 0;
          m.loadedUnits = { ...m.loadedUnits, 'api.service': String(h) };
        });
        writeSite(world, 'api', API_SITE);
        ensureNginx(world);
      },
      solution: 'sudo systemctl start api',
      check: responds('http://api.devops-u.com/', (r) => r.status === 200),
      success: '502 = el backend no contesta. 504 = contesta demasiado tarde. Ya sabes dónde mirar.',
      reward: rewardFor(4),
    },
    {
      id: 'nginx-13-03',
      title: 'El misterio del 404',
      difficulty: 4,
      teaches: [],
      briefing: [
        '⚠ Tras una "pequeña mejora", el sitio de documentación (puerto 8083) devuelve 404 en todo.',
        'Pista: el error.log dice qué ruta intenta abrir nginx. Compárala con dónde están realmente los archivos.',
      ],
      objective: 'Arregla el sitio docs (puerto 8083) para que vuelva a servir su index.html.',
      hints: ['sudo tail -n 3 /var/log/nginx/error.log', 'El root apunta a /var/www/doc pero los archivos están en /var/www/docs.', "Escribe: sudo sed -i 's|root /var/www/doc;|root /var/www/docs;|' /etc/nginx/sites-available/docs && sudo nginx -t && sudo systemctl reload nginx"],
      setup: (world) => {
        rootFiles(world, { '/var/www/docs/index.html': '<h1>Documentación</h1>\n' });
        writeSite(world, 'docs', 'server {\n    listen 8083;\n    root /var/www/doc;\n    index index.html;\n}\n');
        ensureNginx(world);
      },
      solution: "sudo sed -i 's|root /var/www/doc;|root /var/www/docs;|' /etc/nginx/sites-available/docs && sudo nginx -t && sudo systemctl reload nginx",
      check: responds('http://localhost:8083/', (r) => r.status === 200 && /Documentación/.test(r.body)),
      success: 'Una letra. Por eso el error.log es lo primero que se mira.',
      reward: rewardFor(4),
    },
  ],
};

export const nginxChapter14: Chapter = {
  id: 'nginx-14',
  number: 14,
  title: 'JEFE FINAL: Producción web',
  description: 'SPA + API balanceada con HTTPS, caché y rate limiting. Todo junto.',
  missions: [
    {
      id: 'nginx-14-01',
      title: 'La plataforma completa',
      difficulty: 5,
      boss: true,
      teaches: [],
      briefing: [
        '══ MISIÓN FINAL DE NGINX ══',
        'Monta el sitio "plataforma" (sites-available/plataforma, habilitado) para devops-u.com:',
        '  · root /var/www/plataforma como SPA (try_files ... /index.html)',
        '  · /api/ balanceado entre 127.0.0.1:4001, :4002 y :4003 (upstream "backend")',
        '  · /static/ con caché de 7 días (expires 7d)',
        '  · /api/ limitado a 10 r/s por IP (zona "api" en conf.d, limit_req zone=api burst=20)',
        '  · HTTPS con certbot y redirección de HTTP a HTTPS',
        'Las instancias de la API ya están corriendo en 4001-4003.',
      ],
      objective: 'Publica devops-u.com con SPA, API balanceada, caché de estáticos, rate limiting y HTTPS.',
      hints: [
        'Escribe primero la zona en /etc/nginx/conf.d/api-limit.conf y el sitio con upstream + 3 locations; luego nginx -t, reload y certbot.',
        "La zona: echo 'limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;' | sudo tee /etc/nginx/conf.d/api-limit.conf",
        "Escribe: echo 'limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;' | sudo tee /etc/nginx/conf.d/api-limit.conf && printf 'upstream backend {\\n    server 127.0.0.1:4001;\\n    server 127.0.0.1:4002;\\n    server 127.0.0.1:4003;\\n}\\nserver {\\n    listen 80;\\n    server_name devops-u.com;\\n    root /var/www/plataforma;\\n    index index.html;\\n    location /api/ {\\n        limit_req zone=api burst=20;\\n        proxy_pass http://backend;\\n        proxy_set_header Host $host;\\n    }\\n    location /static/ {\\n        expires 7d;\\n    }\\n    location / {\\n        try_files $uri $uri/ /index.html;\\n    }\\n}\\n' | sudo tee /etc/nginx/sites-available/plataforma && sudo ln -s /etc/nginx/sites-available/plataforma /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx && sudo certbot --nginx -d devops-u.com --non-interactive --agree-tos -m admin@devops-u.com",
      ],
      setup: (world) => {
        ensurePackage(world, 'certbot');
        ensurePackage(world, 'python3-certbot-nginx');
        rootFiles(world, {
          '/var/www/plataforma/index.html': '<!doctype html><html><head><title>Plataforma DevOps</title></head><body><div id="app">Plataforma DevOps</div></body></html>\n',
          '/var/www/plataforma/static/app.js': 'console.log("plataforma");\n',
        });
        for (const port of [4001, 4002, 4003]) ensureNodeApp(world, '/srv/backend/server.js', port);
        removeSite(world, 'plataforma');
        world.fs.privileged(() => {
          if (world.fs.exists('/etc/nginx/conf.d/api-limit.conf')) world.fs.remove('/etc/nginx/conf.d/api-limit.conf');
          if (world.fs.exists('/etc/letsencrypt/live/devops-u.com')) world.fs.remove('/etc/letsencrypt/live/devops-u.com', true);
        });
        ensureNginx(world);
      },
      solution: "echo 'limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;' | sudo tee /etc/nginx/conf.d/api-limit.conf && printf 'upstream backend {\\n    server 127.0.0.1:4001;\\n    server 127.0.0.1:4002;\\n    server 127.0.0.1:4003;\\n}\\nserver {\\n    listen 80;\\n    server_name devops-u.com;\\n    root /var/www/plataforma;\\n    index index.html;\\n    location /api/ {\\n        limit_req zone=api burst=20;\\n        proxy_pass http://backend;\\n        proxy_set_header Host $host;\\n    }\\n    location /static/ {\\n        expires 7d;\\n    }\\n    location / {\\n        try_files $uri $uri/ /index.html;\\n    }\\n}\\n' | sudo tee /etc/nginx/sites-available/plataforma && sudo ln -s /etc/nginx/sites-available/plataforma /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx && sudo certbot --nginx -d devops-u.com --non-interactive --agree-tos -m admin@devops-u.com",
      check: all(
        responds('http://devops-u.com/', (r) => r.status === 301 && (r.headers.location ?? '').startsWith('https://devops-u.com')),
        responds('https://devops-u.com/panel/usuarios', (r) => r.status === 200 && /Plataforma DevOps/.test(r.body)),
        responds('https://devops-u.com/static/app.js', (r) => r.headers['cache-control'] === 'max-age=604800'),
        (ctx) => new Set(instances(ctx, 'https://devops-u.com/api/estado', 6)).size === 3,
        machine((m) => /limit_req_zone[^;]*zone=api:[^;]*rate=10r\/s/.test(Object.values(m.nginxFiles ?? {}).join('\n'))),
        machine((m) => /location \/api\/[\s\S]*?limit_req zone=api/.test(Object.values(m.nginxFiles ?? {}).join('\n'))),
      ),
      success: '🏆 PLATAFORMA EN PRODUCCIÓN. Eres WEB MASTER. Siguiente carrera: Docker.',
      reward: rewardFor(5, true),
    },
  ],
};

