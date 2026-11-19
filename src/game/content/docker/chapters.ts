/**
 * Módulo Docker: de los primeros contenedores a un proyecto completo con
 * Compose, redes aisladas, healthchecks y copias de seguridad.
 */
import { rewardFor, type Chapter, type MissionWorld } from '../../domain/curriculum';
import { all, inGroup, isFile, outputMatches, packageInstalled, ran, serviceActive } from '../../missions/checks';
import { plantFiles, withMachine } from '../../missions/worldHelpers';
import { ensurePackage, ensureNginx, removeSite, responds } from '../nginx/helpers';
import { dockerCheck, ensureContainer, ensureDocker, ensureImage, removeContainers, runningContainer } from './helpers';
import { dockerState } from '../../../engine/system/docker/model';

const WEB_HTML = '<!doctype html>\n<html><body><h1>Mi web en Docker</h1></body></html>\n';
const PACKAGE_JSON = '{\n  "name": "api",\n  "version": "1.0.0",\n  "main": "server.js",\n  "scripts": { "start": "node server.js" },\n  "dependencies": { "express": "^4.19.2" }\n}\n';
const SERVER_JS = "// API de la tienda\n// RESPUESTA: {\"api\":\"tienda\",\"version\":\"1.0\",\"entorno\":\"${NODE_ENV}\"}\nconst express = require('express');\nconst app = express();\napp.get('/', (req, res) => res.json({ api: 'tienda' }));\napp.listen(3000);\n";

/** Proyecto Node de ejemplo en ~/api. */
function apiProject(world: MissionWorld, extra: Record<string, string> = {}): void {
  plantFiles(world, { '~/api/package.json': PACKAGE_JSON, '~/api/server.js': SERVER_JS, '~/api/README.md': '# API\n', '~/api/node_modules/express/index.js': '// dependencia local (no debería ir en la imagen)\n', ...extra });
}

export const dockerChapter01: Chapter = {
  id: 'docker-01',
  number: 1,
  title: 'Fundamentos e instalación',
  description: 'Contenedores: tu aplicación con todo lo que necesita, igual en cualquier máquina.',
  missions: [
    {
      id: 'docker-01-01',
      title: 'Instalar Docker',
      difficulty: 2,
      teaches: ['docker'],
      briefing: [
        'Bienvenido a la carrera de Docker. Un CONTENEDOR empaqueta una aplicación con sus librerías y configuración.',
        'A diferencia de una máquina virtual, comparte el kernel del host: arranca en milisegundos y ocupa megas, no gigas.',
        'En Ubuntu: `sudo apt install docker.io`. Queda como servicio de systemd (docker).',
      ],
      objective: 'Instala Docker.',
      hints: ['Paquete docker.io con apt.', 'sudo apt install -y docker.io', 'Escribe: sudo apt update && sudo apt install -y docker.io'],
      setup: (world) => ensurePackage(world, 'curl'),
      solution: 'sudo apt update && sudo apt install -y docker.io',
      check: all(packageInstalled('docker.io'), serviceActive('docker')),
      success: 'Docker instalado. El "daemon" dockerd está en marcha esperando órdenes.',
      reward: rewardFor(2),
    },
    {
      id: 'docker-01-02',
      title: 'Sin sudo',
      difficulty: 3,
      teaches: ['newgrp'],
      briefing: [
        'Por defecto solo root puede hablar con Docker. Prueba `docker ps`: "permission denied".',
        'Solución estándar: añadir tu usuario al grupo docker (`sudo usermod -aG docker $USER`)',
        'y aplicar el grupo sin cerrar sesión con `newgrp docker`.',
        '⚠ Estar en el grupo docker equivale a ser root (puedes montar / en un contenedor). Solo para administradores.',
      ],
      objective: 'Añádete al grupo docker, aplícalo y comprueba que docker ps funciona.',
      hints: ['usermod -aG docker y luego newgrp docker.', 'sudo usermod -aG docker $USER && newgrp docker', 'Escribe: sudo usermod -aG docker $USER && newgrp docker && docker ps'],
      setup: (world) => {
        ensurePackage(world, 'docker.io');
        withMachine(world, () => undefined);
      },
      solution: 'sudo usermod -aG docker $USER && newgrp docker && docker ps',
      check: (ctx) => inGroup(ctx.session.username, 'docker')(ctx) && ran('docker', (a) => a[0] === 'ps')(ctx),
      success: 'Ya hablas con Docker sin sudo.',
      reward: rewardFor(3),
    },
    {
      id: 'docker-01-03',
      title: 'Hola, mundo',
      difficulty: 1,
      teaches: [],
      briefing: [
        '`docker run IMAGEN` descarga la imagen (si no la tienes) y crea un contenedor a partir de ella.',
        'hello-world es una imagen mínima que solo imprime un saludo y termina.',
      ],
      objective: 'Ejecuta la imagen hello-world.',
      hints: ['docker run + nombre de la imagen.', 'docker run hello-world', 'Escribe: docker run hello-world'],
      setup: (world) => ensureDocker(world),
      solution: 'docker run hello-world',
      check: outputMatches('docker', /Hello from Docker!/),
      success: 'Lee los 4 pasos que describe el mensaje: es exactamente lo que acaba de pasar.',
      reward: rewardFor(1),
    },
  ],
};

export const dockerChapter02: Chapter = {
  id: 'docker-02',
  number: 2,
  title: 'Primeros contenedores',
  description: 'Crear, listar, parar y borrar.',
  missions: [
    {
      id: 'docker-02-01',
      title: 'Un servidor en segundo plano',
      difficulty: 2,
      teaches: [],
      briefing: [
        '`docker run -d --name web nginx`:',
        '  -d (detach) lo ejecuta en segundo plano   --name le pone un nombre (si no, Docker inventa uno)',
      ],
      objective: 'Arranca un contenedor nginx en segundo plano llamado web.',
      hints: ['docker run con -d y --name.', 'docker run -d --name web nginx', 'Escribe: docker run -d --name web nginx'],
      setup: (world) => {
        ensureDocker(world);
        removeContainers(world, 'web');
      },
      solution: 'docker run -d --name web nginx',
      check: dockerCheck((s) => runningContainer(s, 'web') !== undefined),
      success: 'Un servidor web corriendo en un contenedor.',
      reward: rewardFor(2),
    },
    {
      id: 'docker-02-02',
      title: '¿Qué está corriendo?',
      difficulty: 1,
      teaches: [],
      briefing: ['`docker ps` lista los contenedores en marcha; `docker ps -a` también los parados.'],
      objective: 'Lista TODOS los contenedores, incluidos los parados.',
      hints: ['docker ps con la opción "all".', 'docker ps -a', 'Escribe: docker ps -a'],
      setup: (world) => {
        ensureDocker(world);
        ensureContainer(world, 'web', 'nginx');
      },
      solution: 'docker ps -a',
      check: ran('docker', (a) => a[0] === 'ps' && (a.includes('-a') || a.includes('--all'))),
      success: 'Fíjate en el hello-world: "Exited (0)". Terminó bien y sigue ahí hasta que lo borres.',
      reward: rewardFor(1),
    },
    {
      id: 'docker-02-03',
      title: 'Parar y borrar',
      difficulty: 2,
      teaches: [],
      briefing: [
        '`docker stop web` lo para (envía SIGTERM y espera a que termine).',
        '`docker rm web` lo borra. Un contenedor en marcha no se puede borrar sin parar (o con -f).',
      ],
      objective: 'Para y borra el contenedor web.',
      hints: ['stop y después rm.', 'docker stop web && docker rm web', 'Escribe: docker stop web && docker rm web'],
      setup: (world) => {
        ensureDocker(world);
        ensureContainer(world, 'web', 'nginx');
      },
      solution: 'docker stop web && docker rm web',
      check: dockerCheck((s) => !s.containers.some((c) => c.name === 'web')),
      success: 'Contenedor eliminado. La imagen nginx sigue descargada para la próxima vez.',
      reward: rewardFor(2),
    },
    {
      id: 'docker-02-04',
      title: 'Usar y tirar',
      difficulty: 2,
      teaches: [],
      briefing: [
        'Un contenedor puede ejecutar un solo comando y terminar: `docker run ubuntu cat /etc/os-release`',
        'Con `--rm` se borra solo al terminar: no deja basura en docker ps -a.',
      ],
      objective: 'Muestra el /etc/os-release de la imagen alpine con un contenedor que se borre solo.',
      hints: ['docker run --rm IMAGEN COMANDO.', 'docker run --rm alpine cat /etc/os-release', 'Escribe: docker run --rm alpine cat /etc/os-release'],
      setup: (world) => ensureDocker(world),
      solution: 'docker run --rm alpine cat /etc/os-release',
      check: all(outputMatches('docker', /Alpine Linux/), dockerCheck((s) => !s.containers.some((c) => c.image === 'alpine' && c.status === 'exited' && c.cmd.join(' ').includes('os-release')))),
      success: 'Alpine Linux en milisegundos y sin restos. Ideal para tareas puntuales.',
      reward: rewardFor(2),
    },
  ],
};

