import { createServer } from 'vite';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const directory = await fs.mkdtemp(path.join(process.cwd(), 'artifacts', 'dev-'));
const server = await createServer({ server: { port: 5173 } });
let app;
try {
  await server.listen();
  const env = { ...process.env, COCO_DEV_URL: 'http://127.0.0.1:5173', COCO_USER_DATA: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: electronPath, args: ['.'], env });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByText('在右边的工作区里，我替你动手。').waitFor();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('API 地址').waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: development server, CSP nonce, React refresh and Electron preload');
} finally {
  await app?.close();
  await server.close();
}
