import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Dev-only helper for the asset bakers in /tools: POST /__save?path=public/... writes the body to disk.
function bakeSaver() {
  return {
    name: 'bake-saver',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__save', (req, res) => {
        const rel = new URL(req.url, 'http://x').searchParams.get('path') || '';
        const out = path.resolve(process.cwd(), rel);
        if (!out.startsWith(path.resolve(process.cwd(), 'public')) && !out.startsWith(path.resolve(process.cwd(), '..', 'one-take-raw'))) {
          res.statusCode = 403; res.end('forbidden'); return;
        }
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          fs.mkdirSync(path.dirname(out), { recursive: true });
          fs.writeFileSync(out, Buffer.concat(chunks));
          res.end('ok');
        });
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [bakeSaver()],
  server: { port: 5173, strictPort: true, fs: { allow: ['..'] } },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