export const dockerChapter03: Chapter = {
  id: 'docker-03',
  number: 3,
  title: 'Imágenes',
  description: 'Las plantillas de las que nacen los contenedores.',
  missions: [
    {
      id: 'docker-03-01',
      title: 'Descargar',
      difficulty: 2,
      teaches: [],
      briefing: [
        'Las imágenes vienen de un registro (Docker Hub por defecto). `docker pull nombre:etiqueta`.',
        'La etiqueta indica la versión. Sin etiqueta se usa "latest" (⚠ en producción, fija SIEMPRE la versión).',
      ],
      objective: 'Descarga node:20-alpine y node:20 y compara sus tamaños con docker images.',
      hints: ['Dos docker pull y luego docker images.', 'docker pull node:20-alpine && docker pull node:20', 'Escribe: docker pull node:20-alpine && docker pull node:20 && docker images'],
      setup: (world) => ensureDocker(world),
      solution: 'docker pull node:20-alpine && docker pull node:20 && docker images',
      check: all(dockerCheck((s) => s.images.some((i) => i.repository === 'node' && i.tag === '20-alpine') && s.images.some((i) => i.repository === 'node' && i.tag === '20')), ran('docker', (a) => a[0] === 'images')),
      success: '135 MB frente a 1,1 GB. Las variantes alpine y slim son mucho más ligeras.',
      reward: rewardFor(2),
    },
    {
      id: 'docker-03-02',
      title: 'Las capas',
      difficulty: 2,
      teaches: [],
      briefing: [
        'Una imagen se construye en CAPAS de solo lectura apiladas. Varias imágenes comparten las capas comunes.',
        '`docker history imagen` muestra sus capas.',
      ],
      objective: 'Muestra las capas de la imagen nginx.',
      hints: ['docker history.', 'docker history nginx', 'Escribe: docker history nginx'],
      setup: (world) => {
        ensureDocker(world);
        ensureImage(world, 'nginx');
      },
      solution: 'docker history nginx',
      check: ran('docker', (a) => a[0] === 'history'),
      success: 'Cada línea es una capa. Cuando un contenedor escribe, lo hace en una capa extra propia.',
      reward: rewardFor(2),
    },
    {
      id: 'docker-03-03',
      title: 'Limpiar imágenes',
      difficulty: 2,
      teaches: [],
      briefing: ['`docker rmi imagen` borra una imagen (si ningún contenedor la usa).'],
      objective: 'Borra la imagen node:20 (la grande).',
      hints: ['docker rmi con nombre y etiqueta.', 'docker rmi node:20', 'Escribe: docker rmi node:20'],
      setup: (world) => {
        ensureDocker(world);
        ensureImage(world, 'node:20');
        removeContainers(world, '*');
      },
      solution: 'docker rmi node:20',
      check: dockerCheck((s) => !s.images.some((i) => i.repository === 'node' && i.tag === '20')),
      success: '1,1 GB liberados.',
      reward: rewardFor(2),
    },
  ],
};

export const dockerChapter04: Chapter = {
  id: 'docker-04',
  number: 4,
  title: 'Interactuar y depurar',
  description: 'logs, exec e inspect: mirar dentro de los contenedores.',
  missions: [
    {
      id: 'docker-04-01',
      title: 'Los logs',
      difficulty: 2,
      teaches: [],
      briefing: ['Lo que una app escribe por pantalla, Docker lo guarda: `docker logs contenedor` (`-f` en directo, `--tail 20`).'],
      objective: 'Muestra los logs del contenedor web.',
      hints: ['docker logs.', 'docker logs web', 'Escribe: docker logs web'],
      setup: (world) => {
        ensureDocker(world);
        ensureContainer(world, 'web', 'nginx');
      },
      solution: 'docker logs web',
      check: ran('docker', (a) => a[0] === 'logs'),
      success: 'Primera parada de cualquier diagnóstico.',
      reward: rewardFor(2),
    },
    {
      id: 'docker-04-02',
      title: 'Entrar al contenedor',
      difficulty: 3,
      teaches: [],
      briefing: [
        '`docker exec contenedor comando` ejecuta un comando DENTRO de un contenedor en marcha.',
        '`docker exec -it web bash` abriría una shell (interactiva) dentro.',
      ],
      objective: 'Muestra el index.html que sirve el contenedor web (/usr/share/nginx/html/index.html).',
      hints: ['docker exec web cat RUTA', 'docker exec web cat /usr/share/nginx/html/index.html', 'Escribe: docker exec web cat /usr/share/nginx/html/index.html'],
      setup: (world) => {
        ensureDocker(world);
        ensureContainer(world, 'web', 'nginx');
      },
      solution: 'docker exec web cat /usr/share/nginx/html/index.html',
      check: outputMatches('docker', /Welcome to nginx/),
      success: 'Has leído un archivo del sistema de archivos aislado del contenedor.',
      reward: rewardFor(3),
    },
    {
      id: 'docker-04-03',
      title: 'Un contenedor que muere',
      difficulty: 4,
      teaches: [],
      briefing: [
        '⚠ El contenedor "basedatos" (postgres:16) no arranca: aparece Exited en docker ps -a.',
        'Lee sus logs: el error te dice exactamente qué le falta.',
        'Bórralo y vuelve a crearlo correctamente (mismo nombre, en segundo plano).',
      ],
      objective: 'Haz que el contenedor basedatos (postgres:16) quede en marcha.',
      hints: ['docker logs basedatos', 'Falta la variable POSTGRES_PASSWORD (-e).', 'Escribe: docker rm basedatos && docker run -d --name basedatos -e POSTGRES_PASSWORD=Secreto123 postgres:16'],
      setup: (world) => {
        ensureDocker(world);
        removeContainers(world, 'basedatos');
        ensureContainer(world, 'basedatos', 'postgres:16');
      },
      solution: 'docker rm basedatos && docker run -d --name basedatos -e POSTGRES_PASSWORD=Secreto123 postgres:16',
      check: dockerCheck((s) => runningContainer(s, 'basedatos') !== undefined),
      success: 'Exited → logs → causa → arreglo. El ciclo de depuración con Docker.',
      reward: rewardFor(4),
    },
    {
      id: 'docker-04-04',
      title: 'Inspeccionar',
      difficulty: 3,
      teaches: [],
      briefing: [
        '`docker inspect contenedor` muestra TODO en JSON: estado, variables, montajes, red...',
        'Con --format extraes un dato: `docker inspect -f "{{.State.Status}}" web`',
      ],
      objective: 'Muestra solo la IP del contenedor web con inspect y --format.',
      hints: ['La ruta es .NetworkSettings.IPAddress', 'docker inspect -f "{{.NetworkSettings.IPAddress}}" web', 'Escribe: docker inspect -f "{{.NetworkSettings.IPAddress}}" web'],
      setup: (world) => {
        ensureDocker(world);
        ensureContainer(world, 'web', 'nginx');
      },
      solution: 'docker inspect -f "{{.NetworkSettings.IPAddress}}" web',
      check: outputMatches('docker', /^172\.17\.0\.\d+$/m),
      success: 'IP interna de Docker (172.17.x.x). Desde fuera no es accesible... salvo que publiques puertos.',
      reward: rewardFor(3),
    },
  ],
};

