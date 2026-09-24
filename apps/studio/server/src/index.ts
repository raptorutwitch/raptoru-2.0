import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? 4100);
// Studio is local-only: bind to loopback, never to a public interface.
const host = '127.0.0.1';

// Placeholder: no Core client, no OBS bridge yet — only a health check.
const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ service: 'studio-server', status: 'ok' }));
    return;
  }
  res.writeHead(404).end();
});

server.listen(port, host, () => {
  console.log(
    `[studio-server] placeholder listening on http://${host}:${port}`,
  );
});
