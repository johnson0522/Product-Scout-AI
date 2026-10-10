const marker = process.env.PRODUCT_SCOUT_TEST_DATABASE;
const databaseUrl = process.env.TEST_DATABASE_URL;

if (marker !== '1') {
  console.error('BLOCKED: set PRODUCT_SCOUT_TEST_DATABASE=1 to authorize the dedicated test database');
  process.exit(2);
}

if (!databaseUrl) {
  console.error('BLOCKED: TEST_DATABASE_URL is required; DATABASE_URL is never used as a fallback');
  process.exit(2);
}

let parsed;
try {
  parsed = new URL(databaseUrl);
} catch {
  console.error('BLOCKED: TEST_DATABASE_URL is not a valid PostgreSQL URL');
  process.exit(2);
}

const databaseName = parsed.pathname.replace(/^\//, '');
const isDedicatedTarget = parsed.protocol === 'postgresql:'
  && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
  && parsed.port === '55432'
  && databaseName === 'product_scout_test';

if (!isDedicatedTarget) {
  console.error('BLOCKED: TEST_DATABASE_URL must target localhost:55432/product_scout_test');
  process.exit(2);
}

console.log('Dedicated PostgreSQL test database configuration accepted.');