export const dockerChapter05: Chapter = {
  id: 'docker-05',
  number: 5,
  title: 'Puertos y variables',
  description: 'Abrir el contenedor al mundo y configurarlo sin tocar la imagen.',
  missions: [
    {
      id: 'docker-05-01',
      title: 'Publicar un puerto',
      difficulty: 3,
      teaches: [],
      briefing: [
        '`-p 8080:80` publica el puerto 80 del contenedor en el 8080 del host (HOST:CONTENEDOR).',
        'Así, `curl localhost:8080` llega al nginx del contenedor.',
      ],
      objective: 'Arranca nginx como "publico" con su puerto 80 publicado en el 8080 del host y pruébalo con curl.',
      hints: ['docker run -d --name publico -p 8080:80 nginx', 'Después curl localhost:8080.', 'Escribe: docker run -d --name publico -p 8080:80 nginx && curl localhost:8080'],
      setup: (world) => {
        ensureDocker(world);
        removeContainers(world, 'publico');
      },
      solution: 'docker run -d --name publico -p 8080:80 nginx && curl localhost:8080',
      check: responds('http://localhost:8080/', (r) => /Welcome to nginx/.test(r.body)),
      success: 'Tu contenedor es accesible por el puerto 8080 del servidor.',
      reward: rewardFor(3),
    },
    {
      id: 'docker-05-02',
      title: 'Puerto ocupado',
      difficulty: 3,
      teaches: [],
      briefing: [
        'Dos contenedores no pueden publicar el mismo puerto del host: "port is already allocated".',
        'Arranca un segundo nginx ("publico2") usando otro puerto del host, el 8081.',
      ],
      objective: 'Arranca publico2 (nginx) publicado en el 8081.',
      hints: ['Mismo puerto en el contenedor (80), distinto en el host.', 'docker run -d --name publico2 -p 8081:80 nginx', 'Escribe: docker run -d --name publico2 -p 8081:80 nginx'],
      setup: (world) => {
        ensureDocker(world);
        ensureContainer(world, 'publico', 'nginx', { ports: [[8080, 80]] });
        removeContainers(world, 'publico2');
      },
      solution: 'docker run -d --name publico2 -p 8081:80 nginx',
      check: responds('http://localhost:8081/', (r) => r.status === 200),
      success: 'Muchos contenedores con el mismo puerto interno, distintos puertos externos.',
      reward: rewardFor(3),
    },
    {
      id: 'docker-05-03',
      title: 'Configurar con variables',
      difficulty: 3,
      teaches: [],
      briefing: [
        'Las apps en contenedores se configuran con variables de entorno: `-e CLAVE=valor`.',
        'Así la misma imagen sirve para desarrollo y producción.',
        'Para muchas: `--env-file archivo.env`.',
      ],
      objective: 'Arranca un alpine llamado "config" que duerma (sleep infinity) con APP_ENV=produccion y compruébalo con docker exec config env.',
      hints: ['docker run -d --name config -e APP_ENV=produccion alpine sleep infinity', 'Luego: docker exec config env', 'Escribe: docker run -d --name config -e APP_ENV=produccion alpine sleep infinity && docker exec config env'],
      setup: (world) => {
        ensureDocker(world);
        removeContainers(world, 'config');
      },
      solution: 'docker run -d --name config -e APP_ENV=produccion alpine sleep infinity && docker exec config env',
      check: dockerCheck((s) => runningContainer(s, 'config')?.env.APP_ENV === 'produccion'),
      success: 'Nunca metas contraseñas dentro de la imagen: pásalas como variables (o secretos).',
      reward: rewardFor(3),
    },
  ],
};

export const dockerChapter06: Chapter = {
  id: 'docker-06',
  number: 6,
  title: 'Volúmenes',
  description: 'Los contenedores son efímeros. Tus datos, no.',
  missions: [
    {
      id: 'docker-06-01',
      title: 'Datos que sobreviven',
      difficulty: 4,
      teaches: [],
      briefing: [
        'Lo que escribe un contenedor desaparece al borrarlo. Para datos persistentes: VOLÚMENES.',
        '`docker volume create datos` y `-v datos:/ruta/en/contenedor`.',
        'Para PostgreSQL los datos van en /var/lib/postgresql/data.',
      ],
      objective: 'Crea el volumen pgdatos y arranca postgres:16 ("pg", con POSTGRES_PASSWORD) usándolo en /var/lib/postgresql/data.',
      hints: ['docker volume create pgdatos y después -v pgdatos:/var/lib/postgresql/data', 'docker run -d --name pg -e POSTGRES_PASSWORD=Secreto123 -v pgdatos:/var/lib/postgresql/data postgres:16', 'Escribe: docker volume create pgdatos && docker run -d --name pg -e POSTGRES_PASSWORD=Secreto123 -v pgdatos:/var/lib/postgresql/data postgres:16'],
      setup: (world) => {
        ensureDocker(world);
        removeContainers(world, 'pg');
        withMachine(world, (m) => {
          delete dockerState(m).volumes.pgdatos;
        });
      },
      solution: 'docker volume create pgdatos && docker run -d --name pg -e POSTGRES_PASSWORD=Secreto123 -v pgdatos:/var/lib/postgresql/data postgres:16',
      check: dockerCheck((s) => runningContainer(s, 'pg')?.mounts.some((m) => m.type === 'volume' && m.source === 'pgdatos' && m.target === '/var/lib/postgresql/data') ?? false),
      success: 'Si borras el contenedor pg, los datos siguen en el volumen pgdatos.',
      reward: rewardFor(4),
    },
    {
      id: 'docker-06-02',
      title: 'Bind mount',
      difficulty: 3,
      teaches: [],
      briefing: [
        'Un bind mount monta una carpeta del HOST dentro del contenedor: `-v /ruta/host:/ruta/contenedor`.',
        'Ideal para desarrollo: editas en tu carpeta y el contenedor lo ve al instante.',
        'Con `:ro` el contenedor solo puede leer.',
      ],
      objective: 'Sirve ~/web con nginx: contenedor "dev" en el 8082 con ~/web montado en /usr/share/nginx/html en solo lectura.',
      hints: ['-v ~/web:/usr/share/nginx/html:ro', 'docker run -d --name dev -p 8082:80 -v ~/web:/usr/share/nginx/html:ro nginx', 'Escribe: docker run -d --name dev -p 8082:80 -v ~/web:/usr/share/nginx/html:ro nginx'],
      setup: (world) => {
        ensureDocker(world);
        removeContainers(world, 'dev');
        plantFiles(world, { '~/web/index.html': WEB_HTML });
      },
      solution: 'docker run -d --name dev -p 8082:80 -v ~/web:/usr/share/nginx/html:ro nginx',
      check: all(responds('http://localhost:8082/', (r) => /Mi web en Docker/.test(r.body)), dockerCheck((s) => runningContainer(s, 'dev')?.mounts.some((m) => m.readOnly) ?? false)),
      success: 'Cambia ~/web/index.html y vuelve a hacer curl: el cambio se ve al instante.',
      reward: rewardFor(3),
    },
    {
      id: 'docker-06-03',
      title: 'Gestionar volúmenes',
      difficulty: 2,
      teaches: [],
      briefing: ['`docker volume ls` los lista; `docker volume inspect` dice dónde están en el disco; `docker volume rm` los borra.'],
      objective: 'Muestra en qué ruta del host guarda Docker el volumen pgdatos.',
      hints: ['docker volume inspect.', 'docker volume inspect pgdatos', 'Escribe: docker volume inspect pgdatos'],
      setup: (world) => {
        ensureDocker(world);
        withMachine(world, (m) => {
          dockerState(m).volumes.pgdatos ??= { created: world.fs.now(), driver: 'local', data: {} };
        });
      },
      solution: 'docker volume inspect pgdatos',
      check: outputMatches('docker', /\/var\/lib\/docker\/volumes\/pgdatos\/_data/),
      success: '/var/lib/docker/volumes/...: ahí viven tus datos. Inclúyelo en tus copias de seguridad.',
      reward: rewardFor(2),
    },
  ],
};

export const dockerChapter07: Chapter = {
  id: 'docker-07',
  number: 7,
  title: 'Redes',
  description: 'Contenedores que se hablan por su nombre.',
  missions: [
    {
      id: 'docker-07-01',
      title: 'Tu propia red',
      difficulty: 3,
      teaches: [],
      briefing: [
        'En la red por defecto (bridge) los contenedores NO se encuentran por nombre.',
        'En una red creada por ti, sí: Docker les da DNS interno. `docker network create mired`.',
      ],
      objective: 'Crea la red "tienda" y arranca en ella dos nginx: "front" y "back".',
      hints: ['docker network create y --network en cada run.', 'docker network create tienda && docker run -d --name front --network tienda nginx', 'Escribe: docker network create tienda && docker run -d --name front --network tienda nginx && docker run -d --name back --network tienda nginx'],
      setup: (world) => {
        ensureDocker(world);
        removeContainers(world, 'front', 'back');
        withMachine(world, (m) => {
          delete dockerState(m).networks.tienda;
        });
      },
      solution: 'docker network create tienda && docker run -d --name front --network tienda nginx && docker run -d --name back --network tienda nginx',
      check: dockerCheck((s) => ['front', 'back'].every((n) => runningContainer(s, n)?.networks.includes('tienda'))),
      success: 'Dos contenedores en la misma red privada.',
      reward: rewardFor(3),
    },
    {
      id: 'docker-07-02',
      title: 'Por su nombre',
      difficulty: 3,
      teaches: [],
      briefing: ['Desde front, haz una petición a back usando su nombre: `docker exec front curl -s http://back`'],
      objective: 'Desde el contenedor front, pide la página de back por su nombre.',
      hints: ['docker exec front curl ...', 'docker exec front curl -s http://back', 'Escribe: docker exec front curl -s http://back'],
      setup: (world) => {
        ensureDocker(world);
        ensureContainer(world, 'front', 'nginx', { network: 'tienda' });
        ensureContainer(world, 'back', 'nginx', { network: 'tienda' });
      },
      solution: 'docker exec front curl -s http://back',
      check: outputMatches('docker', /Welcome to nginx/),
      success: 'Así se conecta una API con su base de datos: host "db", no una IP que cambia.',
      reward: rewardFor(3),
    },
    {
      id: 'docker-07-03',
      title: 'Aislamiento',
      difficulty: 3,
      teaches: [],
      briefing: [
        'Un contenedor fuera de la red no puede alcanzar a los de dentro. Eso es aislamiento: la base de datos',
        'solo debe estar en la red del backend, nunca accesible desde el frontend.',
        'Conecta el contenedor "suelto" a la red tienda para que pueda hablar con back: `docker network connect RED CONTENEDOR`.',
      ],
      objective: 'Conecta el contenedor suelto a la red tienda.',
      hints: ['docker network connect.', 'docker network connect tienda suelto', 'Escribe: docker network connect tienda suelto'],
      setup: (world) => {
        ensureDocker(world);
        ensureContainer(world, 'back', 'nginx', { network: 'tienda' });
        removeContainers(world, 'suelto');
        ensureContainer(world, 'suelto', 'nginx');
      },
      solution: 'docker network connect tienda suelto',
      check: dockerCheck((s) => runningContainer(s, 'suelto')?.networks.includes('tienda') ?? false),
      success: 'Un contenedor puede estar en varias redes: así se construyen arquitecturas por capas.',
      reward: rewardFor(3),
    },
  ],
};

