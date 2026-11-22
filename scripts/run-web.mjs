import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (mode !== 'dev' && mode !== 'start') {
  console.error('Usage: node scripts/run-web.mjs <dev|start> [Next.js options]');
  process.exit(2);
}

const webDirectory = fileURLToPath(new URL('../apps/web/', import.meta.url));
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
const nextBin = fileURLToPath(new URL('../apps/web/node_modules/next/dist/bin/next', import.meta.url));
// Inherited env takes precedence over --env-file, so a shared .env cannot make
// `next start` run as development or make `next dev` run as production.
const child = spawn(process.execPath, [
  `--env-file=${envFile}`, nextBin, mode, '--hostname', '127.0.0.1', ...process.argv.slice(3),
], {
  cwd: webDirectory,
  env: { ...process.env, NODE_ENV: mode === 'dev' ? 'development' : 'production' },
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { child.kill(signal); });
}
child.on('error', () => {
  console.error('Next.js process failed to start. Check the Node.js installation and workspace dependencies.');
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
});
