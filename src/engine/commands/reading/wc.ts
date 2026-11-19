/**
 * wc — cuenta líneas, palabras y bytes.
 *   -l  líneas   -w  palabras   -c  bytes
 * Sin opciones muestra las tres. Con varios archivos añade una línea "total".
 */
import type { Command } from '../Command';
import { EXIT_USAGE, parseOrFail, readInputs } from '../helpers';

const SPECS = [
  { key: 'lines', short: 'l', long: 'lines' },
  { key: 'words', short: 'w', long: 'words' },
  { key: 'bytes', short: 'c', long: 'bytes' },
] as const;

const encoder = new TextEncoder();

interface Counts {
  lines: number;
  words: number;
  bytes: number;
}

function count(text: string): Counts {
  return {
    lines: (text.match(/\n/g) ?? []).length,
    words: text.split(/\s+/).filter(Boolean).length,
    bytes: encoder.encode(text).length,
  };
}

export const wcCommand: Command = {
  name: 'wc',
  category: 'lectura',
  summary: 'Cuenta líneas, palabras y bytes',
  execute(ctx) {
    const options = parseOrFail(ctx, SPECS);
    if (!options) return EXIT_USAGE;

    const selected = (['lines', 'words', 'bytes'] as const).filter((k) => options.flags.has(k));
    const fields = selected.length ? selected : (['lines', 'words', 'bytes'] as const);

    const rows: { name: string; counts: Counts }[] = [];
    let exitCode = 0;
    for (const input of readInputs(ctx, options.operands)) {
      if (input.content === null) exitCode = 1;
      else rows.push({ name: input.name, counts: count(input.content) });
    }
    if (rows.length > 1) {
      rows.push({
        name: 'total',
        counts: rows.reduce((t, r) => ({ lines: t.lines + r.counts.lines, words: t.words + r.counts.words, bytes: t.bytes + r.counts.bytes }), { lines: 0, words: 0, bytes: 0 }),
      });
    }

    // GNU wc alinea todas las columnas al ancho del número más grande.
    const readsStdin = options.operands.length === 0;
    const maxValue = Math.max(0, ...rows.flatMap((r) => fields.map((f) => r.counts[f])));
    const width = fields.length === 1 && rows.length === 1 ? 0 : Math.max(String(maxValue).length, readsStdin ? 7 : 1);

    for (const row of rows) {
      const numbers = fields.map((f) => String(row.counts[f]).padStart(width)).join(' ');
      ctx.stdout.write(row.name === '-' ? `${numbers}\n` : `${numbers} ${row.name}\n`);
    }
    return exitCode;
  },
};
