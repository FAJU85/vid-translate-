import type { Env } from './env';

let schemaReady: Promise<unknown> | null = null;

/**
 * Creates every brick's tables on first use, so a fresh D1 database needs no manual migration.
 * Each brick owns its own `CREATE TABLE` statements; the base passes them all in.
 */
export function ensureSchema(env: Env, statements: string[]): Promise<unknown> {
  if (!schemaReady) {
    schemaReady = env.DB.batch(statements.map((sql) => env.DB.prepare(sql))).catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}
