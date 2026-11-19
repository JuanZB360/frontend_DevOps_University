/**
 * Ayudante para escribir manuales de forma compacta.
 */
import type { CommandDoc } from '../../manual/CommandDoc';

export function doc(
  name: string,
  summary: string,
  synopsis: string,
  description: string[],
  options: [string, string][],
  examples: [string, string][],
  tip?: string,
): CommandDoc {
  return {
    name,
    summary,
    synopsis,
    description,
    options: options.length ? options.map(([flag, d]) => ({ flag, description: d })) : undefined,
    examples: examples.map(([command, explanation]) => ({ command, explanation })),
    tip,
  };
}

/** El mismo manual para un alias (ej. egrep → grep -E). */
export function alias(name: string, of: CommandDoc, note: string): CommandDoc {
  return { ...of, name, summary: `${of.summary} (${note})` };
}
