import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? 3000);

// Placeholder: no domain logic, no persistence, no routes yet — only a health check.
const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ service: 'core-api', status: 'ok' }));
    return;
  }
  res.writeHead(404).end();
});

server.listen(port, () => {
  console.log(`[core-api] placeholder listening on http://localhost:${port}`);
});
