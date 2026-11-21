import { describe, expect, it } from 'vitest';
import { BufferedOutput } from '../engine/shell/streams';
import { catalog, startNewGame } from './bootstrap';
import { finalReward, levelForXp, rankForLevel, starsFor, totalXpForLevel } from './domain/progression';
import type { GameSession } from './session/GameSession';
import { toUsername, validateDisplayName } from './session/newGame';
import { LocalStorageSaveRepository, parseSave, type KeyValueStorage } from './storage/LocalStorageSaveRepository';

/** localStorage falso en memoria. */
function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

async function run(game: GameSession, line: string): Promise<string> {
  const out = new BufferedOutput();
  const report = await game.shell.execute(line, out);
  game.handleReport(report);
  return out.toString();
}

describe('progresión', () => {
  it('calcula niveles y rangos', () => {
    expect(totalXpForLevel(1)).toBe(0);
    expect(totalXpForLevel(2)).toBe(100);
    expect(totalXpForLevel(3)).toBe(250);
    expect(levelForXp(249)).toBe(2);
    expect(levelForXp(250)).toBe(3);
    expect(rankForLevel(1)).toBe('Script Kiddie');
    expect(rankForLevel(10)).toBe('Sysadmin Jr');
  });

  it('las pistas reducen estrellas y experiencia', () => {
    expect([0, 1, 2, 3].map(starsFor)).toEqual([3, 2, 2, 1]);
    expect(finalReward({ xp: 100, points: 20 }, 0)).toEqual({ xp: 100, points: 30 });
    expect(finalReward({ xp: 100, points: 20 }, 3)).toEqual({ xp: 50, points: 20 });
  });
});

describe('nombre de usuario', () => {
  it('deriva un usuario Linux válido', () => {
    expect(toUsername('José Pérez')).toBe('joseperez');
    expect(toUsername('123 Neo!')).toBe('neo');
    expect(toUsername('root')).toBe('root1');
    expect(validateDisplayName('a')).not.toBeNull();
    expect(validateDisplayName('Trinity')).toBeNull();
  });
});

describe('GameSession', () => {
  it('bloquea comandos hasta que una misión los enseña', async () => {
    const game = startNewGame('Neo', new LocalStorageSaveRepository(memoryStorage()));
    expect(await run(game, 'pwd')).toContain('ENCRIPTADO');
    game.startCurrentMission();
    expect(game.isUnlocked('whoami')).toBe(true);
    expect(game.isUnlocked('pwd')).toBe(false);
  });

  it('cobra las pistas y rechaza si no hay puntos', () => {
    const game = startNewGame('Neo', new LocalStorageSaveRepository(memoryStorage()));
    game.startCurrentMission();
    const first = game.revealHint('ui');
    expect(first.ok).toBe(true);
    expect(game.view().points).toBe(20);
    expect(game.revealHint('ui')).toMatchObject({ ok: false, reason: 'no-points', cost: 25 });
  });

  it('se puede jugar TODA la universidad usando las soluciones', async () => {
    const storage = memoryStorage();
    const game = startNewGame('Neo', new LocalStorageSaveRepository(storage));
    let finished = false;
    game.events.on('allMissionsCompleted', () => (finished = true));

    for (const { mission } of catalog.all()) {
      const started = game.startCurrentMission();
      expect(started?.mission.id).toBe(mission.id);
      await run(game, mission.solution);
      expect(game.view().completedMissions[mission.id], `La solución de ${mission.id} no completa la misión`).toBeDefined();
    }
    game.startCurrentMission();
    expect(finished).toBe(true);
    expect(game.view().completedCount).toBe(catalog.size);
    expect(game.view().level).toBeGreaterThan(5);
  });

  it('ninguna misión se completa sola al empezar (sin hacer nada)', async () => {
    const game = startNewGame('Neo', new LocalStorageSaveRepository(memoryStorage()));
    for (const { mission } of catalog.all()) {
      game.startCurrentMission();
      await run(game, 'help');
      expect(game.view().completedMissions[mission.id], `${mission.id} se completó sin resolverla`).toBeUndefined();
      await run(game, mission.solution);
    }
  });

  it('persiste y restaura la partida, incluido el sistema de archivos', async () => {
    const storage = memoryStorage();
    const repository = new LocalStorageSaveRepository(storage);
    const game = startNewGame('Trinity', repository);
    game.startCurrentMission();
    await run(game, 'whoami');

    const restored = repository.load();
    expect(restored?.player.username).toBe('trinity');
    expect(restored?.completedMissions['linux-01-01']).toBeDefined();
    expect(parseSave(game.exportSave()).xp).toBe(game.view().xp);
  });

  it('rechaza importar archivos que no son partidas', () => {
    expect(() => parseSave('{"hola": 1}')).toThrowError(/no es una partida/);
  });
});

