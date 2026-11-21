import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

// Explicit operator command, never run by the Agent or the application server.
const ownerId = process.env.PRODUCT_SCOUT_OWNER_ID;
if (!ownerId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId)) {
  console.error(`Set PRODUCT_SCOUT_OWNER_ID to a UUID (example: ${randomUUID()})`);
  process.exit(2);
}
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(2); }
const client = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  await client`insert into users (id, email, name) values (${ownerId}, ${`${ownerId}@local.product-scout.invalid`}, 'Local researcher') on conflict (id) do nothing`;
  console.log('Local workspace owner is ready.');
} finally { await client.end({ timeout: 5 }); }
