import type { Env } from './env';

let schemaReady: Promise<unknown> | null = null;

/** A column added after a table was first created: databases made earlier get it with ALTER TABLE. */
export interface AddedColumn {
  table: string;
  column: string;
  definition: string;
}

/** A short fingerprint of the schema: when it is unchanged, nothing has to run. */
function fingerprint(statements: string[], columns: AddedColumn[]): string {
  let h = 0x811c9dc5;
  const text = statements.join('\n') + '\n' + columns.map((c) => `${c.table}.${c.column} ${c.definition}`).join('\n');
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return `${h.toString(16)}-${statements.length}-${columns.length}`;
}

/**
 * Creates every brick's tables on first use, so a fresh D1 database needs no manual migration.
 * Each brick owns its own `CREATE TABLE` statements (and later-added columns); the base passes
 * them all in. Once per Worker instance, and fast: when the schema is the one already applied
 * (its fingerprint is stored), a single read is all it costs.
 */
export function ensureSchema(env: Env, statements: string[], columns: AddedColumn[] = []): Promise<unknown> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const print = fingerprint(statements, columns);
      const applied = await env.DB.prepare("SELECT value FROM schema_meta WHERE key = 'schema'")
        .first<{ value: string }>()
        .catch(() => null); // a new database: no table yet
      if (applied?.value === print) return;
      await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));
      for (const { table, column, definition } of columns) {
        try {
          await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
        } catch (err) {
          // Already there (new database, or an earlier instance added it): nothing to do.
          if (!/duplicate column/i.test(String((err as Error).message))) throw err;
        }
      }
      await env.DB.batch([
        env.DB.prepare('CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)'),
        env.DB.prepare("INSERT INTO schema_meta (key, value) VALUES ('schema', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(print),
      ]);
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}
