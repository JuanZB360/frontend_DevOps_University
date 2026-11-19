import { describe, expect, it } from 'vitest';
import { createTestShell } from '../../testing/createTestShell';

async function withNginx() {
  const sh = createTestShell();
  await sh.run('sudo apt update && sudo apt install -y nginx');
  return sh;
}

describe('nginx simulado', () => {
  it('se instala, arranca y sirve la página de bienvenida', async () => {
    const sh = await withNginx();
    expect((await sh.run('systemctl is-active nginx')).output).toBe('active\n');
    expect((await sh.run('curl -s localhost')).output).toContain('Welcome to nginx!');
    expect((await sh.run('curl -sI localhost')).output).toMatch(/HTTP\/1\.1 200 OK[\s\S]*Server: nginx\/1\.24\.0 \(Ubuntu\)/);
    expect((await sh.run('cat /var/log/nginx/access.log')).output).toContain('"GET / HTTP/1.1" 200');
  });

  it('nginx -t detecta errores y reload no aplica una configuración rota', async () => {
    const sh = await withNginx();
    await sh.run("printf 'server {\\n    lisen 8080;\\n}\\n' | sudo tee /etc/nginx/sites-available/roto && sudo ln -s /etc/nginx/sites-available/roto /etc/nginx/sites-enabled/");
    const t = await sh.run('sudo nginx -t');
    expect(t.output).toContain('unknown directive "lisen" in /etc/nginx/sites-enabled/roto:2');
    expect(t.report.exitCode).toBe(1);
    expect((await sh.run('sudo systemctl reload nginx')).report.exitCode).toBe(1);
    expect((await sh.run('curl -s localhost')).output).toContain('Welcome');
  });

  it('virtual hosts, try_files y reload', async () => {
    const sh = await withNginx();
    await sh.run("sudo mkdir -p /var/www/tienda && echo '<h1>Tienda</h1>' | sudo tee /var/www/tienda/index.html");
    await sh.run("printf 'server {\\n    listen 80;\\n    server_name tienda.devops-u.com;\\n    root /var/www/tienda;\\n    index index.html;\\n    location / {\\n        try_files $uri $uri/ /index.html;\\n    }\\n}\\n' | sudo tee /etc/nginx/sites-available/tienda");
    await sh.run('sudo ln -s /etc/nginx/sites-available/tienda /etc/nginx/sites-enabled/tienda');
    expect((await sh.run('curl -s -H "Host: tienda.devops-u.com" localhost')).output).toContain('Welcome');
    await sh.run('sudo nginx -t && sudo systemctl reload nginx');
    expect((await sh.run('curl -s -H "Host: tienda.devops-u.com" localhost/productos/42')).output).toBe('<h1>Tienda</h1>\n');
    expect((await sh.run('curl -s localhost')).output).toContain('Welcome');
  });

  it('proxy inverso con balanceo y 502 cuando cae el backend', async () => {
    const sh = await withNginx();
    await sh.run('sudo apt install -y nodejs');
    sh.fs.privileged(() => {
      sh.fs.mkdir('/srv/api', true);
      sh.fs.writeFile('/srv/api/server.js', "app.listen(process.env.PORT || 3000);\n");
    });
    await sh.run('PORT=3001 node /srv/api/server.js & PORT=3002 node /srv/api/server.js &');
    await sh.run("printf 'upstream api {\\n    server 127.0.0.1:3001;\\n    server 127.0.0.1:3002;\\n}\\nserver {\\n    listen 8080;\\n    location / {\\n        proxy_pass http://api;\\n        proxy_set_header Host $host;\\n    }\\n}\\n' | sudo tee /etc/nginx/conf.d/api.conf && sudo systemctl reload nginx");
    const first = (await sh.run('curl -s localhost:8080/pedidos')).output;
    const second = (await sh.run('curl -s localhost:8080/pedidos')).output;
    expect([first, second].map((o) => JSON.parse(o).instancia).sort()).toEqual([3001, 3002]);
    await sh.run('pkill -f server.js');
    expect((await sh.run('curl -s -o /dev/null -w "%{http_code}" localhost:8080')).output).toBe('502');
    expect((await sh.run('sudo tail -1 /var/log/nginx/error.log')).output).toContain('Connection refused');
  });

  it('certbot activa HTTPS con redirección', async () => {
    const sh = await withNginx();
    await sh.run('sudo apt install -y certbot python3-certbot-nginx');
    await sh.run("sudo mkdir -p /var/www/tienda && echo hola | sudo tee /var/www/tienda/index.html && printf 'server {\\n    listen 80;\\n    server_name tienda.devops-u.com;\\n    root /var/www/tienda;\\n}\\n' | sudo tee /etc/nginx/sites-available/tienda && sudo ln -s /etc/nginx/sites-available/tienda /etc/nginx/sites-enabled/ && sudo systemctl reload nginx");
    const out = await sh.run('sudo certbot --nginx -d tienda.devops-u.com --non-interactive --agree-tos -m yo@devops-u.com');
    expect(out.output).toContain('Congratulations');
    expect((await sh.run('curl -sI http://tienda.devops-u.com')).output).toMatch(/301[\s\S]*Location: https:\/\/tienda\.devops-u\.com\//i);
    expect((await sh.run('curl -s https://tienda.devops-u.com')).output).toBe('hola\n');
  });
});
