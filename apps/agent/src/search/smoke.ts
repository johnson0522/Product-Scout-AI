import { createSearchTool } from './index';

// Developer-only live check; never registered as an Agent capability.
const query = process.argv.slice(2).join(' ').trim();
try {
  if (!query) throw new Error('Usage: pnpm --filter @product-scout/agent search:smoke "search query"');
  const result = await createSearchTool().execute({ query, limit: 3 }, {
    sessionId: 'search-smoke',
    researchRunId: 'search-smoke',
    toolInvocationId: 'search-smoke:1',
    emit: (event) => { process.stderr.write(`${JSON.stringify(event)}\n`); },
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Search smoke check failed'}\n`);
  process.exitCode = 1;
}
