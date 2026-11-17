import type { Env } from './env';

let schemaReady: Promise<unknown> | null = null;

/** A column added after a table was first created: databases made earlier get it with ALTER TABLE. */
export interface AddedColumn {
  table: string;
  column: string;
  definition: string;
}

/**
 * Creates every brick's tables on first use, so a fresh D1 database needs no manual migration.
 * Each brick owns its own `CREATE TABLE` statements (and later-added columns); the base passes
 * them all in. Runs once per Worker instance.
 */
export function ensureSchema(env: Env, statements: string[], columns: AddedColumn[] = []): Promise<unknown> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));
      for (const { table, column, definition } of columns) {
        try {
          await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
        } catch (err) {
          // Already there (new database, or an earlier instance added it): nothing to do.
          if (!/duplicate column/i.test(String((err as Error).message))) throw err;
        }
      }
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}
