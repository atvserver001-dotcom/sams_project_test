import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const root = new URL('../', import.meta.url);
const port = Number(process.argv[2] || 18473);

// Expose only review documents and PNGs, never the application or its config.
function resource(pathname) {
  if (pathname === '/docs/review.html') {
    return ['docs/review.html', 'text/html; charset=utf-8'];
  }
  if (pathname === '/docs/REDESIGN-2026-09.md') {
    return ['docs/REDESIGN-2026-09.md', 'text/plain; charset=utf-8'];
  }
  if (/^\/output\/playwright\/[a-zA-Z0-9_-]+\.png$/.test(pathname)) {
    return [pathname.slice(1), 'image/png'];
  }
  return null;
}

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  const { pathname } = new URL(request.url, 'http://127.0.0.1');
  if (pathname === '/') {
    response.writeHead(302, { Location: '/docs/review.html' }).end();
    return;
  }

  const target = resource(pathname);
  if (!target) {
    response.writeHead(404).end();
    return;
  }

  try {
    const content = await readFile(new URL(target[0], root));
    response.writeHead(200, {
      'Content-Type': target[1],
      'Content-Length': content.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
  }
});

server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Review gallery: http://127.0.0.1:${port}/docs/review.html`);
});
