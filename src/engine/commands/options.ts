/**
 * Parser de opciones estilo GNU, compartido por todos los comandos.
 *
 * Soporta:
 *   -a -l        opciones cortas
 *   -la          opciones cortas agrupadas
 *   -n 5 / -n5   opción corta con valor
 *   --all        opción larga
 *   --lines=5    opción larga con valor (o --lines 5)
 *   --           fin de opciones: lo que sigue son operandos aunque empiece por -
 */

export interface OptionSpec {
  /** Clave con la que se consulta el resultado (ej. 'all'). */
  key: string;
  /** Letra corta sin guion (ej. 'a'). */
  short?: string;
  /** Nombre largo sin guiones (ej. 'all'). */
  long?: string;
  /** Si la opción recibe un valor (ej. -n 5). */
  takesValue?: boolean;
}

export interface ParsedOptions {
  /** Claves de las opciones booleanas activadas. */
  flags: Set<string>;
  /** Valores de las opciones que reciben argumento. */
  values: Map<string, string>;
  /** Argumentos que no son opciones (archivos, textos...). */
  operands: string[];
}

/** Error con el mismo formato que GNU coreutils. */
export class OptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OptionError';
  }
}

export function parseOptions(args: readonly string[], specs: readonly OptionSpec[]): ParsedOptions {
  const result: ParsedOptions = { flags: new Set(), values: new Map(), operands: [] };
  const byShort = new Map(specs.filter((s) => s.short).map((s) => [s.short as string, s]));
  const byLong = new Map(specs.filter((s) => s.long).map((s) => [s.long as string, s]));

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--') {
      result.operands.push(...args.slice(i + 1));
      break;
    }

    if (arg.startsWith('--')) {
      const [name, inlineValue] = splitOnce(arg.slice(2), '=');
      const spec = byLong.get(name);
      if (!spec) throw new OptionError(`unrecognized option '--${name}'`);
      if (spec.takesValue) {
        const value = inlineValue ?? args[++i];
        if (value === undefined) throw new OptionError(`option '--${name}' requires an argument`);
        result.values.set(spec.key, value);
      } else {
        result.flags.add(spec.key);
      }
      continue;
    }

    // Un '-' solo es un operando (suele significar "entrada estándar").
    if (arg.startsWith('-') && arg.length > 1) {
      for (let j = 1; j < arg.length; j++) {
        const letter = arg[j];
        const spec = byShort.get(letter);
        if (!spec) throw new OptionError(`invalid option -- '${letter}'`);
        if (spec.takesValue) {
          const value = arg.slice(j + 1) || args[++i];
          if (value === undefined) throw new OptionError(`option requires an argument -- '${letter}'`);
          result.values.set(spec.key, value);
          break;
        }
        result.flags.add(spec.key);
      }
      continue;
    }

    result.operands.push(arg);
  }
  return result;
}

function splitOnce(text: string, separator: string): [string, string | undefined] {
  const index = text.indexOf(separator);
  return index === -1 ? [text, undefined] : [text.slice(0, index), text.slice(index + 1)];
}
