/**
 * Datos de práctica deterministas (logs, listas, configuraciones) para las
 * misiones. Al ser fijos, las misiones pueden comprobar respuestas exactas.
 */

/** Generador pseudoaleatorio con semilla (siempre produce lo mismo). */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 2_147_483_648;
  };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Log de una aplicación: 60 líneas INFO/WARN/ERROR. La última contiene la clave. */
export const APP_LOG_LINES: string[] = (() => {
  const rand = seeded(7);
  const messages = {
    INFO: ['Petición atendida en 32ms', 'Usuario autenticado', 'Caché actualizada', 'Conexión a la base de datos OK', 'Tarea programada completada'],
    WARN: ['Uso de memoria al 81%', 'Respuesta lenta de la API de pagos (2300ms)', 'Reintento de conexión'],
    ERROR: ['No se pudo escribir en /var/data: disco lleno', 'Timeout conectando a db01:5432', 'NullPointerException en PedidoService'],
  };
  const lines: string[] = [];
  for (let i = 0; i < 59; i++) {
    const r = rand();
    const level = r < 0.7 ? 'INFO' : r < 0.85 ? 'WARN' : 'ERROR';
    const list = messages[level];
    lines.push(`2024-11-16 ${pad(8 + Math.floor(i / 6))}:${pad((i * 7) % 60)}:${pad((i * 13) % 60)} [${level}] ${list[Math.floor(rand() * list.length)]}`);
  }
  lines.push('2024-11-16 18:00:00 [INFO] Fin del turno. Clave de acceso: KERNEL');
  return lines;
})();

export const APP_LOG = APP_LOG_LINES.join('\n') + '\n';

/** IPs y su número de peticiones en access.log (cantidades distintas: sin empates). */
export const ACCESS_COUNTS: [string, number][] = [
  ['203.0.113.7', 41],
  ['198.51.100.23', 33],
  ['192.0.2.150', 27],
  ['203.0.113.99', 19],
  ['198.51.100.4', 14],
  ['192.0.2.8', 9],
  ['10.0.0.5', 6],
  ['203.0.113.250', 3],
];

export const TOP5_IPS = ACCESS_COUNTS.slice(0, 5).map(([ip]) => ip);

/** access.log en formato combinado de Nginx/Apache, mezclado de forma determinista. */
export const ACCESS_LOG: string = (() => {
  const rand = seeded(42);
  const paths = ['/', '/login', '/api/pedidos', '/api/usuarios', '/static/app.js', '/favicon.ico', '/admin', '/wp-login.php'];
  const statuses = [200, 200, 200, 200, 304, 404, 500, 302];
  const entries: string[] = [];
  for (const [ip, count] of ACCESS_COUNTS) for (let i = 0; i < count; i++) entries.push(ip);
  // Mezcla determinista
  for (let i = entries.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [entries[i], entries[j]] = [entries[j], entries[i]];
  }
  return entries.map((ip, i) => {
    const path = paths[Math.floor(rand() * paths.length)];
    const status = statuses[Math.floor(rand() * statuses.length)];
    const size = 200 + Math.floor(rand() * 9000);
    return `${ip} - - [16/Nov/2024:${pad(10 + Math.floor(i / 20))}:${pad(i % 60)}:${pad((i * 7) % 60)} +0000] "GET ${path} HTTP/1.1" ${status} ${size} "-" "Mozilla/5.0"`;
  }).join('\n') + '\n';
})();

/** Ventas por producto (para awk). */
export const SALES_CSV = [
  'producto,unidades,precio',
  'teclado,12,25',
  'raton,30,10',
  'monitor,5,180',
  'cable-hdmi,40,6',
  'webcam,8,45',
].join('\n') + '\n';

/** Total de unidades vendidas (suma de la 2.ª columna). */
export const SALES_UNITS = 12 + 30 + 5 + 40 + 8;

/** Usuarios para practicar sort/uniq (con repetidos). */
export const VISITORS = ['luis', 'ana', 'marta', 'ana', 'pedro', 'luis', 'ana', 'zoe', 'marta', 'ana'];
