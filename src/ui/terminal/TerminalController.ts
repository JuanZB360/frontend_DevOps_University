/**
 * Controlador de la terminal: adaptador entre xterm.js (pantalla y teclado)
 * y el juego (shell + misiones).
 *
 * Responsabilidades:
 *   - Traducir teclas a ediciones de línea (LineEditor) y dibujarlas (LineRenderer).
 *   - Ejecutar líneas en el shell y pasar el resultado al juego.
 *   - Mostrar briefings, recompensas y pistas, encolándolos para que nunca
 *     se mezclen con la salida de un comando ni con lo que el usuario escribe.
 */
import type { Terminal } from '@xterm/xterm';
import type { OutputStream } from '../../engine/shell/streams';
import { LineEditor } from '../../engine/terminal/LineEditor';
import { LineRenderer, visibleLength } from '../../engine/terminal/LineRenderer';
import { TabCompleter } from '../../engine/terminal/TabCompleter';
import { TextEditor } from '../../engine/terminal/TextEditor';
import { prettifyPath } from '../../engine/vfs/path';
import { formatHint, formatHintRejection } from '../../game/commands/gameCommands';
import { C, frame, highlightCode, stars, wrapAnsi } from '../../game/presentation/ansiText';
import type { GameSession } from '../../game/session/GameSession';
import type { Unsubscribe } from '../../shared/EventBus';

/** Bloque de texto a anunciar en la terminal. */
interface Announcement {
  lines: string[];
  /** Escribir con efecto de máquina de escribir. */
  typewriter?: boolean;
  /** Pausa antes de mostrarlo (ms). */
  delay?: number;
}

const TYPE_SPEED_MS = 12;
const CHARS_PER_TICK = 2;

const BANNER = [
  ' ____             ___                 _   _ ',
  '|  _ \\  _____   _/ _ \\ _ __  ___     | | | |',
  '| | | |/ _ \\ \\ / / | | | \'_ \\/ __|    | | | |',
  '| |_| |  __/\\ V /| |_| | |_) \\__ \\    | |_| |',
  '|____/ \\___| \\_/  \\___/| .__/|___/     \\___/ ',
  '                       |_|                    ',
];

/** Sonidos que la terminal puede pedir (se inyectan para no depender del motor de audio). */
export interface TerminalSounds {
  play(name: 'key' | 'enter' | 'tick'): void;
}

const SILENT: TerminalSounds = { play: () => undefined };

