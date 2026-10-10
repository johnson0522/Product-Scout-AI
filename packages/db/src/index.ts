import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

export function createDb(connectionString: string) {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to create a database client');
  }

  const client = postgres(connectionString);
  return { client, db: drizzle(client, { schema }) };
}

export type Database = ReturnType<typeof createDb>['db'];
export { schema };
export * from './schema';
export * from './repositories';
export * from './drizzle-repositories';
export * from './drizzle-evidence-store';