const STATIC_DOCKERFILE = 'FROM nginx:alpine\nCOPY index.html /usr/share/nginx/html/index.html\nEXPOSE 80\n';

export const dockerChapter08: Chapter = {
  id: 'docker-08',
  number: 8,
  title: 'Dockerfile',
  description: 'Tus propias imágenes, reproducibles y versionadas.',
  missions: [
    {
      id: 'docker-08-01',
      title: 'Tu primera imagen',
      difficulty: 3,
      teaches: [],
      briefing: [
        'Un Dockerfile es la receta de una imagen:',
        '  FROM nginx:alpine                     ← imagen base',
        '  COPY index.html /usr/share/nginx/html/  ← copia archivos del "contexto"',
        '  EXPOSE 80                             ← documenta el puerto',
        '`docker build -t nombre:versión .` la construye (el "." es el contexto: la carpeta actual).',
      ],
      objective: 'En ~/web crea un Dockerfile basado en nginx:alpine que copie index.html, y construye la imagen miweb:1.0.',
      hints: ['Escribe el Dockerfile (nano o printf) y luego docker build -t miweb:1.0 .', "printf 'FROM nginx:alpine\\nCOPY index.html /usr/share/nginx/html/index.html\\nEXPOSE 80\\n' > ~/web/Dockerfile", "Escribe: printf 'FROM nginx:alpine\\nCOPY index.html /usr/share/nginx/html/index.html\\nEXPOSE 80\\n' > ~/web/Dockerfile && cd ~/web && docker build -t miweb:1.0 ."],
      setup: (world) => {
        ensureDocker(world);
        plantFiles(world, { '~/web/index.html': WEB_HTML });
      },
      solution: "printf 'FROM nginx:alpine\\nCOPY index.html /usr/share/nginx/html/index.html\\nEXPOSE 80\\n' > ~/web/Dockerfile && cd ~/web && docker build -t miweb:1.0 .",
      check: dockerCheck((s) => s.images.some((i) => i.repository === 'miweb' && i.tag === '1.0' && /Mi web en Docker/.test(i.config.files['/usr/share/nginx/html/index.html'] ?? ''))),
      success: 'Una imagen con tu web dentro: se puede ejecutar igual en cualquier servidor.',
      reward: rewardFor(3),
    },
    {
      id: 'docker-08-02',
      title: 'Ejecutar tu imagen',
      difficulty: 2,
      teaches: [],
      briefing: ['Tu imagen se usa como cualquier otra: `docker run -d -p 8083:80 miweb:1.0`'],
      objective: 'Arranca miweb:1.0 como "miweb" en el puerto 8083 y compruébalo.',
      hints: ['docker run -d --name miweb -p 8083:80 miweb:1.0', 'Luego curl localhost:8083', 'Escribe: docker run -d --name miweb -p 8083:80 miweb:1.0 && curl localhost:8083'],
      setup: (world) => {
        ensureDocker(world);
        plantFiles(world, { '~/web/index.html': WEB_HTML, '~/web/Dockerfile': STATIC_DOCKERFILE });
        removeContainers(world, 'miweb');
        withMachine(world, (m) => {
          const state = dockerState(m);
          if (!state.images.some((i) => i.repository === 'miweb')) {
            // Construida en la misión anterior; si no, se construye ahora.
          }
        });
      },
      solution: 'cd ~/web && docker build -t miweb:1.0 . && docker run -d --name miweb -p 8083:80 miweb:1.0 && curl localhost:8083',
      check: responds('http://localhost:8083/', (r) => /Mi web en Docker/.test(r.body)),
      success: 'Tu web empaquetada y funcionando.',
      reward: rewardFor(2),
    },
    {
      id: 'docker-08-03',
      title: 'Imagen de una aplicación',
      difficulty: 4,
      teaches: [],
      briefing: [
        'Para una app de Node:',
        '  FROM node:20-alpine',
        '  WORKDIR /app                 ← directorio de trabajo dentro de la imagen',
        '  COPY . .',
        '  RUN npm install              ← se ejecuta AL CONSTRUIR',
        '  EXPOSE 3000',
        '  CMD ["node", "server.js"]    ← lo que se ejecuta AL ARRANCAR el contenedor',
      ],
      objective: 'Crea ~/api/Dockerfile para la API, constrúyela como api:1.0 y arráncala ("api", puerto 3000).',
      hints: ['RUN se ejecuta al construir; CMD al arrancar.', "printf 'FROM node:20-alpine\\nWORKDIR /app\\nCOPY . .\\nRUN npm install\\nEXPOSE 3000\\nCMD [\"node\", \"server.js\"]\\n' > ~/api/Dockerfile", "Escribe: printf 'FROM node:20-alpine\\nWORKDIR /app\\nCOPY . .\\nRUN npm install\\nEXPOSE 3000\\nCMD [\"node\", \"server.js\"]\\n' > ~/api/Dockerfile && cd ~/api && docker build -t api:1.0 . && docker run -d --name api -p 3000:3000 api:1.0"],
      setup: (world) => {
        ensureDocker(world);
        apiProject(world);
        removeContainers(world, 'api');
        withMachine(world, (m) => {
          m.processes = m.processes.filter((p) => !p.ports?.includes(3000));
        });
      },
      solution: "printf 'FROM node:20-alpine\\nWORKDIR /app\\nCOPY . .\\nRUN npm install\\nEXPOSE 3000\\nCMD [\"node\", \"server.js\"]\\n' > ~/api/Dockerfile && cd ~/api && docker build -t api:1.0 . && docker run -d --name api -p 3000:3000 api:1.0",
      check: responds('http://localhost:3000/', (r) => /"api":"tienda"/.test(r.body)),
      success: 'Tu API en un contenedor. Mira su tamaño con docker images: ¿te parece mucho? Lo arreglaremos.',
      reward: rewardFor(4),
    },
  ],
};

