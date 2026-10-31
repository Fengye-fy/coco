import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { randomBytes } from 'node:crypto';

export default defineConfig(({ command }) => {
  const nonce = randomBytes(18).toString('base64');
  return {
    base: './',
    html: command === 'serve' ? { cspNonce: nonce } : undefined,
    plugins: [react(), {
      name: 'coco-dev-csp',
      apply: 'serve',
      transformIndexHtml(html) { return html.replace("script-src 'self';", `script-src 'self' 'nonce-${nonce}';`); },
    }],
    server: { host: '127.0.0.1', port: 5173, strictPort: true, watch: { ignored: ['**/artifacts/**', '**/release/**', '**/.dev-data/**'] } },
    build: { outDir: 'dist', sourcemap: false },
  };
});
