/**
 * Biblioteca de manuales del juego.
 *
 * Implementa `ManualProvider` del motor: decide si un manual está
 * desbloqueado y lo formatea como una página de `man` para la terminal.
 */
import type { ManualLookup, ManualProvider } from '../../engine/commands/system/man';
import type { CommandDoc } from './CommandDoc';

const C = { title: '\x1b[1;32m', section: '\x1b[1m', code: '\x1b[1;36m', dim: '\x1b[2m', reset: '\x1b[0m' };

export class ManualLibrary implements ManualProvider {
  private readonly docs: Map<string, CommandDoc>;
  private readonly isUnlocked: (name: string) => boolean;

  constructor(docs: readonly CommandDoc[], isUnlocked: (name: string) => boolean) {
    this.docs = new Map(docs.map((d) => [d.name, d]));
    this.isUnlocked = isUnlocked;
  }

  /** Documento de un comando (sin comprobar si está desbloqueado). */
  get(name: string): CommandDoc | undefined {
    return this.docs.get(name);
  }

  /** Todos los documentos, en orden alfabético. */
  list(): CommandDoc[] {
    return [...this.docs.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  lookup(name: string, useColor: boolean): ManualLookup {
    const doc = this.docs.get(name);
    if (!doc) return { status: 'missing' };
    if (!this.isUnlocked(name)) return { status: 'locked' };
    return { status: 'ok', text: renderManPage(doc, useColor) };
  }
}

/** Formatea un documento con el estilo clásico de `man`. */
export function renderManPage(doc: CommandDoc, useColor: boolean): string {
  const paint = (color: string, text: string): string => (useColor ? `${color}${text}${C.reset}` : text);
  const code = (text: string): string => text.replace(/`([^`]+)`/g, (_m, inner: string) => paint(C.code, inner));
  const indent = '       ';
  const lines: string[] = [];

  const header = `${doc.name.toUpperCase()}(1)`;
  lines.push(paint(C.title, `${header}${' '.repeat(Math.max(2, 40 - header.length))}Manual de DevOps University`), '');
  lines.push(paint(C.section, 'NOMBRE'), `${indent}${doc.name} - ${doc.summary}`, '');
  lines.push(paint(C.section, 'SINOPSIS'), `${indent}${paint(C.code, doc.synopsis)}`, '');
  lines.push(paint(C.section, 'DESCRIPCIÓN'), ...doc.description.map((p) => indent + code(p)), '');

  if (doc.options?.length) {
    lines.push(paint(C.section, 'OPCIONES'));
    for (const option of doc.options) lines.push(`${indent}${paint(C.code, option.flag)}`, `${indent}       ${option.description}`);
    lines.push('');
  }

  lines.push(paint(C.section, 'EJEMPLOS'));
  for (const example of doc.examples) {
    lines.push(`${indent}${paint(C.code, '$ ' + example.command)}`, `${indent}       ${paint(C.dim, example.explanation)}`);
  }
  if (doc.tip) lines.push('', paint(C.section, 'CONSEJO DE N0X'), `${indent}${code(doc.tip)}`);
  return lines.join('\n') + '\n';
}
