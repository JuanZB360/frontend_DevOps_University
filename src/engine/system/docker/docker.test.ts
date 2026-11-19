import { describe, expect, it } from 'vitest';
import { createTestShell } from '../../testing/createTestShell';

async function withDocker() {
  const sh = createTestShell();
  await sh.run('sudo apt update && sudo apt install -y docker.io docker-compose-v2 && sudo usermod -aG docker neo && newgrp docker');
  return sh;
}

describe('docker simulado', () => {
  it('pide grupo docker y ejecuta hello-world', async () => {
    const sh = createTestShell();
    await sh.run('sudo apt update && sudo apt install -y docker.io');
    expect((await sh.run('docker ps')).output).toContain('permission denied');
    await sh.run('sudo usermod -aG docker neo && newgrp docker');
    expect((await sh.run('docker run hello-world')).output).toContain('Hello from Docker!');
    expect((await sh.run('docker ps -a')).output).toMatch(/hello-world[\s\S]*Exited \(0\)/);
  });

  it('nginx en un contenedor con puerto publicado y bind mount', async () => {
    const sh = await withDocker();
    await sh.run('mkdir -p ~/web && echo "<h1>Desde Docker</h1>" > ~/web/index.html');
    await sh.run('docker run -d --name web -p 8080:80 -v ~/web:/usr/share/nginx/html:ro nginx');
    expect((await sh.run('curl -s localhost:8080')).output).toBe('<h1>Desde Docker</h1>\n');
    expect((await sh.run('docker run -d -p 8080:80 nginx')).output).toContain('port is already allocated');
    await sh.run('docker stop web');
    expect((await sh.run('curl -s localhost:8080')).report.exitCode).toBe(7);
  });

  it('postgres exige contraseña; volúmenes persisten', async () => {
    const sh = await withDocker();
    await sh.run('docker run -d --name db postgres:16');
    expect((await sh.run('docker logs db')).output).toContain('POSTGRES_PASSWORD');
    await sh.run('docker rm db && docker run -d --name db -e POSTGRES_PASSWORD=secreto -v datos:/var/lib/postgresql/data postgres:16');
    expect((await sh.run('docker ps')).output).toContain('db');
    await sh.run('docker rm -f db && docker run -d --name db2 -e POSTGRES_PASSWORD=x -v datos:/var/lib/postgresql/data postgres:16');
    expect((await sh.run('docker logs db2')).output).toContain('Skipping initialization');
  });

  it('build con caché de capas y multi-stage', async () => {
    const sh = await withDocker();
    await sh.run('mkdir -p ~/app && cd ~/app && echo \'{"name":"app"}\' > package.json && echo "// RESPUESTA: Hola desde mi imagen" > server.js');
    await sh.run("printf 'FROM node:20-alpine\\nWORKDIR /app\\nCOPY package.json .\\nRUN npm install\\nCOPY . .\\nEXPOSE 3000\\nCMD [\"node\", \"server.js\"]\\n' > ~/app/Dockerfile");
    const first = await sh.run('cd ~/app && docker build -t miapp:1.0 .');
    expect(first.output).toContain('naming to docker.io/library/miapp:1.0');
    await sh.run('echo "// RESPUESTA: Version 2" > ~/app/server.js');
    const second = await sh.run('cd ~/app && docker build -t miapp:1.1 .');
    expect(second.output).toMatch(/CACHED .*RUN npm install/);
    expect(second.output).not.toMatch(/CACHED .*COPY \. \./);
    await sh.run('docker run -d -p 3000:3000 miapp:1.1');
    expect((await sh.run('curl -s localhost:3000')).output).toBe('Version 2\n');
    expect((await sh.run("printf 'FROM nginx\\nRUNN echo hola\\n' > ~/app/Dockerfile.malo && cd ~/app && docker build -f Dockerfile.malo .")).output).toContain('unknown instruction: RUNN');
  });

  it('redes: los contenedores se encuentran por nombre en una red propia', async () => {
    const sh = await withDocker();
    await sh.run('docker network create red && docker run -d --name api --network red miapp 2>/dev/null; docker run -d --name web1 --network red nginx && docker run -d --name web2 nginx');
    await sh.run('docker run -d --name web3 --network red nginx');
    expect((await sh.run('docker exec web1 curl -s http://web3')).output).toContain('Welcome to nginx');
    expect((await sh.run('docker exec web2 curl -s http://web3')).output).toContain('Could not resolve host');
  });

  it('compose levanta, lista y baja un proyecto', async () => {
    const sh = await withDocker();
    await sh.run('mkdir -p ~/proyecto');
    sh.fs.writeFile('/home/neo/proyecto/compose.yaml', 'services:\n  web:\n    image: nginx:alpine\n    ports:\n      - "8081:80"\n    depends_on:\n      - db\n  db:\n    image: postgres:16\n    environment:\n      POSTGRES_PASSWORD: secreto\n    volumes:\n      - datos:/var/lib/postgresql/data\nvolumes:\n  datos:\n');
    await sh.run('cd ~/proyecto && docker compose up -d');
    const ps = await sh.run('cd ~/proyecto && docker compose ps');
    expect(ps.output).toContain('proyecto-web-1');
    expect(ps.output).toContain('proyecto-db-1');
    expect((await sh.run('curl -s localhost:8081')).output).toContain('Welcome to nginx');
    await sh.run('cd ~/proyecto && docker compose down');
    expect((await sh.run('docker ps -a')).output).not.toContain('proyecto-web-1');
    expect((await sh.run('docker volume ls')).output).toContain('proyecto_datos');
    sh.fs.writeFile('/home/neo/proyecto/compose.yaml', 'services:\n  web:\n    image: nginx\n    portz:\n      - "80:80"\n');
    expect((await sh.run('cd ~/proyecto && docker compose config')).output).toContain("additional properties 'portz' not allowed");
  });
});
