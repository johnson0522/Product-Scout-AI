import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL is required to apply migrations');
  process.exit(2);
}

const client = postgres(databaseUrl, { max: 1 });

try {
  await migrate(drizzle(client), {
    migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
  });
  console.log('Drizzle migrations applied successfully.');
} finally {
  await client.end({ timeout: 5 });
}
