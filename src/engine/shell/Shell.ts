/**
 * Intérprete de comandos (el "bash" del simulador).
 *
 * Flujo de una línea o script:
 *   texto → tokenize → parse (AST) → ejecutar cada elemento de la lista:
 *     estructuras (if, for, while, case, funciones, { }, ( )) y pipelines
 *     de comandos simples: expandir → redirigir → buscar → ejecutar.
 *
 * Devuelve un `ExecutionReport` con cada comando simple ejecutado; el motor
 * de misiones lo usa para validar retos sin acoplarse al shell.
 */
import type { Command as Program, CommandContext, CommandLookup, ScriptOptions, ShellApi, SpawnIO, TerminalControl } from '../commands/Command';
import type { CommandGate } from '../commands/CommandGate';
import type { CommandRegistry } from '../commands/CommandRegistry';
import type { CommandHistory } from '../system/CommandHistory';
import { isInstalled, readMachine, spawnProcess, updateMachine } from '../system/machine';
import type { ShellSession } from '../system/ShellSession';
import { isFsError } from '../vfs/errors';
import { basename, joinPath, resolvePath } from '../vfs/path';
import type { VirtualFileSystem } from '../vfs/VirtualFileSystem';
import { ArithmeticError } from './arithmetic';
import { expandPattern, expandVariables, expandWord, expandWordToString, shellPatternToRegExp, type ExpansionContext } from './expander';
import { parse, type Command, type ListItem, type Pipeline, type Redirect, type Script, type SimpleCommand } from './parser';
import { BufferedOutput, FileOutput, InputSource, RecordingOutput, type OutputStream } from './streams';
import { rawWord, ShellSyntaxError } from './tokenizer';

/** Registro de un comando ejecutado (para los validadores de misiones). */
export interface ExecutedCommand {
  name: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Usuario con el que se ejecutó (cambia con sudo/su). */
  user?: string;
}

export interface ExecutionReport {
  line: string;
  commands: ExecutedCommand[];
  /** Código de salida final de la línea ($?). */
  exitCode: number;
}

export interface ShellDependencies {
  fs: VirtualFileSystem;
  session: ShellSession;
  history: CommandHistory;
  registry: CommandRegistry;
  gate: CommandGate;
  terminal: TerminalControl;
}

/** Códigos de salida estándar de bash. */
const EXIT_NOT_FOUND = 127;
const EXIT_NOT_EXECUTABLE = 126;
const EXIT_SYNTAX = 2;

/** Límites de seguridad: un bucle infinito no debe congelar el navegador. */
const MAX_STEPS = 20_000;
const MAX_DEPTH = 64;
const YIELD_EVERY = 250;

/** Señales de control de flujo (break, continue, return, exit). */
export class ShellSignal extends Error {
  readonly kind: 'break' | 'continue' | 'return' | 'exit';
  readonly value: number;

  constructor(kind: ShellSignal['kind'], value: number) {
    super(kind);
    this.kind = kind;
    this.value = value;
  }
}

class StepLimitError extends Error {}

/** Contexto de ejecución: un proceso (sesión) y, dentro, la función actual. */
interface Frame {
  session: ShellSession;
  /** Nombre del script ($0). */
  name: string;
  args: string[];
  functions: Map<string, Command>;
  /** Variables locales de la función en curso (null fuera de funciones). */
  locals: Map<string, string | undefined> | null;
  parent: Frame | null;
  isScript: boolean;
  /** Alias que se están expandiendo (evita recursión infinita). */
  expandingAliases: Set<string>;
}

interface IO {
  input: InputSource;
  out: OutputStream;
  err: OutputStream;
  background: boolean;
  backgroundPid?: number;
}

interface RunState {
  report: ExecutionReport;
  steps: number;
  depth: number;
  tty: OutputStream;
}

