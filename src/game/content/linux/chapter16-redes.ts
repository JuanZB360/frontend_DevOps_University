/**
 * Capítulo 16 — Redes.
 * ip, ping, DNS (dig/host), curl, ss y /etc/hosts.
 */
import { LOCAL_IP } from '../../../engine/system/network';
import { rewardFor, type Chapter } from '../../domain/curriculum';
import { all, noProcessMatching, outputEquals, outputMatches, ran, ranWithFlag, systemFileMatches } from '../../missions/checks';
import { ensureProcess, withMachine } from '../../missions/worldHelpers';

export const chapter16: Chapter = {
  id: 'linux-16',
  number: 16,
  title: 'Redes',
  description: 'IPs, DNS, puertos y HTTP: cómo habla tu servidor con el mundo.',
  missions: [
    {
      id: 'linux-16-01',
      title: 'Tu dirección',
      difficulty: 2,
      teaches: ['ip', 'hostname'],
      briefing: [
        '`ip a` (ip address) muestra las interfaces de red y sus IPs.',
        '"lo" es el loopback (127.0.0.1, el propio equipo) y "eth0" la tarjeta de red real.',
        'Atajo: `hostname -I` muestra solo las IPs.',
      ],
      objective: 'Averigua la IP de eth0 y escríbela con echo (solo la IP, sin el /24).',
      hints: ['ip a y busca "inet" dentro de eth0.', `La IP es la que va antes de /24.`, `Escribe: echo ${LOCAL_IP}`],
      solution: `ip a; echo ${LOCAL_IP}`,
      check: outputEquals('echo', LOCAL_IP),
      success: `${LOCAL_IP}: una IP privada (10.x.x.x). Desde Internet se llega a través de una IP pública.`,
      reward: rewardFor(2),
    },
    {
      id: 'linux-16-02',
      title: '¿Hay alguien ahí?',
      difficulty: 2,
      teaches: ['ping', 'traceroute'],
      briefing: [
        '`ping host` envía paquetes y mide si responde y cuánto tarda (ms).',
        'En Linux no se para solo: usa `-c 3` para enviar solo 3 paquetes.',
        '`traceroute host` muestra los "saltos" (routers) por los que pasa el camino.',
      ],
      objective: 'Haz ping a google.com enviando exactamente 3 paquetes.',
      hints: ['La opción -c indica cuántos paquetes.', 'ping -c 3 google.com', 'Escribe: ping -c 3 google.com'],
      solution: 'ping -c 3 google.com',
      check: all(ran('ping', (args) => args.includes('google.com')), ranWithFlag('ping', 'c')),
      success: '0% packet loss: hay conexión a Internet. Es la primera prueba ante cualquier problema de red.',
      reward: rewardFor(2),
    },
    {
      id: 'linux-16-03',
      title: 'El listín telefónico',
      difficulty: 2,
      teaches: ['dig', 'nslookup', 'host'],
      briefing: [
        'El DNS traduce nombres (github.com) a IPs (140.82.121.4).',
        '`dig dominio` muestra la respuesta completa; `dig +short dominio` solo la IP.',
        '"It\'s always DNS": una enorme cantidad de incidencias reales son problemas de DNS.',
      ],
      objective: 'Averigua la IP de github.com con dig +short.',
      hints: ['dig con la opción +short.', 'dig +short github.com', 'Escribe: dig +short github.com'],
      solution: 'dig +short github.com',
      check: outputMatches('dig', /^140\.82\.121\.4$/m),
      success: 'Resuelto. Si un día una web "no carga", comprueba primero si resuelve su nombre.',
      reward: rewardFor(2),
    },
    {
      id: 'linux-16-04',
      title: 'Hablar HTTP',
      difficulty: 3,
      teaches: ['curl', 'wget'],
      briefing: [
        '`curl URL` hace una petición HTTP y muestra la respuesta. Imprescindible para probar APIs y webs.',
        '`curl -I URL` solo muestra las cabeceras (código de estado, servidor, tipo de contenido...).',
        '`wget URL` descarga archivos.',
      ],
      objective: 'Muestra solo las cabeceras de http://example.com',
      hints: ['curl con la opción de cabeceras (I mayúscula).', 'curl -I http://example.com', 'Escribe: curl -I http://example.com'],
      solution: 'curl -I http://example.com',
      check: all(ranWithFlag('curl', 'I', 'head'), outputMatches('curl', /HTTP\/1\.1 200/)),
      success: '200 OK. Los códigos que más verás: 200 bien, 301 redirección, 403 prohibido, 404 no existe, 502 backend caído.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-16-05',
      title: 'Puertos abiertos',
      difficulty: 3,
      teaches: ['ss', 'netstat'],
      briefing: [
        'Cada servicio escucha en un PUERTO: SSH el 22, HTTP el 80, HTTPS el 443, PostgreSQL el 5432...',
        '`ss -tulpn` lista lo que está escuchando: t=TCP, u=UDP, l=escuchando, p=proceso, n=números.',
        'Para ver qué programa usa cada puerto necesitas sudo.',
      ],
      objective: 'Lista los puertos en escucha con el proceso que los usa.',
      hints: ['ss con las opciones -tulpn, como root.', 'sudo ss -tulpn', 'Escribe: sudo ss -tulpn'],
      solution: 'sudo ss -tulpn',
      check: all(ran('ss'), outputMatches('ss', /sshd/)),
      success: 'El puerto 22 es de sshd. Cualquier puerto abierto que no reconozcas es una alarma.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-16-06',
      title: 'Nombres locales',
      difficulty: 3,
      teaches: [],
      briefing: [
        '/etc/hosts asigna nombres a IPs SIN preguntar al DNS. Tiene prioridad sobre él.',
        'Formato: `IP  nombre  [alias...]`',
        'Muy útil para servidores internos: `10.0.0.20  db.interna`',
      ],
      objective: 'Haz que el nombre db.interna apunte a 10.0.0.20 (y compruébalo con ping -c 1 db.interna).',
      hints: ['Añade una línea a /etc/hosts como root (tee -a).', "echo '10.0.0.20 db.interna' | sudo tee -a /etc/hosts", "Escribe: echo '10.0.0.20 db.interna' | sudo tee -a /etc/hosts && ping -c 1 db.interna"],
      setup: (world) => world.fs.privileged(() => {
        const hosts = world.fs.readFile('/etc/hosts').split('\n').filter((l) => !l.includes('db.interna')).join('\n');
        world.fs.writeFile('/etc/hosts', hosts.endsWith('\n') ? hosts : hosts + '\n');
      }),
      solution: "echo '10.0.0.20 db.interna' | sudo tee -a /etc/hosts && ping -c 1 db.interna",
      check: systemFileMatches('/etc/hosts', /^10\.0\.0\.20\s+.*\bdb\.interna\b/m),
      success: 'Ahora tus scripts pueden usar "db.interna" en lugar de memorizar IPs.',
      reward: rewardFor(3),
    },
    {
      id: 'linux-16-07',
      title: 'JEFE: ¿Quién usa el puerto 8080?',
      difficulty: 5,
      boss: true,
      teaches: ['lsof'],
      briefing: [
        '⚠ La nueva API no arranca: "bind() to 0.0.0.0:8080 failed (Address already in use)".',
        'Algún proceso olvidado ocupa el puerto 8080. Encuéntralo y libéralo.',
        'Herramientas: `sudo ss -tlnp` o `sudo lsof -i :8080` te dicen el PID.',
      ],
      objective: 'Libera el puerto 8080 terminando el proceso que lo ocupa.',
      hints: [
        'sudo lsof -i :8080 muestra el PID del culpable.',
        'Termínalo con sudo kill PID.',
        "Escribe: sudo kill $(sudo lsof -i :8080 | awk 'NR > 1 {print $2}')",
      ],
      setup: (world) => {
        ensureProcess(world, { user: 'root', command: 'node /opt/legacy/server.js', cpu: 1.2, mem: 2.1, rss: 85_000, ports: [8080] });
        withMachine(world, () => undefined);
      },
      solution: "sudo kill $(sudo lsof -i :8080 | awk 'NR > 1 {print $2}')",
      check: all(noProcessMatching(/legacy\/server\.js/), (ctx) => ctx.report.commands.some((c) => c.name === 'kill' || c.name === 'pkill' || c.name === 'killall')),
      success: 'Puerto libre. Era un servidor antiguo que nadie recordaba. Clásico.',
      reward: rewardFor(5, true),
    },
  ],
};
