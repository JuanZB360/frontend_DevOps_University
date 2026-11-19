/**
 * Expansión de comodines (globbing): *, ? y [abc].
 *
 * Dentro del patrón, un carácter precedido de \ es literal: así el expansor
 * marca los comodines que venían entre comillas y NO deben expandirse.
 */
import type { VirtualFileSystem } from '../vfs/VirtualFileSystem';
import { joinPath, resolvePath } from '../vfs/path';

/** ¿El patrón contiene algún comodín sin escapar? */
export function hasGlob(pattern: string): boolean {
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '\\') {
      i++;
      continue;
    }
    if ('*?['.includes(pattern[i])) return true;
  }
  return false;
}

/** Quita los escapes del patrón: 'a\*b' → 'a*b'. */
export function unescapeGlob(pattern: string): string {
  return pattern.replace(/\\(.)/g, '$1');
}

/** Convierte un segmento de patrón (sin '/') en una expresión regular anclada. */
function segmentToRegExp(segment: string): RegExp {
  let source = '';
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (ch === '\\' && i + 1 < segment.length) {
      source += escapeRegExp(segment[++i]);
    } else if (ch === '*') {
      source += '.*';
    } else if (ch === '?') {
      source += '.';
    } else if (ch === '[') {
      const end = segment.indexOf(']', i + 2);
      if (end === -1) {
        source += '\\[';
        continue;
      }
      let body = segment.slice(i + 1, end);
      if (body.startsWith('!') || body.startsWith('^')) body = '^' + body.slice(1);
      source += `[${body.replace(/\\/g, '\\\\')}]`;
      i = end;
    } else {
      source += escapeRegExp(ch);
    }
  }
  return new RegExp(`^${source}$`);
}

function escapeRegExp(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Expande un patrón contra el VFS. Devuelve las coincidencias en el mismo
 * formato que se escribieron (relativas o absolutas), ordenadas.
 * Si no hay coincidencias devuelve [] (el expansor decidirá qué hacer).
 *
 * Igual que bash, `*` no coincide con archivos ocultos salvo que el patrón
 * empiece por '.'.
 */
export function expandGlob(pattern: string, cwd: string, fs: VirtualFileSystem): string[] {
  const absolute = pattern.startsWith('/');
  const segments = pattern.split('/').filter((s, i) => s !== '' || i === 0);
  // Cada candidato guarda la ruta mostrada al usuario y la absoluta real.
  let candidates: { shown: string; abs: string }[] = [{ shown: absolute ? '/' : '', abs: absolute ? '/' : cwd }];

  for (const segment of segments) {
    if (segment === '') continue;
    const next: { shown: string; abs: string }[] = [];
    for (const candidate of candidates) {
      if (!hasGlob(segment)) {
        const literal = unescapeGlob(segment);
        const abs = resolvePath(candidate.abs, literal);
        if (fs.exists(abs) || fs.tryStat(abs, false)) next.push({ shown: join(candidate.shown, literal), abs });
        continue;
      }
      if (!fs.isDirectory(candidate.abs) || !fs.canAccess(candidate.abs, 'r')) continue;
      const regex = segmentToRegExp(segment);
      const allowHidden = segment.startsWith('.');
      for (const child of fs.readDir(candidate.abs)) {
        if (child.name.startsWith('.') && !allowHidden) continue;
        if (regex.test(child.name)) {
          next.push({ shown: join(candidate.shown, child.name), abs: joinPath(candidate.abs, child.name) });
        }
      }
    }
    candidates = next;
    if (candidates.length === 0) return [];
  }

  // Un patrón terminado en '/' solo debe devolver directorios.
  const onlyDirs = pattern.endsWith('/');
  return candidates
    .filter((c) => !onlyDirs || fs.isDirectory(c.abs))
    .map((c) => (onlyDirs ? c.shown + '/' : c.shown))
    .sort();
}

function join(base: string, name: string): string {
  if (base === '') return name;
  return base.endsWith('/') ? base + name : `${base}/${name}`;
}
