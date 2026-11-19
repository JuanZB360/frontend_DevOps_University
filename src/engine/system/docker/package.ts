/**
 * Paquetes de Docker en Ubuntu: docker.io (motor y cliente) y
 * docker-compose-v2 (el plugin "docker compose").
 */
import { addGroup, findGroup } from '../accounts';
import { registerPackages } from '../packages';
import { restartPolicyStart, stopContainer } from './engine';
import { dockerState } from './model';

registerPackages(
  {
    name: 'docker.io', version: '26.1.3-0ubuntu1~24.04.1', section: 'admin', description: 'Linux container runtime (Docker)', sizeKB: 102_000,
    binaries: ['docker', 'dockerd'], depends: ['containerd'],
    dirs: [['/var/lib/docker', 0o710, 'root'], ['/etc/docker', 0o755, 'root']],
    service: {
      name: 'docker', description: 'Docker Application Container Engine', command: '/usr/bin/dockerd -H fd:// --containerd=/run/containerd/containerd.sock', user: 'root', memMB: 70,
      check: (fs, machine) => {
        if (!findGroup(fs, 'docker')) addGroup(fs, 'docker', true);
        dockerState(machine);
        // Los contenedores con restart=always/unless-stopped vuelven a arrancar.
        restartPolicyStart(fs, machine);
        return null;
      },
      onStop: (_fs, machine) => {
        for (const c of dockerState(machine).containers) if (c.status === 'running') stopContainer(machine, c, 0);
      },
    },
  },
  { name: 'containerd', version: '1.7.12-0ubuntu4', section: 'admin', description: 'open and reliable container runtime', sizeKB: 120_000, binaries: ['containerd', 'ctr'] },
  { name: 'docker-compose-v2', version: '2.27.1+ds1-0ubuntu1', section: 'admin', description: 'tool for running multi-container applications on Docker (plugin "docker compose")', sizeKB: 60_000, depends: ['docker.io'] },
);