/** Durante el efecto de tecleo, suena un tic cada N fragmentos (no en todos: sería un zumbido). */
const TICK_EVERY = 3;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class TerminalController {
  private readonly term: Terminal;
  private readonly game: GameSession;
  private readonly editor: LineEditor;
  private readonly renderer = new LineRenderer();
  private readonly completer: TabCompleter;
  private readonly tty: OutputStream;
  private readonly queue: Announcement[] = [];
  private readonly subscriptions: Unsubscribe[] = [];
  private readonly sounds: TerminalSounds;

  /** true mientras se ejecuta un comando o se escribe un anuncio. */
  private busy = false;
  /** Si el usuario pulsa una tecla durante el efecto de tecleo, se completa al instante. */
  private skipTyping = false;
  /** Tras completar una misión, hay que arrancar la siguiente al vaciar la cola. */
  private advancePending = false;
  private disposed = false;
  /** Programa interactivo en curso (pregunta de contraseña, nano...): recibe el teclado. */
  private interactive: ((data: string) => void) | null = null;

  constructor(term: Terminal, game: GameSession, sounds: TerminalSounds = SILENT) {
    this.term = term;
    this.game = game;
    this.sounds = sounds;
    this.editor = new LineEditor(() => game.history.list());
    this.completer = new TabCompleter({
      commandNames: () => game.availableCommandNames(),
      fs: game.fs,
      cwd: () => game.session.cwd,
      home: () => game.session.home,
    });
    this.tty = { isTTY: true, write: (text) => term.write(text.replace(/\r?\n/g, '\r\n')) };

    game.attachTerminal({
      clear: () => term.clear(),
      columns: () => term.cols,
      readLine: (prompt, options) => this.readLine(prompt, options?.secret ?? false),
      edit: (filename, content) => this.edit(filename, content),
    });
    this.subscribeToGame();
    const input = term.onData((data) => this.onInput(data));
    this.subscriptions.push(() => input.dispose());
  }

  /** Arranca la sesión: banner, saludo y misión actual. */
  async start(isNewPlayer: boolean): Promise<void> {
    this.busy = true;
    if (this.term.cols >= 48) this.tty.write(BANNER.map((l) => C.green + l + C.reset).join('\n') + '\n');
    const view = this.game.view();
    this.tty.write(
      `${C.dim}Ubuntu 24.04 LTS · kernel 6.8.0-devops · ${new Date().toLocaleString()}${C.reset}\n` +
      (isNewPlayer
        ? `\n${C.brightGreen}Conexión establecida.${C.reset} Usuario asignado: ${C.cyan}${view.username}${C.reset}\n`
        : `\n${C.brightGreen}Sesión restaurada.${C.reset} Bienvenido de nuevo, ${C.cyan}${view.displayName}${C.reset}.\n`) +
      `${C.dim}Comandos del juego: mision · pista · estado · help${C.reset}\n`,
    );
    this.game.startCurrentMission();
    await this.flush();
    this.finishBusy();
  }

  dispose(): void {
    this.disposed = true;
    this.subscriptions.forEach((u) => u());
  }

  // ─────────────────────────────── Teclado ───────────────────────────────

  /** Permite enviar teclas o secuencias de escape desde botones táctiles en móviles. */
  sendInput(data: string): void {
    this.onInput(data);
  }

  private onInput(data: string): void {
    if (this.interactive) {
      this.interactive(data);
      return;
    }
    if (this.busy) {
      this.skipTyping = true;
      return;
    }
    for (const action of this.editor.feed(data)) {
      switch (action.type) {
        case 'redraw':
          this.sounds.play('key');
          this.redraw();
          break;
        case 'submit':
          this.sounds.play('enter');
          void this.submit(action.line);
          return; // El resto de la entrada se ignora mientras se ejecuta.
        case 'interrupt':
          this.term.write('^C\r\n');
          this.printPrompt();
          break;
        case 'clearScreen':
          this.term.clear();
          this.term.write('\x1b[H\x1b[2J');
          this.printPrompt();
          this.redraw();
          break;
        case 'complete':
          this.complete();
          break;
      }
    }
  }

  private async submit(line: string): Promise<void> {
    this.busy = true;
    this.term.write(this.renderer.moveToEnd(this.prompt(), line, this.term.cols) + '\r\n');
    try {
      const report = await this.game.shell.execute(line, this.tty);
      this.game.handleReport(report);
    } catch (error) {
      console.error('[terminal] Error inesperado:', error);
      this.tty.write(`${C.red}Error inesperado del simulador. Revisa la consola del navegador.${C.reset}\n`);
    }
    await this.flush();
    this.finishBusy();
  }

  private complete(): void {
    const result = this.completer.complete(this.editor.buffer, this.editor.cursor);
    if (result.kind === 'replace') {
      this.editor.setBuffer(result.buffer, result.cursor);
      this.redraw();
    } else if (result.kind === 'list') {
      this.term.write(this.renderer.moveToEnd(this.prompt(), this.editor.buffer, this.term.cols) + '\r\n');
      this.tty.write(result.candidates.join('  ') + '\n');
      this.printPrompt();
      this.redraw();
    }
  }

  // ─────────────────────────── Programas interactivos ───────────────────────────

  /** Pide una línea (contraseñas con eco oculto, confirmaciones y/n). */
  private readLine(prompt: string, secret: boolean): Promise<string | null> {
    return new Promise((resolve) => {
      let value = '';
      this.tty.write(prompt);
      this.interactive = (data) => {
        for (const ch of data) {
          if (ch === '\r' || ch === '\n') {
            this.interactive = null;
            this.tty.write('\n');
            resolve(value);
            return;
          }
          if (ch === '\x03') {
            this.interactive = null;
            this.tty.write('^C\n');
            resolve(null);
            return;
          }
          if (ch === '\x7f' || ch === '\b') {
            if (value && !secret) this.term.write('\b \b');
            value = value.slice(0, -1);
            continue;
          }
          if (ch < ' ' || ch === '\x1b') continue;
          value += ch;
          if (!secret) this.term.write(ch);
        }
      };
    });
  }

  /** Abre nano a pantalla completa (en el búfer alternativo, como el real). */
  private edit(filename: string, content: string): Promise<string | null> {
    return new Promise((resolve) => {
      const exists = content !== '' || this.game.fs.exists(filename);
      const editor = new TextEditor(filename, content, { isNew: !exists });
      const draw = (): void => this.term.write(editor.render(this.term.cols, this.term.rows));
      this.term.write('\x1b[?1049h\x1b[H\x1b[2J');
      draw();
      this.interactive = (data) => {
        const result = editor.feed(data);
        if (result.type === 'exit') {
          this.interactive = null;
          this.term.write('\x1b[2J\x1b[H\x1b[?1049l');
          resolve(result.saved);
          return;
        }
        draw();
      };
    });
  }

  // ─────────────────────────────── Dibujo ───────────────────────────────

  private prompt(): string {
    const { username, hostname, cwd, home } = this.game.session;
    const symbol = username === 'root' ? '#' : '$';
    return `${C.brightGreen}${username}@${hostname}${C.reset}:${C.cyan}${prettifyPath(cwd, home)}${C.reset}${symbol} `;
  }

  private printPrompt(): void {
    const prompt = this.prompt();
    this.term.write(prompt);
    this.renderer.markFreshLine(visibleLength(prompt));
  }

  private redraw(): void {
    this.term.write(this.renderer.render(this.prompt(), this.editor.buffer, this.editor.cursor, this.term.cols));
  }

  private finishBusy(): void {
    if (this.disposed) return;
    this.busy = false;
    this.skipTyping = false;
    this.printPrompt();
    if (this.editor.buffer) this.redraw();
  }

  // ─────────────────────────────── Anuncios ───────────────────────────────

  private subscribeToGame(): void {
    const { events } = this.game;
    this.subscriptions.push(
      events.on('missionStarted', ({ location, resumed }) => {
        const { mission, chapter, module } = location;
        const lines: string[] = [''];
        if (location.isFirstOfChapter && !resumed) {
          lines.push(frame(`${module.title.toUpperCase()} · CAPÍTULO ${chapter.number}: ${chapter.title.toUpperCase()}`, C.magenta));
          lines.push(`${C.dim}${chapter.description}${C.reset}`, '');
        }
        const tag = mission.boss ? `${C.red}[JEFE]${C.reset} ` : '';
        lines.push(`${C.brightGreen}▶ MISIÓN:${C.reset} ${tag}${C.bold}${mission.title}${C.reset} ${C.dim}${'◆'.repeat(mission.difficulty)}${C.reset}`);
        if (resumed) {
          lines.push(`${C.dim}(misión en curso)${C.reset}`);
        } else {
          lines.push(...mission.briefing.map((l) => `  ${highlightCode(l)}`));
        }
        lines.push('', `${C.amber}◎ OBJETIVO:${C.reset} ${highlightCode(mission.objective)}`, '');
        this.enqueue({ lines, typewriter: !resumed, delay: resumed ? 0 : 300 });
      }),

      events.on('commandsUnlocked', ({ commands }) => {
        this.enqueue({ lines: [`${C.cyan}🔓 Desbloqueado:${C.reset} ${commands.map((c) => C.bold + c + C.reset).join(', ')} ${C.dim}(manual disponible en el panel izquierdo)${C.reset}`] });
      }),

      events.on('missionCompleted', ({ location, stars: count, reward }) => {
        this.advancePending = true;
        this.enqueue({
          delay: 200,
          lines: [
            '',
            frame('✔ MISIÓN COMPLETADA', C.brightGreen),
            `  ${stars(count)}  ${C.brightGreen}+${reward.xp} XP${C.reset}  ${C.amber}+${reward.points} pts${C.reset}`,
            `  ${C.green}${location.mission.success}${C.reset}`,
          ],
        });
      }),

      events.on('chapterCompleted', ({ location }) => {
        this.enqueue({ lines: ['', frame(`★ CAPÍTULO ${location.chapter.number} SUPERADO ★`, C.amber)] });
      }),

      events.on('levelUp', ({ level, rank, rankChanged }) => {
        const lines = [`${C.amber}⬆ ¡SUBISTE AL NIVEL ${level}!${C.reset}`];
        if (rankChanged) lines.push(`${C.magenta}🏅 Nuevo rango: ${rank}${C.reset}`);
        this.enqueue({ lines });
      }),

      events.on('allMissionsCompleted', ({ total }) => {
        this.enqueue({
          lines: [
            '',
            frame('FIN DEL CONTENIDO DISPONIBLE', C.amber),
            `  Has completado las ${total} misiones publicadas. Los siguientes capítulos están en desarrollo.`,
            '  La terminal sigue abierta: practica libremente con todo lo desbloqueado.',
          ],
        });
      }),

      // El comando `mision --reiniciar` ya informa por sí mismo; el botón no.
      events.on('missionRestarted', ({ location, source }) => {
        if (source !== 'ui') return;
        this.announceNow({
          lines: [
            `${C.green}↺ Escenario restaurado.${C.reset} ${C.dim}Todo está como al empezar la misión.${C.reset}`,
            `${C.amber}◎ OBJETIVO:${C.reset} ${highlightCode(location.mission.objective)}`,
          ],
        });
      }),

      // Las pistas pedidas desde la terminal ya las imprime el comando `pista`.
      events.on('hintRevealed', ({ index, text, cost, source }) => {
        if (source === 'ui') this.announceNow({ lines: [formatHint(index, text, cost).trimEnd()] });
      }),
      events.on('hintRejected', ({ reason, cost, source }) => {
        if (source !== 'ui') return;
        const points = this.game.view().points;
        this.announceNow({ lines: [formatHintRejection({ ok: false, reason, cost, points }).trimEnd()] });
      }),
    );
  }

  private enqueue(announcement: Announcement): void {
    this.queue.push(announcement);
  }

  /** Anuncia algo fuera del flujo normal (ej. una pista pedida con un botón). */
  private announceNow(announcement: Announcement): void {
    this.enqueue(announcement);
    if (this.busy) return; // Se mostrará al terminar lo que esté en curso.
    this.busy = true;
    // Borra la línea en edición, muestra el anuncio y la vuelve a dibujar.
    this.term.write(this.renderer.render('', '', 0, this.term.cols));
    void this.flush().then(() => this.finishBusy());
  }

  /** Vacía la cola de anuncios y, si toca, arranca la siguiente misión. */
  private async flush(): Promise<void> {
    while (!this.disposed) {
      const next = this.queue.shift();
      if (next) {
        if (next.delay && !this.skipTyping) await sleep(next.delay);
        await this.write(next);
        continue;
      }
      if (this.advancePending) {
        this.advancePending = false;
        if (!this.skipTyping) await sleep(700);
        this.game.startCurrentMission();
        continue;
      }
      break;
    }
  }

  private async write(announcement: Announcement): Promise<void> {
    // Ajuste de línea por palabras al ancho actual (las líneas pueden contener \n).
    const lines = announcement.lines.flatMap((l) => l.split('\n')).flatMap((l) => wrapAnsi(l, this.term.cols - 1));
    for (const line of lines) {
      if (!announcement.typewriter || this.skipTyping) {
        this.tty.write(line + '\n');
        continue;
      }
      // Efecto máquina de escribir respetando las secuencias ANSI (se escriben enteras).
      // eslint-disable-next-line no-control-regex
      const tokens = line.match(/\x1b\[[0-9;]*m|[\s\S]/g) ?? [];
      let chunk = '';
      let visible = 0;
      let chunks = 0;
      for (const token of tokens) {
        chunk += token;
        if (!token.startsWith('\x1b')) visible++;
        if (visible >= CHARS_PER_TICK) {
          this.term.write(chunk);
          if (++chunks % TICK_EVERY === 0 && chunk.trim()) this.sounds.play('tick');
          chunk = '';
          visible = 0;
          if (!this.skipTyping) await sleep(TYPE_SPEED_MS);
          if (this.disposed) return;
        }
      }
      this.tty.write(chunk + '\n');
    }
  }
}