export const dockerChapter09: Chapter = {
  id: 'docker-09',
  number: 9,
  title: 'Dockerfile profesional',
  description: 'Caché de capas, .dockerignore, multi-stage y usuarios sin privilegios.',
  missions: [
    {
      id: 'docker-09-01',
      title: 'No copies basura',
      difficulty: 3,
      teaches: [],
      briefing: [
        '`COPY . .` copia TODO: node_modules local, .git, .env con contraseñas...',
        '.dockerignore excluye archivos del contexto (como .gitignore):',
        '  node_modules\n  .git\n  .env',
      ],
      objective: 'Crea ~/api/.dockerignore con node_modules, .git y .env, y reconstruye api:1.1 (sin node_modules local dentro).',
      hints: ["printf 'node_modules\\n.git\\n.env\\n' > ~/api/.dockerignore", 'Después docker build -t api:1.1 .', "Escribe: printf 'node_modules\\n.git\\n.env\\n' > ~/api/.dockerignore && cd ~/api && docker build -t api:1.1 ."],
      setup: (world) => {
        ensureDocker(world);
        apiProject(world, { '~/api/Dockerfile': 'FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nRUN npm install\nEXPOSE 3000\nCMD ["node", "server.js"]\n', '~/api/.env': 'DB_PASSWORD=secreto\n' });
      },
      solution: "printf 'node_modules\\n.git\\n.env\\n' > ~/api/.dockerignore && cd ~/api && docker build -t api:1.1 .",
      check: dockerCheck((s) => {
        const image = s.images.find((i) => i.repository === 'api' && i.tag === '1.1');
        return !!image && !Object.keys(image.config.files).some((f) => f.includes('node_modules/express') || f.endsWith('/.env'));
      }),
      success: 'Ni dependencias locales ni el .env con contraseñas dentro de la imagen.',
      reward: rewardFor(3),
    },
    {
      id: 'docker-09-02',
      title: 'Aprovecha la caché',
      difficulty: 4,
      teaches: [],
      briefing: [
        'Docker reutiliza (CACHED) las capas cuyo contenido no cambió... hasta la primera que cambia.',
        'Con `COPY . .` antes de `npm install`, cualquier cambio en el código reinstala TODAS las dependencias.',
        'Orden correcto:',
        '  COPY package*.json ./\n  RUN npm install\n  COPY . .',
      ],
      objective: 'Reordena ~/api/Dockerfile para copiar primero package.json, y construye api:1.2.',
      hints: ['Copia package.json, instala y después copia el resto.', "printf 'FROM node:20-alpine\\nWORKDIR /app\\nCOPY package*.json ./\\nRUN npm install\\nCOPY . .\\nEXPOSE 3000\\nCMD [\"node\", \"server.js\"]\\n' > ~/api/Dockerfile", "Escribe: printf 'FROM node:20-alpine\\nWORKDIR /app\\nCOPY package*.json ./\\nRUN npm install\\nCOPY . .\\nEXPOSE 3000\\nCMD [\"node\", \"server.js\"]\\n' > ~/api/Dockerfile && cd ~/api && docker build -t api:1.2 ."],
      setup: (world) => {
        ensureDocker(world);
        apiProject(world, { '~/api/Dockerfile': 'FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nRUN npm install\nEXPOSE 3000\nCMD ["node", "server.js"]\n', '~/api/.dockerignore': 'node_modules\n.git\n.env\n' });
      },
      solution: "printf 'FROM node:20-alpine\\nWORKDIR /app\\nCOPY package*.json ./\\nRUN npm install\\nCOPY . .\\nEXPOSE 3000\\nCMD [\"node\", \"server.js\"]\\n' > ~/api/Dockerfile && cd ~/api && docker build -t api:1.2 .",
      check: all(
        (ctx) => {
          const text = ctx.fs.readFile(`${ctx.session.home}/api/Dockerfile`);
          const pkg = text.search(/COPY package\*?\.json/);
          const install = text.search(/RUN npm (install|ci)/);
          const all2 = text.search(/COPY \. \./);
          return pkg !== -1 && install > pkg && all2 > install;
        },
        dockerCheck((s) => s.images.some((i) => i.repository === 'api' && i.tag === '1.2')),
      ),
      success: 'Cambia server.js y reconstruye: verás "CACHED ... RUN npm install". Builds de segundos en vez de minutos.',
      reward: rewardFor(4),
    },
    {
      id: 'docker-09-03',
      title: 'Multi-stage',
      difficulty: 5,
      teaches: [],
      briefing: [
        'Un frontend se COMPILA con Node, pero en producción solo necesita los archivos resultantes y un nginx.',
        'Multi-stage: varias etapas FROM en un Dockerfile; la final copia lo justo de las anteriores:',
        '  FROM node:20-alpine AS build\n  WORKDIR /app\n  COPY . .\n  RUN npm install && npm run build\n\n  FROM nginx:alpine\n  COPY --from=build /app/dist /usr/share/nginx/html',
      ],
      objective: 'Crea ~/frontend/Dockerfile multi-stage (build en node:20-alpine, final nginx:alpine con /app/dist) y construye frontend:1.0.',
      hints: ['Dos FROM; el segundo usa COPY --from=build.', 'La imagen final debe salir de nginx:alpine (pequeña).', "Escribe: printf 'FROM node:20-alpine AS build\\nWORKDIR /app\\nCOPY . .\\nRUN npm install && npm run build\\n\\nFROM nginx:alpine\\nCOPY --from=build /app/dist /usr/share/nginx/html\\n' > ~/frontend/Dockerfile && cd ~/frontend && docker build -t frontend:1.0 ."],
      setup: (world) => {
        ensureDocker(world);
        plantFiles(world, { '~/frontend/package.json': '{ "name": "frontend", "scripts": { "build": "vite build" } }\n', '~/frontend/src/main.js': 'console.log("app");\n', '~/frontend/index.html': '<div id="root"></div>\n' });
      },
      solution: "printf 'FROM node:20-alpine AS build\\nWORKDIR /app\\nCOPY . .\\nRUN npm install && npm run build\\n\\nFROM nginx:alpine\\nCOPY --from=build /app/dist /usr/share/nginx/html\\n' > ~/frontend/Dockerfile && cd ~/frontend && docker build -t frontend:1.0 .",
      check: dockerCheck((s) => {
        const image = s.images.find((i) => i.repository === 'frontend' && i.tag === '1.0');
        return !!image && image.sizeMB < 80 && image.config.kind === 'web' && Object.keys(image.config.files).some((f) => f.startsWith('/usr/share/nginx/html/'));
      }),
      success: 'De ~300 MB a ~45 MB: sin Node, sin node_modules, sin código fuente. Solo lo necesario.',
      reward: rewardFor(5),
    },
    {
      id: 'docker-09-04',
      title: 'Sin root',
      difficulty: 4,
      teaches: [],
      briefing: [
        'Por defecto los procesos del contenedor corren como root. Si alguien explota tu app, es root dentro.',
        'Las imágenes de node traen el usuario "node". Añade antes del CMD: `USER node`',
      ],
      objective: 'Haz que la imagen api:1.3 ejecute la app como el usuario node.',
      hints: ['Añade USER node al Dockerfile antes de CMD.', "sed -i 's|^CMD|USER node\\nCMD|' ~/api/Dockerfile", "Escribe: sed -i 's|^CMD|USER node\\nCMD|' ~/api/Dockerfile && cd ~/api && docker build -t api:1.3 ."],
      setup: (world) => {
        ensureDocker(world);
        apiProject(world, { '~/api/Dockerfile': 'FROM node:20-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm install\nCOPY . .\nEXPOSE 3000\nCMD ["node", "server.js"]\n', '~/api/.dockerignore': 'node_modules\n.git\n.env\n' });
      },
      solution: "sed -i 's|^CMD|USER node\\nCMD|' ~/api/Dockerfile && cd ~/api && docker build -t api:1.3 .",
      check: dockerCheck((s) => s.images.find((i) => i.repository === 'api' && i.tag === '1.3')?.config.user === 'node'),
      success: 'Principio de mínimo privilegio, también dentro de los contenedores.',
      reward: rewardFor(4),
    },
  ],
};

const COMPOSE_BASIC = 'services:\n  web:\n    image: nginx:alpine\n    ports:\n      - "8090:80"\n  db:\n    image: postgres:16\n    environment:\n      POSTGRES_PASSWORD: Secreto123\n    volumes:\n      - datos:/var/lib/postgresql/data\n\nvolumes:\n  datos:\n';

export const dockerChapter10: Chapter = {
  id: 'docker-10',
  number: 10,
  title: 'Docker Compose',
  description: 'Toda la aplicación descrita en un archivo YAML.',
  missions: [
    {
      id: 'docker-10-01',
      title: 'El plugin compose',
      difficulty: 2,
      teaches: [],
      briefing: [
        'Lanzar 5 contenedores con sus redes y volúmenes a mano es frágil. Docker Compose lo describe en un YAML',
        'y lo levanta con un solo comando. Instala el plugin: `sudo apt install docker-compose-v2`.',
      ],
      objective: 'Instala docker-compose-v2.',
      hints: ['apt install.', 'sudo apt install -y docker-compose-v2', 'Escribe: sudo apt install -y docker-compose-v2'],
      setup: (world) => ensureDocker(world),
      solution: 'sudo apt install -y docker-compose-v2',
      check: packageInstalled('docker-compose-v2'),
      success: 'Ahora tienes `docker compose`.',
      reward: rewardFor(2),
    },
    {
      id: 'docker-10-02',
      title: 'Tu primer compose.yaml',
      difficulty: 4,
      teaches: [],
      briefing: [
        'compose.yaml (la indentación con ESPACIOS es parte de la sintaxis):',
        '  services:\n    web:\n      image: nginx:alpine\n      ports:\n        - "8090:80"\n    db:\n      image: postgres:16\n      environment:\n        POSTGRES_PASSWORD: Secreto123\n      volumes:\n        - datos:/var/lib/postgresql/data\n  volumes:\n    datos:',
        '`docker compose up -d` lo levanta todo (en la carpeta del archivo).',
      ],
      objective: 'Crea ~/miproyecto/compose.yaml con web (nginx:alpine, 8090:80) y db (postgres:16 con volumen datos) y levántalo.',
      hints: ['Escribe el YAML con nano y luego docker compose up -d en esa carpeta.', 'Cuidado con los espacios: 2 por nivel.', `Escribe: mkdir -p ~/miproyecto && printf '${COMPOSE_BASIC.replace(/\n/g, '\\n').replace(/"/g, '\\"')}' > ~/miproyecto/compose.yaml && cd ~/miproyecto && docker compose up -d`],
      setup: (world) => {
        ensureDocker(world, true);
        removeContainers(world, 'miproyecto-*');
      },
      solution: `mkdir -p ~/miproyecto && printf '${COMPOSE_BASIC.replace(/\n/g, '\\n')}' > ~/miproyecto/compose.yaml && cd ~/miproyecto && docker compose up -d`,
      check: all(dockerCheck((s) => ['miproyecto-web-1', 'miproyecto-db-1'].every((n) => runningContainer(s, n))), responds('http://localhost:8090/', (r) => r.status === 200)),
      success: 'Dos servicios, una red y un volumen con un solo comando.',
      reward: rewardFor(4),
    },
    {
      id: 'docker-10-03',
      title: 'Ver el proyecto',
      difficulty: 2,
      teaches: [],
      briefing: ['`docker compose ps` lista los servicios del proyecto; `docker compose logs db` los logs de uno.'],
      objective: 'Muestra los logs del servicio db del proyecto.',
      hints: ['En ~/miproyecto: docker compose logs db', 'cd ~/miproyecto && docker compose logs db', 'Escribe: cd ~/miproyecto && docker compose logs db'],
      setup: (world) => {
        ensureDocker(world, true);
        plantFiles(world, { '~/miproyecto/compose.yaml': COMPOSE_BASIC });
      },
      solution: 'cd ~/miproyecto && docker compose up -d && docker compose logs db',
      check: outputMatches('docker', /ready to accept connections/),
      success: 'Logs con el prefijo de cada servicio. Muy cómodo para depurar varios contenedores.',
      reward: rewardFor(2),
    },
    {
      id: 'docker-10-04',
      title: 'Bajar el proyecto',
      difficulty: 2,
      teaches: [],
      briefing: [
        '`docker compose down` para y BORRA los contenedores y la red. Los volúmenes se conservan.',
        '`docker compose down -v` borra también los volúmenes (⚠ tus datos).',
      ],
      objective: 'Baja el proyecto miproyecto conservando los datos.',
      hints: ['down sin -v.', 'cd ~/miproyecto && docker compose down', 'Escribe: cd ~/miproyecto && docker compose down'],
      setup: (world) => {
        ensureDocker(world, true);
        plantFiles(world, { '~/miproyecto/compose.yaml': COMPOSE_BASIC });
      },
      solution: 'cd ~/miproyecto && docker compose up -d && docker compose down',
      check: dockerCheck((s) => !s.containers.some((c) => c.compose?.project === 'miproyecto') && s.volumes.miproyecto_datos !== undefined),
      success: 'Contenedores fuera, datos a salvo. docker compose up -d lo recupera todo.',
      reward: rewardFor(2),
    },
  ],
};

