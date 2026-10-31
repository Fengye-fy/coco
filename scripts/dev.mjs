import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';

const server = await createServer();
await server.listen();
const env = { ...process.env, COCO_DEV_URL: 'http://127.0.0.1:5173' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { env, stdio: 'inherit', windowsHide: true });
let stopping = false;
async function close(code = 0) {
  if (stopping) return;
  stopping = true;
  child.kill();
  await server.close();
  process.exit(code);
}
child.on('exit', code => close(code ?? 0));
process.on('SIGINT', () => close());
process.on('SIGTERM', () => close());