describe('contenido', () => {
  it('cada comando que enseña una misión existe y tiene manual', async () => {
    const { ALL_DOCS } = await import('./bootstrap');
    const { createCommandRegistry } = await import('../engine/commands/index');
    const registry = createCommandRegistry({ manuals: { lookup: () => ({ status: 'missing' }) } });
    const docs = new Set(ALL_DOCS.map((d) => d.name));
    const taught = [...new Set(catalog.all().flatMap((l) => l.mission.teaches))];
    expect(taught.filter((t) => !registry.has(t)), 'comandos inexistentes').toEqual([]);
    expect(taught.filter((t) => !docs.has(t)), 'comandos sin manual').toEqual([]);
  });

  it('los identificadores de misión siguen el formato modulo-capitulo-numero', () => {
    for (const { mission } of catalog.all()) expect(mission.id).toMatch(/^[a-z]+-\d{2}-\d{2}$/);
  });
});

describe('wrapAnsi', () => {
  it('corta entre palabras, mantiene la sangría e ignora los colores', async () => {
    const { wrapAnsi } = await import('./presentation/ansiText');
    const line = '  uno dos \x1b[1mtres\x1b[0m cuatro cinco seis siete ocho';
    const wrapped = wrapAnsi(line, 22);
    expect(wrapped.length).toBeGreaterThan(1);
    // eslint-disable-next-line no-control-regex
    expect(wrapped.every((l) => l.replace(/\x1b\[[0-9;]*m/g, '').length <= 22)).toBe(true);
    expect(wrapped.every((l) => l.startsWith('  '))).toBe(true);
    expect(wrapped.join(' ').replace(/\s+/g, ' ')).toBe(line.replace(/\s+/g, ' '));
  });
});

describe('reiniciar escenario', () => {
  /** Juega hasta dejar activa la misión indicada. */
  async function playUntil(game: GameSession, missionId: string): Promise<void> {
    for (const { mission } of catalog.all()) {
      game.startCurrentMission();
      if (mission.id === missionId) return;
      await run(game, mission.solution);
    }
  }

  it('deshace los cambios del jugador y restaura el escenario original', async () => {
    const game = startNewGame('Neo', new LocalStorageSaveRepository(memoryStorage()));
    await playUntil(game, 'linux-03-08');
    const original = game.fs.readDir('/home/neo/caos').map((n) => n.name);

    // El jugador lo desordena todo a medias...
    await run(game, 'cd ~/caos && mkdir imagenes && mv *.png imagenes/ && rm cache.tmp && touch basura.txt');
    expect(game.fs.readDir('/home/neo/caos').map((n) => n.name)).not.toEqual(original);

    // ...y reinicia el escenario.
    expect(game.restartMission('ui')).toBe(true);
    expect(game.fs.readDir('/home/neo/caos').map((n) => n.name)).toEqual(original);
  });

  it('anuncia el reinicio para que la interfaz pueda reaccionar', async () => {
    const game = startNewGame('Neo', new LocalStorageSaveRepository(memoryStorage()));
    game.startCurrentMission();
    const announced: string[] = [];
    game.events.on('missionRestarted', ({ location, source }) => announced.push(`${location.mission.id}:${source}`));
    game.restartMission('ui');
    expect(announced).toEqual(['linux-01-01:ui']);
  });

  it('vuelve a llevar al jugador al punto de partida de la misión', async () => {
    const game = startNewGame('Neo', new LocalStorageSaveRepository(memoryStorage()));
    await playUntil(game, 'linux-02-04'); // empieza en /var/log
    await run(game, 'cd /etc');
    game.restartMission('ui');
    expect(game.session.cwd).toBe('/var/log');
  });

  it('completa la misión de grep (linux-06-04) en una terminal interactiva TTY con colores ANSI', async () => {
    const game = startNewGame('Neo', new LocalStorageSaveRepository(memoryStorage()));
    await playUntil(game, 'linux-06-04');
    const started = game.startCurrentMission();
    expect(started?.mission.id).toBe('linux-06-04');

    const ttyOut = {
      isTTY: true,
      buffer: '',
      write(text: string) { this.buffer += text; },
    };
    const report = await game.shell.execute('grep ERROR /var/log/app.log', ttyOut);
    game.handleReport(report);
    expect(game.view().completedMissions['linux-06-04']).toBeDefined();
  });
});