export const dockerChapter11: Chapter = {
  id: 'docker-11',
  number: 11,
  title: 'Compose avanzado',
  description: 'Healthchecks, dependencias, secretos en .env y builds.',
  missions: [
    {
      id: 'docker-11-01',
      title: 'Secretos fuera del YAML',
      difficulty: 3,
      teaches: [],
      briefing: [
        'El compose.yaml se sube a git; las contraseñas NO. Compose lee automáticamente un archivo .env de la carpeta:',
        '  .env:          DB_PASSWORD=Secreto123',
        '  compose.yaml:  POSTGRES_PASSWORD: ${DB_PASSWORD}',
      ],
      objective: 'En ~/miproyecto crea .env con DB_PASSWORD=Secreto123 y usa ${DB_PASSWORD} en compose.yaml; levanta el proyecto.',
      hints: ['echo "DB_PASSWORD=Secreto123" > .env y sed para cambiar la contraseña por ${DB_PASSWORD}.', "sed -i 's|POSTGRES_PASSWORD: Secreto123|POSTGRES_PASSWORD: ${DB_PASSWORD}|' ~/miproyecto/compose.yaml", "Escribe: echo 'DB_PASSWORD=Secreto123' > ~/miproyecto/.env && sed -i 's|POSTGRES_PASSWORD: Secreto123|POSTGRES_PASSWORD: ${DB_PASSWORD}|' ~/miproyecto/compose.yaml && cd ~/miproyecto && docker compose up -d"],
      setup: (world) => {
        ensureDocker(world, true);
        plantFiles(world, { '~/miproyecto/compose.yaml': COMPOSE_BASIC });
      },
      solution: "echo 'DB_PASSWORD=Secreto123' > ~/miproyecto/.env && sed -i 's|POSTGRES_PASSWORD: Secreto123|POSTGRES_PASSWORD: ${DB_PASSWORD}|' ~/miproyecto/compose.yaml && cd ~/miproyecto && docker compose up -d",
      check: all(
        (ctx) => /\$\{DB_PASSWORD\}/.test(ctx.fs.readFile(`${ctx.session.home}/miproyecto/compose.yaml`)) && isFile('~/miproyecto/.env')(ctx),
        dockerCheck((s) => runningContainer(s, 'miproyecto-db-1')?.env.POSTGRES_PASSWORD === 'Secreto123'),
      ),
      success: 'Y añade .env a tu .gitignore. Siempre.',
      reward: rewardFor(3),
    },
    {
      id: 'docker-11-02',
      title: 'Esperar a que esté sana',
      difficulty: 5,
      teaches: [],
      briefing: [
        'depends_on solo espera a que el contenedor ARRANQUE, no a que la base de datos esté LISTA.',
        'Con un healthcheck y la condición service_healthy, la API espera de verdad:',
        '  db:\n    healthcheck:\n      test: ["CMD-SHELL", "pg_isready -U postgres"]\n      interval: 5s\n  api:\n    depends_on:\n      db:\n        condition: service_healthy',
      ],
      objective: 'Crea ~/tienda/compose.yaml con db (postgres:16 + healthcheck pg_isready) y api (build: ./api, puerto 3000) que dependa de db sana. Levántalo con build.',
      hints: [
        'El proyecto de la API ya tiene Dockerfile en ~/tienda/api.',
        'docker compose up -d --build',
        "Escribe: printf 'services:\\n  db:\\n    image: postgres:16\\n    environment:\\n      POSTGRES_PASSWORD: Secreto123\\n    healthcheck:\\n      test: [\"CMD-SHELL\", \"pg_isready -U postgres\"]\\n      interval: 5s\\n  api:\\n    build: ./api\\n    ports:\\n      - \"3000:3000\"\\n    depends_on:\\n      db:\\n        condition: service_healthy\\n' > ~/tienda/compose.yaml && cd ~/tienda && docker compose up -d --build",
      ],
      setup: (world) => {
        ensureDocker(world, true);
        removeContainers(world, 'api', 'tienda-*');
        plantFiles(world, {
          '~/tienda/api/package.json': PACKAGE_JSON, '~/tienda/api/server.js': SERVER_JS,
          '~/tienda/api/Dockerfile': 'FROM node:20-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm install\nCOPY . .\nEXPOSE 3000\nUSER node\nCMD ["node", "server.js"]\n',
        });
        withMachine(world, (m) => {
          m.processes = m.processes.filter((p) => !p.ports?.includes(3000));
        });
      },
      solution: "printf 'services:\\n  db:\\n    image: postgres:16\\n    environment:\\n      POSTGRES_PASSWORD: Secreto123\\n    healthcheck:\\n      test: [\"CMD-SHELL\", \"pg_isready -U postgres\"]\\n      interval: 5s\\n  api:\\n    build: ./api\\n    ports:\\n      - \"3000:3000\"\\n    depends_on:\\n      db:\\n        condition: service_healthy\\n' > ~/tienda/compose.yaml && cd ~/tienda && docker compose up -d --build",
      check: all(
        dockerCheck((s) => runningContainer(s, 'tienda-db-1')?.health === 'healthy' && runningContainer(s, 'tienda-api-1') !== undefined),
        (ctx) => /condition:\s*service_healthy/.test(ctx.fs.readFile(`${ctx.session.home}/tienda/compose.yaml`)),
        responds('http://localhost:3000/', (r) => /"api":"tienda"/.test(r.body)),
      ),
      success: 'La API ya no arranca antes de que la base de datos acepte conexiones.',
      reward: rewardFor(5),
    },
    {
      id: 'docker-11-03',
      title: 'Siempre en pie',
      difficulty: 3,
      teaches: [],
      briefing: [
        '`restart: unless-stopped` hace que Docker reinicie el contenedor si se cae... y al reiniciar el servidor.',
        'Valores: no (defecto), always, on-failure, unless-stopped.',
      ],
      objective: 'Añade restart: unless-stopped a los servicios db y api de ~/tienda y vuelve a levantar.',
      hints: ["sed: después de cada 'image:' o 'build:' añade la línea.", "sed -i 's|^\\(    image: postgres:16\\)|\\1\\n    restart: unless-stopped|; s|^\\(    build: ./api\\)|\\1\\n    restart: unless-stopped|' ~/tienda/compose.yaml", "Escribe: sed -i 's|^\\(    image: postgres:16\\)|\\1\\n    restart: unless-stopped|; s|^\\(    build: ./api\\)|\\1\\n    restart: unless-stopped|' ~/tienda/compose.yaml && cd ~/tienda && docker compose up -d --build"],
      setup: (world) => ensureDocker(world, true),
      solution: "sed -i 's|^\\(    image: postgres:16\\)|\\1\\n    restart: unless-stopped|; s|^\\(    build: ./api\\)|\\1\\n    restart: unless-stopped|' ~/tienda/compose.yaml && cd ~/tienda && docker compose up -d --build",
      check: dockerCheck((s) => ['tienda-db-1', 'tienda-api-1'].every((n) => runningContainer(s, n)?.restart === 'unless-stopped')),
      success: 'Prueba: sudo systemctl restart docker → los dos vuelven solos.',
      reward: rewardFor(3),
    },
  ],
};

