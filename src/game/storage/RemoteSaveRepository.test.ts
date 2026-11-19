import { describe, expect, it, vi } from 'vitest';
import { coreBinaryNames } from '../../engine/commands/index';
import { createNewSave } from '../session/newGame';
import { ProgressPushError, RemoteSaveRepository, type ProgressGateway } from './RemoteSaveRepository';
import type { SaveGame } from './SaveGame';

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function newSave(xp = 0): SaveGame {
  return { ...createNewSave('neo', coreBinaryNames()), xp };
}

/** Servidor falso: registra cada envío y permite decidir cómo responde. */
function fakeServer() {
  const pushes: { xp: number; replace: boolean; keepalive: boolean }[] = [];
  let respond: () => Promise<void> = () => Promise.resolve();
  const gateway: ProgressGateway = {
    push(save, replace, keepalive) {
      pushes.push({ xp: save.xp, replace, keepalive });
      return respond();
    },
  };
  return { gateway, pushes, setResponse: (fn: () => Promise<void>) => (respond = fn) };
}

function setup(alive = { value: true }) {
  const server = fakeServer();
  const onSessionLost = vi.fn();
  const repo = new RemoteSaveRepository(server.gateway, newSave(), {
    isSessionAlive: () => alive.value,
    onSessionLost,
    retryMs: 5,
  });
  return { server, repo, onSessionLost, alive };
}

describe('RemoteSaveRepository', () => {
  it('envía en serie y solo la versión más reciente', async () => {
    const { server, repo } = setup();
    repo.save(newSave(10));
    repo.save(newSave(20));
    repo.save(newSave(30));
    expect(await repo.flush()).toBe(true);
    // El primero salió enseguida; los otros dos se fusionan en un único envío.
    expect(server.pushes.map((p) => p.xp)).toEqual([10, 30]);
    expect(repo.getStatus()).toBe('saved');
  });

  it('si se borra la sesión del navegador deja de guardar y avisa (no "resucita" al usuario)', async () => {
    const { server, repo, onSessionLost, alive } = setup();
    alive.value = false; // p. ej. se borró el localStorage desde DevTools
    repo.save(newSave(50));
    repo.save(newSave(60));
    repo.flushOnUnload();
    await tick();
    expect(server.pushes).toEqual([]);
    expect(onSessionLost).toHaveBeenCalledTimes(1);
  });

  it('si el servidor responde 401 cierra la sesión', async () => {
    const { server, repo, onSessionLost } = setup();
    server.setResponse(() => Promise.reject(new ProgressPushError('unauthorized')));
    repo.save(newSave(5));
    await repo.flush();
    expect(onSessionLost).toHaveBeenCalledTimes(1);
    repo.save(newSave(6));
    await tick();
    expect(server.pushes).toHaveLength(1);
  });

  it('sin conexión reintenta sin perder el progreso ni la marca de reemplazo', async () => {
    const { server, repo } = setup();
    let failures = 2;
    server.setResponse(() => (failures-- > 0 ? Promise.reject(new ProgressPushError('network')) : Promise.resolve()));
    repo.replace(newSave(0));
    await tick(1);
    expect(repo.getStatus()).toBe('offline');
    await tick(40);
    expect(repo.getStatus()).toBe('saved');
    expect(server.pushes).toHaveLength(3);
    expect(server.pushes.every((p) => p.replace)).toBe(true);
  });

  it('ante un conflicto (el servidor va por delante) no insiste', async () => {
    const { server, repo } = setup();
    server.setResponse(() => Promise.reject(new ProgressPushError('conflict')));
    repo.save(newSave(1));
    expect(await repo.flush()).toBe(false);
    repo.save(newSave(2));
    await tick(20);
    expect(repo.getStatus()).toBe('conflict');
    expect(server.pushes).toHaveLength(1);
  });

  it('al cerrar la pestaña manda lo pendiente con keepalive', async () => {
    const { server, repo } = setup();
    server.setResponse(() => new Promise(() => undefined)); // petición que nunca termina
    repo.save(newSave(70));
    repo.save(newSave(80));
    repo.flushOnUnload();
    expect(server.pushes.at(-1)).toEqual({ xp: 80, replace: false, keepalive: true });
  });
});
