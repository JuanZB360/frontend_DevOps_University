/**
 * Registro central de comandos (patrón Registry).
 *
 * El shell busca aquí cada comando por nombre o alias. Los módulos futuros
 * (nginx, docker, git...) solo tienen que registrar sus comandos: el shell no
 * cambia.
 */
import type { Command } from './Command';

export class CommandRegistry {
  private readonly byName = new Map<string, Command>();
  private readonly commands: Command[] = [];

  /** Registra uno o varios comandos. Lanza error si un nombre ya existe. */
  register(...commands: Command[]): this {
    for (const command of commands) {
      for (const name of [command.name, ...(command.aliases ?? [])]) {
        if (this.byName.has(name)) throw new Error(`Comando duplicado en el registro: ${name}`);
        this.byName.set(name, command);
      }
      this.commands.push(command);
    }
    return this;
  }

  get(name: string): Command | undefined {
    return this.byName.get(name);
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  /** Todos los comandos registrados (sin duplicar alias), ordenados por nombre. */
  list(): Command[] {
    return [...this.commands].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Nombres de los programas "instalados" (no builtins), para poblar /usr/bin. */
  binaryNames(): string[] {
    return this.list().filter((c) => !c.builtin && !c.package && c.category !== 'juego').map((c) => c.name);
  }
}