export const dockerChapter12: Chapter = {
  id: 'docker-12',
  number: 12,
  title: 'Registry propio',
  description: 'Tu propio "Docker Hub" privado.',
  missions: [
    {
      id: 'docker-12-01',
      title: 'Montar el registro',
      difficulty: 3,
      teaches: [],
      briefing: [
        'Las imágenes se distribuyen por un REGISTRO. Puedes tener el tuyo con la imagen oficial registry:2:',
        '  `docker run -d --name registro -p 5000:5000 --restart always registry:2`',
      ],
      objective: 'Arranca un registro privado (registry:2) llamado registro en el puerto 5000.',
      hints: ['docker run -d con -p 5000:5000.', 'docker run -d --name registro -p 5000:5000 --restart always registry:2', 'Escribe: docker run -d --name registro -p 5000:5000 --restart always registry:2'],
      setup: (world) => {
        ensureDocker(world);
        removeContainers(world, 'registro');
      },
      solution: 'docker run -d --name registro -p 5000:5000 --restart always registry:2',
      check: dockerCheck((s) => runningContainer(s, 'registro')?.ports.some((p) => p.host === 5000) ?? false),
      success: 'Registro privado en localhost:5000.',
      reward: rewardFor(3),
    },
    {
      id: 'docker-12-02',
      title: 'Etiquetar y subir',
      difficulty: 4,
      teaches: [],
      briefing: [
        'El nombre de la imagen indica a qué registro va: localhost:5000/api:1.0',
        '`docker tag api:1.0 localhost:5000/api:1.0` y `docker push localhost:5000/api:1.0`.',
        'Compruébalo con la API del registro: `curl localhost:5000/v2/_catalog`',
      ],
      objective: 'Sube la imagen api:1.0 a tu registro como localhost:5000/api:1.0.',
      hints: ['tag + push.', 'docker tag api:1.0 localhost:5000/api:1.0 && docker push localhost:5000/api:1.0', 'Escribe: docker tag api:1.0 localhost:5000/api:1.0 && docker push localhost:5000/api:1.0 && curl localhost:5000/v2/_catalog'],
      setup: (world) => {
        ensureDocker(world);
        ensureContainer(world, 'registro', 'registry:2', { ports: [[5000, 5000]] });
        apiProject(world, { '~/api/Dockerfile': 'FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nRUN npm install\nEXPOSE 3000\nCMD ["node", "server.js"]\n' });
      },
      solution: 'cd ~/api && docker build -t api:1.0 . && docker tag api:1.0 localhost:5000/api:1.0 && docker push localhost:5000/api:1.0 && curl localhost:5000/v2/_catalog',
      check: dockerCheck((s) => (s.pushed['localhost:5000'] ?? []).includes('api:1.0')),
      success: 'Cualquier servidor de tu red puede hacer ahora: docker pull localhost:5000/api:1.0 (en el CI/CD lo usarás).',
      reward: rewardFor(4),
    },
  ],
};

export const dockerChapter13: Chapter = {
  id: 'docker-13',
  number: 13,
  title: 'Seguridad y limpieza',
  description: 'Contenedores con mínimos privilegios y un disco sin basura.',
  missions: [
    {
      id: 'docker-13-01',
      title: 'Contenedor blindado',
      difficulty: 4,
      teaches: [],
      briefing: [
        'Opciones de seguridad de docker run:',
        '  `--read-only`        sistema de archivos de solo lectura (un atacante no puede escribir)',
        '  `--user 1000:1000`   sin root',
        '  `--memory 256m`      límite de RAM (un fallo no tumba el servidor)',
      ],
      objective: 'Arranca alpine ("seguro", sleep infinity) en solo lectura, como usuario 1000 y con 256m de memoria.',
      hints: ['docker run -d --name seguro --read-only --user 1000 --memory 256m alpine sleep infinity', 'Las tres opciones en el mismo run.', 'Escribe: docker run -d --name seguro --read-only --user 1000 --memory 256m alpine sleep infinity'],
      setup: (world) => {
        ensureDocker(world);
        removeContainers(world, 'seguro');
      },
      solution: 'docker run -d --name seguro --read-only --user 1000 --memory 256m alpine sleep infinity',
      check: dockerCheck((s) => {
        const c = runningContainer(s, 'seguro');
        return !!c && c.readOnly && c.user.startsWith('1000') && c.memoryMB === 256;
      }),
      success: 'Prueba: docker exec seguro touch /x → "Read-only file system".',
      reward: rewardFor(4),
    },
    {
      id: 'docker-13-02',
      title: '¿Cuánto ocupa Docker?',
      difficulty: 2,
      teaches: [],
      briefing: ['`docker system df` resume el espacio de imágenes, contenedores, volúmenes y caché de build.'],
      objective: 'Muestra el uso de disco de Docker.',
      hints: ['docker system df', 'docker system df', 'Escribe: docker system df'],
      setup: (world) => ensureDocker(world),
      solution: 'docker system df',
      check: ran('docker', (a) => a[0] === 'system' && a[1] === 'df'),
      success: 'La columna RECLAIMABLE es lo que podrías liberar.',
      reward: rewardFor(2),
    },
    {
      id: 'docker-13-03',
      title: 'Limpieza',
      difficulty: 3,
      teaches: [],
      briefing: [
        '`docker container prune` borra los contenedores parados; `docker image prune` las imágenes "colgantes" (<none>);',
        '`docker system prune` todo lo anterior. Con -a también las imágenes sin usar. Con -f no pregunta.',
      ],
      objective: 'Elimina todos los contenedores parados con un prune.',
      hints: ['docker container prune -f', 'O docker system prune -f', 'Escribe: docker container prune -f'],
      setup: (world) => {
        ensureDocker(world);
        withMachine(world, (m) => {
          const s = dockerState(m);
          if (!s.containers.some((c) => c.status === 'exited')) {
            s.containers.push({ id: 'dead1234567890', name: 'viejo', image: 'hello-world', imageId: s.images[0]?.id ?? 'x', status: 'exited', exitCode: 0, created: world.fs.now() - 86_400_000, started: 0, ports: [], env: {}, mounts: [], networks: ['bridge'], cmd: ['/hello'], restart: 'no', logs: [], writes: {}, user: 'root', readOnly: false, memoryMB: null });
          }
        });
      },
      solution: 'docker container prune -f',
      check: dockerCheck((s) => !s.containers.some((c) => c.status === 'exited')),
      success: 'En servidores con CI/CD, Docker puede llenar el disco en días: programa un prune semanal con cron.',
      reward: rewardFor(3),
    },
  ],
};

const NGINX_PROXY_CONF = 'server {\n    listen 80;\n    location /api/ {\n        proxy_pass http://api:3000/;\n    }\n    location / {\n        root /usr/share/nginx/html;\n    }\n}\n';

