import { runYunqiaoSmoke } from './yunqiao-responses';

// Explicit developer command only; no production provider or DSH behavior changes.
try {
  const base = new URL(process.env.LLM_BASE_URL ?? 'https://api.yunqiao.me');
  if (base.origin !== 'https://api.yunqiao.me' || base.username || base.password
    || base.search || base.hash || !['', '/', '/v1', '/v1/'].includes(base.pathname)) {
    throw new Error('Smoke check only supports https://api.yunqiao.me[/v1]');
  }
  process.stdout.write('Yunqiao Responses diagnostic: model=gpt-6.1-sol; at most four model requests; no retries.\n');
  await runYunqiaoSmoke(process.env.LLM_API_KEY ?? '', (result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  });
} catch (error: unknown) {
  const key = process.env.LLM_API_KEY;
  const message = error instanceof Error ? error.message : 'Unknown diagnostic failure';
  process.stderr.write(`FAIL: ${key ? message.split(key).join('[REDACTED]') : message}\n`);
  process.exitCode = 1;
}
