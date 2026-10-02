/** Use TLS for hosted PostgreSQL while preserving local development connections. */
export function seedConnectionString(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is not configured.');
  const url = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection string.');
  }
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname) && !url.searchParams.has('sslmode')) {
    url.searchParams.set('sslmode', 'verify-full');
  }
  return url.toString();
}