export const dockerChapter14: Chapter = {
  id: 'docker-14',
  number: 14,
  title: 'Docker + Nginx',
  description: 'nginx como puerta de entrada a tus contenedores.',
  missions: [
    {
      id: 'docker-14-01',
      title: 'nginx del host delante de un contenedor',
      difficulty: 4,
      teaches: [],
      briefing: [
        'Patrón clásico: el contenedor publica su puerto SOLO en localhost (-p 127.0.0.1:3000:3000)',
        'y el nginx del servidor hace de proxy inverso (con HTTPS, caché...).',
        'Haz que api.devops-u.com (nginx del host) apunte al contenedor de la API en el 3000.',
      ],
      objective: 'Arranca el contenedor api (api:1.0) en el 3000 y haz que http://api.devops-u.com le llegue a través del nginx del host.',
      hints: [
        'Contenedor con -p 3000:3000; sitio nginx con proxy_pass http://127.0.0.1:3000;',
        "printf 'server {\\n    listen 80;\\n    server_name api.devops-u.com;\\n    location / {\\n        proxy_pass http://127.0.0.1:3000;\\n    }\\n}\\n' | sudo tee /etc/nginx/sites-available/api",
        "Escribe: docker run -d --name api -p 3000:3000 api:1.0 && printf 'server {\\n    listen 80;\\n    server_name api.devops-u.com;\\n    location / {\\n        proxy_pass http://127.0.0.1:3000;\\n    }\\n}\\n' | sudo tee /etc/nginx/sites-available/api && sudo ln -sf /etc/nginx/sites-available/api /etc/nginx/sites-enabled/api && sudo nginx -t && sudo systemctl reload nginx",
      ],
      setup: (world) => {
        ensureDocker(world);
        removeContainers(world, 'api', 'tienda-*');
        withMachine(world, (m) => {
          m.processes = m.processes.filter((p) => !p.ports?.includes(3000));
        });
        apiProject(world, { '~/api/Dockerfile': 'FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nRUN npm install\nEXPOSE 3000\nCMD ["node", "server.js"]\n' });
        removeSite(world, 'api');
        ensureNginx(world);
      },
      solution: "cd ~/api && docker build -t api:1.0 . && docker run -d --name api -p 3000:3000 api:1.0 && printf 'server {\\n    listen 80;\\n    server_name api.devops-u.com;\\n    location / {\\n        proxy_pass http://127.0.0.1:3000;\\n    }\\n}\\n' | sudo tee /etc/nginx/sites-available/api && sudo ln -sf /etc/nginx/sites-available/api /etc/nginx/sites-enabled/api && sudo nginx -t && sudo systemctl reload nginx",
      check: responds('http://api.devops-u.com/', (r) => /"api":"tienda"/.test(r.body)),
      success: 'nginx (host) → contenedor. Lo mejor de los dos mundos.',
      reward: rewardFor(4),
    },
    {
      id: 'docker-14-02',
      title: 'nginx también en contenedor',
      difficulty: 5,
      teaches: [],
      briefing: [
        'Otra opción: nginx en un contenedor, en la misma red que la app, con su configuración montada:',
        '  -v ~/proxy/default.conf:/etc/nginx/conf.d/default.conf:ro',
        'Dentro de la red, el proxy_pass usa el NOMBRE del contenedor: http://api:3000/',
      ],
      objective: 'Red "app"; contenedor api (api:1.0) en ella; y contenedor "proxy" (nginx, puerto 8088) en la misma red con ~/proxy/default.conf montado.',
      hints: [
        'La configuración ya está en ~/proxy/default.conf. Crea la red y los dos contenedores.',
        'docker network create app && docker run -d --name api --network app api:1.0',
        'Escribe: docker network create app && docker run -d --name api --network app api:1.0 && docker run -d --name proxy --network app -p 8088:80 -v ~/proxy/default.conf:/etc/nginx/conf.d/default.conf:ro nginx',
      ],
      setup: (world) => {
        ensureDocker(world);
        removeContainers(world, 'api', 'proxy');
        withMachine(world, (m) => {
          delete dockerState(m).networks.app;
        });
        apiProject(world, { '~/api/Dockerfile': 'FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nRUN npm install\nEXPOSE 3000\nCMD ["node", "server.js"]\n' });
        plantFiles(world, { '~/proxy/default.conf': NGINX_PROXY_CONF });
      },
      solution: 'cd ~/api && docker build -t api:1.0 . && docker network create app && docker run -d --name api --network app api:1.0 && docker run -d --name proxy --network app -p 8088:80 -v ~/proxy/default.conf:/etc/nginx/conf.d/default.conf:ro nginx',
      check: responds('http://localhost:8088/api/pedidos', (r) => /"api":"tienda"/.test(r.body)),
      success: 'El contenedor de la API ni siquiera publica puertos: solo el proxy es accesible desde fuera.',
      reward: rewardFor(5),
    },
  ],
};

const BOSS_COMPOSE = `services:
  proxy:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./proxy/default.conf:/etc/nginx/conf.d/default.conf:ro
    networks:
      - frontend
    depends_on:
      - api
    restart: unless-stopped
  api:
    build: ./api
    environment:
      DB_HOST: db
      REDIS_HOST: cache
      DB_PASSWORD: \${DB_PASSWORD}
    networks:
      - frontend
      - backend
    depends_on:
      db:
        condition: service_healthy
      cache:
        condition: service_started
    restart: unless-stopped
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: \${DB_PASSWORD}
    volumes:
      - db-data:/var/lib/postgresql/data
    networks:
      - backend
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
    restart: unless-stopped
  cache:
    image: redis:7-alpine
    networks:
      - backend
    restart: unless-stopped
volumes:
  db-data:
networks:
  frontend:
  backend:
`;

export const dockerChapter15: Chapter = {
  id: 'docker-15',
  number: 15,
  title: 'JEFE FINAL: Proyecto completo',
  description: 'Nginx + API + PostgreSQL + Redis, con redes aisladas, healthchecks y backups.',
  missions: [
    {
      id: 'docker-15-01',
      title: 'La arquitectura completa',
      difficulty: 5,
      boss: true,
      teaches: [],
      briefing: [
        '══ MISIÓN FINAL DE DOCKER ══ (carpeta ~/produccion, ya tiene api/, proxy/default.conf y .env)',
        'Escribe ~/produccion/compose.yaml con 4 servicios:',
        '  · proxy: nginx:alpine, puerto 80, conf montada (solo lectura), red frontend',
        '  · api:   build ./api, redes frontend y backend, espera a db SANA',
        '  · db:    postgres:16, contraseña desde .env (${DB_PASSWORD}), volumen db-data, healthcheck, red backend',
        '  · cache: redis:7-alpine, red backend',
        'Todos con restart: unless-stopped. La base de datos y redis NO deben estar en la red frontend.',
        'Si los puertos 80 están ocupados por el nginx del host, páralo antes (sudo systemctl stop nginx).',
      ],
      objective: 'Levanta el proyecto ~/produccion con proxy, api, db y cache, redes aisladas y healthcheck.',
      hints: [
        'Dos redes (frontend, backend); solo api está en las dos. db con healthcheck y volumen.',
        'Para liberar el 80: sudo systemctl stop nginx. Luego: docker compose up -d --build',
        "Escribe el archivo con nano (la estructura completa está en el briefing) y: sudo systemctl stop nginx && cd ~/produccion && docker compose up -d --build",
      ],
      setup: (world) => {
        ensureDocker(world, true);
        removeContainers(world, 'produccion-*', 'api', 'proxy');
        plantFiles(world, {
          '~/produccion/api/package.json': PACKAGE_JSON, '~/produccion/api/server.js': SERVER_JS,
          '~/produccion/api/Dockerfile': 'FROM node:20-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm install --omit=dev\nCOPY . .\nUSER node\nEXPOSE 3000\nCMD ["node", "server.js"]\n',
          '~/produccion/proxy/default.conf': NGINX_PROXY_CONF,
          '~/produccion/.env': 'DB_PASSWORD=Pr0duccion!\n',
        });
      },
      solution: `sudo systemctl stop nginx; printf '${BOSS_COMPOSE.replace(/\n/g, '\\n').replace(/"/g, '\\"')}' > ~/produccion/compose.yaml && cd ~/produccion && docker compose up -d --build`,
      check: all(
        dockerCheck((s) => ['proxy', 'api', 'db', 'cache'].every((svc) => runningContainer(s, `produccion-${svc}-1`)?.restart === 'unless-stopped')),
        dockerCheck((s) => {
          const db = runningContainer(s, 'produccion-db-1');
          const cache = runningContainer(s, 'produccion-cache-1');
          const api = runningContainer(s, 'produccion-api-1');
          return !!db && !!cache && !!api && !db.networks.includes('produccion_frontend') && !cache.networks.includes('produccion_frontend') && api.networks.includes('produccion_frontend') && api.networks.includes('produccion_backend') && db.health === 'healthy' && db.mounts.some((m) => m.source === 'produccion_db-data');
        }),
        responds('http://localhost/api/estado', (r) => /"api":"tienda"/.test(r.body)),
      ),
      success: 'Arquitectura de producción levantada con un comando. Falta una cosa: las copias de seguridad.',
      reward: rewardFor(5, true),
    },
    {
      id: 'docker-15-02',
      title: 'Backup del volumen',
      difficulty: 5,
      boss: true,
      teaches: [],
      briefing: [
        'Los datos de PostgreSQL viven en el volumen produccion_db-data. Patrón estándar para copiarlo:',
        'un contenedor temporal que monta el volumen y una carpeta del host, y hace un tar:',
        '  `docker run --rm -v produccion_db-data:/datos -v ~/backups:/backup alpine tar czf /backup/db.tar.gz /datos`',
      ],
      objective: 'Haz una copia del volumen produccion_db-data en ~/backups/db.tar.gz con un contenedor temporal.',
      hints: ['Contenedor alpine con --rm y dos -v: el volumen y ~/backups.', 'tar czf /backup/db.tar.gz /datos dentro del contenedor.', 'Escribe: mkdir -p ~/backups && docker run --rm -v produccion_db-data:/datos -v ~/backups:/backup alpine tar czf /backup/db.tar.gz /datos'],
      setup: (world) => ensureDocker(world, true),
      solution: 'mkdir -p ~/backups && docker run --rm -v produccion_db-data:/datos -v ~/backups:/backup alpine tar czf /backup/db.tar.gz /datos',
      check: (ctx) => isFile('~/backups/db.tar.gz')(ctx) && /PG_VERSION/.test(ctx.fs.readFile(`${ctx.session.home}/backups/db.tar.gz`)),
      success: '🏆 PROYECTO EN CONTENEDORES COMPLETO. Eres CONTAINER CAPTAIN. Siguiente carrera: Git y GitHub.',
      reward: rewardFor(5, true),
    },
  ],
};

export const DOCKER_CHAPTERS: readonly Chapter[] = [
  dockerChapter01, dockerChapter02, dockerChapter03, dockerChapter04, dockerChapter05, dockerChapter06, dockerChapter07, dockerChapter08,
  dockerChapter09, dockerChapter10, dockerChapter11, dockerChapter12, dockerChapter13, dockerChapter14, dockerChapter15,
];
