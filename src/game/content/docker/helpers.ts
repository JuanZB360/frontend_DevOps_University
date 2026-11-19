/**
 * Ayudantes para las misiones de Docker.
 */
import { groupsOf, setGroupMembers, findGroup } from '../../../engine/system/accounts';
import { createContainer, removeContainer, startContainer, pullImage } from '../../../engine/system/docker/engine';
import { dockerState, type Container, type DockerState } from '../../../engine/system/docker/model';
import { readMachine } from '../../../engine/system/machine';
import type { MissionCheck, MissionWorld, ValidationContext } from '../../domain/curriculum';
import { withMachine } from '../../missions/worldHelpers';
import { ensurePackage } from '../nginx/helpers';

/** Docker instalado, en marcha, y el jugador en el grupo docker. */
export function ensureDocker(world: MissionWorld, compose = false): void {
  ensurePackage(world, 'docker.io');
  if (compose) ensurePackage(world, 'docker-compose-v2');
  const user = world.session.username;
  const group = findGroup(world.fs, 'docker');
  if (group && !group.members.includes(user)) setGroupMembers(world.fs, 'docker', [...group.members, user]);
  world.session.setGroups(groupsOf(world.fs, user));
}

export function docker(ctx: ValidationContext): DockerState {
  return dockerState(readMachine(ctx.fs));
}

export const dockerCheck = (predicate: (state: DockerState, ctx: ValidationContext) => boolean): MissionCheck =>
  (ctx) => predicate(docker(ctx), ctx);

export function runningContainer(state: DockerState, name: string): Container | undefined {
  return state.containers.find((c) => c.name === name && c.status === 'running');
}

/** Elimina contenedores (por nombre) para empezar limpio. */
export function removeContainers(world: MissionWorld, ...names: string[]): void {
  withMachine(world, (m) => {
    const state = dockerState(m);
    for (const c of [...state.containers]) if (names.includes(c.name) || names.some((n) => n.endsWith('*') && c.name.startsWith(n.slice(0, -1)))) removeContainer(m, c);
  });
}

/** Descarga una imagen (como si ya se hubiera hecho docker pull). */
export function ensureImage(world: MissionWorld, ref: string): void {
  withMachine(world, (m) => {
    pullImage(dockerState(m), ref, world.fs.now());
  });
}

/** Contenedor en marcha creado por el escenario. */
export function ensureContainer(world: MissionWorld, name: string, image: string, options: { ports?: [number, number][]; env?: Record<string, string>; network?: string } = {}): void {
  withMachine(world, (m) => {
    const state = dockerState(m);
    if (state.containers.some((c) => c.name === name && c.status === 'running')) return;
    const old = state.containers.find((c) => c.name === name);
    if (old) removeContainer(m, old);
    if (options.network && !state.networks[options.network]) state.networks[options.network] = { driver: 'bridge', subnet: '172.30.0.0/16', created: world.fs.now() };
    const c = createContainer(world.fs, m, {
      image, name, detach: true, interactive: false,
      ports: (options.ports ?? []).map(([host, container]) => ({ host, container })),
      env: options.env ?? {}, mounts: [], networks: options.network ? [options.network] : [], cmd: [], restart: 'no', remove: false, readOnly: false, memoryMB: null,
    }, () => undefined);
    startContainer(world.fs, m, c);
  });
}
