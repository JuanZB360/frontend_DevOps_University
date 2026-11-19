/**
 * Utilidad para tests: construye un sistema completo (VFS + sesión + shell)
 * con un usuario `neo` y ejecuta líneas capturando la salida.
 */
import { ALLOW_ALL, type CommandGate } from '../commands/CommandGate';
import { createCommandRegistry } from '../commands/index';
import { Shell, type ExecutionReport } from '../shell/Shell';
import { BufferedOutput } from '../shell/streams';
import { CommandHistory } from '../system/CommandHistory';
import { groupsOf } from '../system/accounts';
import { provisionSystem } from '../system/provision';
import { createBaseFilesystem } from '../system/seedFilesystem';
import { ShellSession } from '../system/ShellSession';
import { VirtualFileSystem } from '../vfs/VirtualFileSystem';

export interface TestShell {
  fs: VirtualFileSystem;
  session: ShellSession;
  history: CommandHistory;
  /** Ejecuta una línea y devuelve la salida de pantalla + el reporte. */
  run(line: string): Promise<{ output: string; report: ExecutionReport }>;
  cleared: () => number;
  /** Respuestas que recibirán las preguntas por teclado (contraseñas...), en orden. */
  answers: string[];
  /** Contenido que "escribirá" el usuario en nano (null = salir sin guardar). */
  editorResult: { content: string | null; opened: string[] };
}

export function createTestShell(gate: CommandGate = ALLOW_ALL): TestShell {
  const session = ShellSession.forNewUser('neo', 'devops-u');
  const registry = createCommandRegistry({
    manuals: { lookup: (name) => (name === 'ls' ? { status: 'ok', text: 'LS(1)' } : { status: 'missing' }) },
  });
  const fs = new VirtualFileSystem(createBaseFilesystem('neo', 'devops-u', registry.binaryNames()), {
    identity: () => session.identity(),
    clock: () => 1_700_000_000_000,
  });
  provisionSystem(fs, 'neo', 'devops-u');
  session.setGroups(groupsOf(fs, 'neo'));
  const history = new CommandHistory();
  let clears = 0;
  const answers: string[] = [];
  const editorResult: { content: string | null; opened: string[] } = { content: null, opened: [] };
  const shell = new Shell({
    fs, session, history, registry, gate,
    terminal: {
      clear: () => clears++,
      columns: () => 80,
      readLine: async () => answers.shift() ?? null,
      edit: async (filename) => {
        editorResult.opened.push(filename);
        return editorResult.content;
      },
    },
  });

  return {
    fs, session, history, answers, editorResult,
    cleared: () => clears,
    async run(line) {
      const out = new BufferedOutput();
      const report = await shell.execute(line, out);
      return { output: out.toString(), report };
    },
  };
}
