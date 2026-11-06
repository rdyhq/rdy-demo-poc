import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';

export function connect(connectionString: string) {
  return new pg.Pool({ connectionString, max: 8, connectionTimeoutMillis: 4000, statement_timeout: 8000 });
}

export async function transaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function migrate(pool: pg.Pool) {
  const dir = new URL('../db/', import.meta.url);
  const files = (await readdir(dir)).filter((file) => /^\d+_.*\.sql$/.test(file)).sort();
  await transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(497218411)');
    await client.query('CREATE TABLE IF NOT EXISTS lobby_migrations (file text PRIMARY KEY, checksum text NOT NULL)');
    for (const file of files) {
      const sql = await readFile(new URL(file, dir), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const { rows } = await client.query('SELECT checksum FROM lobby_migrations WHERE file=$1', [file]);
      if (rows[0]) {
        if (rows[0].checksum !== checksum) throw new Error('Applied migration changed: ' + file);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO lobby_migrations VALUES ($1,$2)', [file, checksum]);
    }
  });
}