/** Comillas para reconstruir una línea a partir de argumentos ya expandidos. */
function shellQuote(arg: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

export class Shell {
  private readonly deps: ShellDependencies;
  /** Vista filtrada por la puerta: solo comandos desbloqueados. */
  private readonly lookup: CommandLookup;
  /** Funciones del shell interactivo (persisten entre líneas). */
  private readonly functions = new Map<string, Command>();
  private positionalArgs: string[] = [];

  constructor(deps: ShellDependencies) {
    this.deps = deps;
    this.lookup = {
      get: (name) => (deps.gate.isAllowed(name) ? deps.registry.get(name) : undefined),
      available: () => deps.registry.list().filter((c) => deps.gate.isAllowed(c.name)),
    };
  }

  /**
   * Ejecuta una línea escrita por el usuario.
   * @param tty flujo conectado a la pantalla.
   */
  async execute(line: string, tty: OutputStream): Promise<ExecutionReport> {
    const report: ExecutionReport = { line, commands: [], exitCode: 0 };
    if (line.trim() === '') return report;
    this.deps.history.add(line);

    let script: Script;
    try {
      script = parse(line);
    } catch (error) {
      if (!(error instanceof ShellSyntaxError)) throw error;
      tty.write(`bash: ${error.message}\n`);
      report.exitCode = this.deps.session.lastExitCode = EXIT_SYNTAX;
      return report;
    }

    const frame = this.interactiveFrame();
    const state: RunState = { report, steps: 0, depth: 0, tty };
    const io: IO = { input: new InputSource(null), out: tty, err: tty, background: false };
    try {
      report.exitCode = await this.runList(script, frame, io, state);
    } catch (error) {
      report.exitCode = this.handleTopLevelError(error, tty);
    }
    this.deps.session.lastExitCode = report.exitCode;
    return report;
  }

  private interactiveFrame(): Frame {
    return {
      session: this.deps.session,
      name: 'bash',
      args: this.positionalArgs,
      functions: this.functions,
      locals: null,
      parent: null,
      isScript: false,
      expandingAliases: new Set(),
    };
  }

  private handleTopLevelError(error: unknown, tty: OutputStream): number {
    if (error instanceof ShellSignal) return error.value;
    if (error instanceof StepLimitError) {
      tty.write(`bash: ⛔ ejecución detenida: más de ${MAX_STEPS} comandos (¿un bucle infinito?)\n`);
      return 130;
    }
    throw error;
  }

  // ─────────────────────────────── Listas y pipelines ───────────────────────────────

  private async runList(script: Script, frame: Frame, io: IO, state: RunState): Promise<number> {
    let exitCode = frame.session.lastExitCode;
    let previous: ListItem['next'] = null;
    for (const item of script) {
      // Un elemento se salta si lo une && y lo anterior falló, o || y lo anterior funcionó.
      const run = previous !== '&&' && previous !== '||'
        || (previous === '&&' && exitCode === 0)
        || (previous === '||' && exitCode !== 0);
      if (run) {
        if (item.background) {
          await this.runBackground(item.pipeline, frame, io, state);
          exitCode = 0;
        } else {
          exitCode = await this.runPipeline(item.pipeline, frame, io, state);
        }
        frame.session.lastExitCode = exitCode;
      }
      previous = item.next;
    }
    return exitCode;
  }

  /**
   * `comando &`: registra un proceso con número de trabajo (jobs, ps, kill %1).
   * El comando se ejecuta enseguida; si es de larga duración (sleep, un
   * servidor) ajusta su proceso para seguir "vivo" después.
   */
  private async runBackground(pipeline: Pipeline, frame: Frame, io: IO, state: RunState): Promise<void> {
    const { fs } = this.deps;
    const text = pipeline.commands
      .map((c) => (c.type === 'simple' ? c.words.map(rawWord).join(' ') : c.type))
      .join(' | ');
    const process = updateMachine(fs, (machine) => {
      const job = machine.nextJob++;
      return spawnProcess(machine, fs.now(), {
        user: frame.session.username, command: text, cpu: 0, mem: 0.1, rss: 3_200, tty: 'pts/0', job,
      });
    });
    if (!frame.isScript) io.err.write(`[${process.job}] ${process.pid}\n`);
    frame.session.setVar('!', String(process.pid));
    await this.runPipeline(pipeline, frame, { ...io, background: true, backgroundPid: process.pid }, state);
    // Si el comando no se quedó "vivo" (sleep, servidor), el trabajo ya terminó.
    updateMachine(fs, (machine) => {
      machine.processes = machine.processes.filter((p) => p.pid !== process.pid || p.endsAt !== undefined || p.persistent);
    });
  }

  /** Ejecuta comandos unidos por | pasando la salida de uno a la entrada del siguiente. */
  private async runPipeline(pipeline: Pipeline, frame: Frame, io: IO, state: RunState): Promise<number> {
    let input = io.input;
    let exitCode = 0;
    const last = pipeline.commands.length - 1;
    for (let i = 0; i <= last; i++) {
      const pipeOut = i < last ? new BufferedOutput() : null;
      exitCode = await this.runCommand(pipeline.commands[i], frame, { ...io, input, out: pipeOut ?? io.out }, state);
      if (pipeOut) input = new InputSource(pipeOut.toString());
    }
    if (pipeline.negated) exitCode = exitCode === 0 ? 1 : 0;
    return exitCode;
  }

  // ─────────────────────────────── Comandos ───────────────────────────────

  private async runCommand(command: Command, frame: Frame, io: IO, state: RunState): Promise<number> {
    if (command.type === 'simple') return this.runSimple(command, frame, io, state);
    if (command.type === 'function') {
      frame.functions.set(command.name, command.body);
      return 0;
    }

    const redirected = await this.applyRedirects(command.redirects, frame, io, state);
    if (typeof redirected === 'number') return redirected;
    const cio = redirected;

    switch (command.type) {
      case 'if': {
        for (const branch of command.branches) {
          if ((await this.runList(branch.condition, frame, cio, state)) === 0) {
            return this.runList(branch.body, frame, cio, state);
          }
        }
        return command.elseBody ? this.runList(command.elseBody, frame, cio, state) : 0;
      }
      case 'for': {
        const items: string[] = [];
        if (command.items === null) items.push(...frame.args);
        else for (const word of command.items) items.push(...(await expandWord(word, this.expansion(frame, state))));
        let exitCode = 0;
        for (const item of items) {
          this.setVar(frame, command.variable, item);
          const signal = await this.loopBody(command.body, frame, cio, state);
          exitCode = frame.session.lastExitCode;
          if (signal === 'break') break;
        }
        return exitCode;
      }
      case 'while': {
        let exitCode = 0;
        for (;;) {
          const condition = await this.runList(command.condition, frame, cio, state);
          if ((condition === 0) === command.until) break;
          const signal = await this.loopBody(command.body, frame, cio, state);
          exitCode = frame.session.lastExitCode;
          if (signal === 'break') break;
        }
        return exitCode;
      }
      case 'case': {
        const subject = await expandWordToString(command.subject, this.expansion(frame, state));
        for (const clause of command.clauses) {
          for (const word of clause.patterns) {
            const pattern = await expandPattern(word, this.expansion(frame, state));
            if (shellPatternToRegExp(pattern, 'full').test(subject)) return this.runList(clause.body, frame, cio, state);
          }
        }
        return 0;
      }
      case 'group': {
        if (!command.subshell) return this.runList(command.body, frame, cio, state);
        const child: Frame = { ...frame, session: frame.session.fork(false), functions: new Map(frame.functions), locals: null };
        try {
          return await this.runList(command.body, child, cio, state);
        } catch (error) {
          if (error instanceof ShellSignal && error.kind === 'exit') return error.value;
          throw error;
        }
      }
    }
  }

  /** Ejecuta el cuerpo de un bucle gestionando break y continue. */
  private async loopBody(body: Script, frame: Frame, io: IO, state: RunState): Promise<'break' | 'continue' | null> {
    try {
      frame.session.lastExitCode = await this.runList(body, frame, io, state);
      return null;
    } catch (error) {
      if (!(error instanceof ShellSignal) || (error.kind !== 'break' && error.kind !== 'continue')) throw error;
      if (error.value > 1) throw new ShellSignal(error.kind, error.value - 1);
      return error.kind;
    }
  }

  private async runSimple(command: SimpleCommand, frame: Frame, io: IO, state: RunState): Promise<number> {
    await this.step(state);
    const redirected = await this.applyRedirects(command.redirects, frame, io, state);
    if (typeof redirected === 'number') return redirected;
    const cio = redirected;
    const expansion = this.expansion(frame, state);

    let fields: string[];
    try {
      fields = [];
      for (const word of command.words) fields.push(...(await expandWord(word, expansion)));
    } catch (error) {
      if (error instanceof ArithmeticError) {
        cio.err.write(`bash: ${error.message}\n`);
        return 1;
      }
      throw error;
    }

    // Solo asignaciones (VAR=valor): se guardan en la sesión.
    if (fields.length === 0) {
      for (const { name, value } of command.assignments) {
        this.setVar(frame, name, await expandWordToString(value, expansion));
      }
      return 0;
    }

    // VAR=valor comando: la variable solo existe para ese comando.
    const restore: [string, string | undefined, boolean][] = [];
    for (const { name, value } of command.assignments) {
      restore.push([name, frame.session.getVar(name), frame.session.isExported(name)]);
      frame.session.setVar(name, await expandWordToString(value, expansion));
      frame.session.exportVar(name);
    }
    try {
      const [name, ...args] = fields;
      // Alias: solo en la línea interactiva, como en bash.
      const firstWord = command.words[0];
      const alias = frame.session.getAlias(name);
      if (alias !== undefined && !frame.isScript && !frame.expandingAliases.has(name) && firstWord.length === 1 && firstWord[0].quote === 'none') {
        frame.expandingAliases.add(name);
        try {
          return await this.runText(`${alias} ${args.map(shellQuote).join(' ')}`, frame, cio, state);
        } finally {
          frame.expandingAliases.delete(name);
        }
      }
      return await this.invoke(name, args, frame, cio, state);
    } finally {
      for (const [name, previous, wasExported] of restore) {
        if (previous === undefined) frame.session.unsetVar(name);
        else {
          frame.session.setVar(name, previous);
          if (!wasExported) frame.session.unexportVar(name);
        }
      }
    }
  }

  /** Busca y ejecuta un comando: función, programa registrado o archivo ejecutable. */
  private async invoke(name: string, args: string[], frame: Frame, io: IO, state: RunState): Promise<number> {
    const stdout = new RecordingOutput(io.out);
    const stderr = new RecordingOutput(io.err);
    const user = frame.session.username;
    const record = (exitCode: number): number => {
      state.report.commands.push({ name, args, exitCode, stdout: stdout.recorded(), stderr: stderr.recorded(), user });
      return exitCode;
    };

    // 1) Funciones definidas por el usuario.
    const fn = frame.functions.get(name);
    if (fn) {
      if (state.depth >= MAX_DEPTH) {
        stderr.write(`bash: ${name}: maximum function nesting level exceeded (${MAX_DEPTH})\n`);
        return record(1);
      }
      const callFrame: Frame = { ...frame, args, locals: new Map(), parent: frame };
      state.depth++;
      try {
        return record(await this.runCommand(fn, callFrame, { ...io, out: stdout, err: stderr }, state));
      } catch (error) {
        if (error instanceof ShellSignal && error.kind === 'return') return record(error.value);
        throw error;
      } finally {
        state.depth--;
      }
    }

    // 2) Ruta a un archivo (./script.sh, /usr/local/bin/x) o script instalado en el PATH.
    if (name.includes('/')) return record(await this.runFile(name, args, frame, { ...io, out: stdout, err: stderr }, state));

    if (!this.deps.registry.has(name)) {
      const inPath = this.findInPath(name, frame);
      if (inPath) return record(await this.runFile(inPath, args, frame, { ...io, out: stdout, err: stderr }, state));
      stderr.write(`${name}: command not found\n`);
      return record(EXIT_NOT_FOUND);
    }

    // 3) Programa registrado, respetando la puerta del juego.
    if (!this.deps.gate.isAllowed(name)) {
      stderr.write(`bash: ${name}: 🔒 comando ENCRIPTADO. Completa misiones para desbloquearlo.\n`);
      return record(EXIT_NOT_EXECUTABLE);
    }
    const handler = this.deps.registry.get(name)!;
    if (handler.package && !isInstalled(readMachine(this.deps.fs), handler.package)) {
      stderr.write(`Command '${name}' not found, but can be installed with:\n\nsudo apt install ${handler.package}\n\n`);
      return record(EXIT_NOT_FOUND);
    }
    return record(await this.runProgram(handler, name, args, frame, { ...io, out: stdout, err: stderr }, state));
  }

  /** Ejecución aislada de un programa: un fallo interno nunca rompe la terminal. */
  private async runProgram(handler: Program, name: string, args: string[], frame: Frame, io: IO, state: RunState): Promise<number> {
    const ctx: CommandContext = {
      name,
      args,
      stdin: io.input.rest(),
      input: io.input,
      background: io.background,
      backgroundPid: io.backgroundPid,
      stdout: io.out,
      stderr: io.err,
      fs: this.deps.fs,
      session: frame.session,
      history: this.deps.history,
      commands: this.lookup,
      terminal: this.deps.terminal,
      resolve: (path) => resolvePath(frame.session.cwd, path),
      shell: this.api(frame, io, state),
    };
    try {
      return await handler.execute(ctx);
    } catch (error) {
      if (error instanceof ShellSignal || error instanceof StepLimitError) throw error;
      if (isFsError(error)) {
        io.err.write(`${name}: ${error.path}: ${error.reason}\n`);
        return 1;
      }
      console.error(`[shell] Error interno en "${name}":`, error);
      io.err.write(`${name}: error interno del simulador (reportado en la consola)\n`);
      return 1;
    }
  }

  /** Busca un script ejecutable instalado en algún directorio del PATH. */
  private findInPath(name: string, frame: Frame): string | null {
    for (const dir of (frame.session.getVar('PATH') ?? '').split(':')) {
      if (!dir) continue;
      const candidate = joinPath(dir, name);
      const node = this.deps.fs.tryStat(candidate);
      if (node?.type === 'file' && !node.content.startsWith('#!ELF')) return candidate;
    }
    return null;
  }

  /** Ejecuta un archivo: binario simulado (/usr/bin/ls) o script de texto. */
  private async runFile(path: string, args: string[], frame: Frame, io: IO, state: RunState): Promise<number> {
    const { fs } = this.deps;
    const abs = resolvePath(frame.session.cwd, path);
    const node = fs.tryStat(abs);
    if (!node) {
      io.err.write(`bash: ${path}: No such file or directory\n`);
      return EXIT_NOT_FOUND;
    }
    if (node.type === 'dir') {
      io.err.write(`bash: ${path}: Is a directory\n`);
      return EXIT_NOT_EXECUTABLE;
    }
    if (!fs.canAccess(abs, 'x')) {
      io.err.write(`bash: ${path}: Permission denied\n`);
      return EXIT_NOT_EXECUTABLE;
    }
    let content: string;
    try {
      content = fs.readFile(abs);
    } catch {
      io.err.write(`bash: ${path}: Permission denied\n`);
      return EXIT_NOT_EXECUTABLE;
    }
    if (content.startsWith('#!ELF')) {
      const program = basename(abs);
      if (!this.deps.registry.has(program)) return 0;
      if (!this.deps.gate.isAllowed(program)) {
        io.err.write(`bash: ${program}: 🔒 comando ENCRIPTADO. Completa misiones para desbloquearlo.\n`);
        return EXIT_NOT_EXECUTABLE;
      }
      return this.runProgram(this.deps.registry.get(program)!, program, args, frame, io, state);
    }
    return this.runScriptIn(content, { name: path, args, newProcess: true }, frame, io, state);
  }

  // ─────────────────────────────── Scripts ───────────────────────────────

  /** Ejecuta texto en el MISMO contexto (alias, eval). */
  private async runText(text: string, frame: Frame, io: IO, state: RunState): Promise<number> {
    let script: Script;
    try {
      script = parse(text);
    } catch (error) {
      if (!(error instanceof ShellSyntaxError)) throw error;
      io.err.write(`bash: ${error.message}\n`);
      return EXIT_SYNTAX;
    }
    return this.runList(script, frame, io, state);
  }

  /** Ejecuta un script como proceso nuevo (bash x.sh) o en el actual (source x.sh). */
  private async runScriptIn(text: string, options: ScriptOptions, frame: Frame, io: IO, state: RunState): Promise<number> {
    let script: Script;
    try {
      script = parse(text);
    } catch (error) {
      if (!(error instanceof ShellSyntaxError)) throw error;
      // bash indica la línea del error; aquí, el script.
      io.err.write(`${options.name ?? 'bash'}: ${error.message}\n`);
      return EXIT_SYNTAX;
    }
    if (state.depth >= MAX_DEPTH) {
      io.err.write('bash: demasiados scripts anidados\n');
      return 1;
    }
    const child: Frame = options.newProcess
      ? {
          session: frame.session.fork(true),
          name: options.name ?? 'bash',
          args: [...(options.args ?? [])],
          functions: new Map(),
          locals: null,
          parent: null,
          isScript: true,
          expandingAliases: new Set(),
        }
      : { ...frame, args: options.args ? [...options.args] : frame.args, isScript: true };
    state.depth++;
    try {
      return await this.runList(script, child, io, state);
    } catch (error) {
      if (error instanceof ShellSignal && (error.kind === 'exit' || error.kind === 'return')) return error.value;
      if (error instanceof ShellSignal) return 0;
      throw error;
    } finally {
      state.depth--;
      // `source` con argumentos no debe cambiar los del shell que lo llamó.
      if (!options.newProcess && options.args) child.args = frame.args;
    }
  }

  /** Ejecuta $(...) en un subshell y devuelve su salida. */
  private async captureOutput(text: string, frame: Frame, state: RunState): Promise<string> {
    const out = new BufferedOutput();
    if (state.depth >= MAX_DEPTH) return '';
    const child: Frame = { ...frame, session: frame.session.fork(false), functions: new Map(frame.functions) };
    state.depth++;
    try {
      const code = await this.runText(text, child, { input: new InputSource(null), out, err: state.tty, background: false }, state);
      frame.session.lastExitCode = code;
    } catch (error) {
      if (!(error instanceof ShellSignal)) throw error;
    } finally {
      state.depth--;
    }
    return out.toString();
  }

  // ─────────────────────────────── Redirecciones ───────────────────────────────

  private async applyRedirects(redirects: readonly Redirect[], frame: Frame, io: IO, state: RunState): Promise<IO | number> {
    if (redirects.length === 0) return io;
    const result: IO = { ...io };
    const expansion = this.expansion(frame, state);
    for (const redirect of redirects) {
      if (redirect.op === '2>&1') {
        result.err = result.out;
        continue;
      }
      if (redirect.op === '>&2') {
        result.out = result.err;
        continue;
      }
      if (redirect.op === '<<' || redirect.op === '<<-') {
        const body = redirect.heredoc?.body ?? '';
        result.input = new InputSource(redirect.heredoc?.expand ? await this.expandHeredoc(body, frame, state) : body);
        continue;
      }
      const target = await expandWordToString(redirect.target ?? [], expansion);
      if (redirect.op === '<<<') {
        result.input = new InputSource(target + '\n');
        continue;
      }
      const path = resolvePath(frame.session.cwd, target);
      try {
        switch (redirect.op) {
          case '>': result.out = new FileOutput(this.deps.fs, path, true); break;
          case '>>': result.out = new FileOutput(this.deps.fs, path, false); break;
          case '2>': result.err = new FileOutput(this.deps.fs, path, true); break;
          case '2>>': result.err = new FileOutput(this.deps.fs, path, false); break;
          case '&>': result.out = result.err = new FileOutput(this.deps.fs, path, true); break;
          case '<': result.input = new InputSource(this.deps.fs.readFile(path)); break;
        }
      } catch (error) {
        if (!isFsError(error)) throw error;
        io.err.write(`bash: ${target}: ${error.reason}\n`);
        return 1;
      }
    }
    return result;
  }

  /** Expande variables y $(...) dentro de un here-document sin comillas. */
  private async expandHeredoc(body: string, frame: Frame, state: RunState): Promise<string> {
    let text = body;
    const matches = [...text.matchAll(/\$\(([^()]*)\)/g)];
    for (const match of matches.reverse()) {
      const output = (await this.captureOutput(match[1], frame, state)).replace(/\n+$/, '');
      text = text.slice(0, match.index) + output + text.slice(match.index + match[0].length);
    }
    return expandVariables(text, this.expansion(frame, state));
  }

  // ─────────────────────────────── Variables ───────────────────────────────

  private getVar(frame: Frame, name: string): string | undefined {
    if (/^[0-9]$/.test(name)) return name === '0' ? frame.name : frame.args[Number(name) - 1];
    if (name === '#') return String(frame.args.length);
    if (name === '@' || name === '*') return frame.args.join(' ');
    for (let f: Frame | null = frame; f; f = f.parent) {
      if (f.locals?.has(name)) return f.locals.get(name);
    }
    return frame.session.getVar(name);
  }

  private setVar(frame: Frame, name: string, value: string): void {
    for (let f: Frame | null = frame; f; f = f.parent) {
      if (f.locals?.has(name)) {
        f.locals.set(name, value);
        return;
      }
    }
    frame.session.setVar(name, value);
  }

  private expansion(frame: Frame, state: RunState): ExpansionContext {
    const { fs } = this.deps;
    return {
      getVar: (n) => this.getVar(frame, n),
      setVar: (n, v) => this.setVar(frame, n, v),
      positional: () => frame.args,
      runCommand: (text) => this.captureOutput(text, frame, state),
      home: frame.session.home,
      cwd: frame.session.cwd,
      fs,
    };
  }

  /** Cuenta pasos y cede el control de vez en cuando para no congelar la página. */
  private async step(state: RunState): Promise<void> {
    state.steps++;
    if (state.steps > MAX_STEPS) throw new StepLimitError();
    if (state.steps % YIELD_EVERY === 0) await new Promise((r) => setTimeout(r, 0));
  }

  // ─────────────────────────────── API para los comandos ───────────────────────────────

  private api(frame: Frame, io: IO, state: RunState): ShellApi {
    const merge = (custom?: SpawnIO): IO => ({
      input: custom?.stdin !== undefined ? new InputSource(custom.stdin) : io.input,
      out: custom?.stdout ?? io.out,
      err: custom?.stderr ?? io.err,
      background: io.background,
      backgroundPid: io.backgroundPid,
    });
    return {
      spawn: async (argv, custom) => {
        if (argv.length === 0) return 0;
        const [name, ...args] = argv;
        return this.invoke(name, args, frame, merge(custom), state);
      },
      runScript: (text, options = {}) => this.runScriptIn(text, options, frame, merge(options.io), state),
      positional: () => frame.args,
      setPositional: (args) => {
        frame.args.splice(0, frame.args.length, ...args);
      },
      inScript: () => frame.isScript || frame.locals !== null,
      inFunction: () => frame.locals !== null,
      declareLocal: (name, value) => {
        if (!frame.locals) throw new Error('local fuera de función');
        frame.locals.set(name, value ?? this.getVar(frame, name) ?? '');
      },
      signal: (kind, value) => {
        throw new ShellSignal(kind, value);
      },
      functionNames: () => [...frame.functions.keys()].sort(),
      hasFunction: (name) => frame.functions.has(name),
    };
  }
}
