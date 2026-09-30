import { createClient, type InValue, type Transaction } from '@libsql/client';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const remoteUrl = process.env.TURSO_DATABASE_URL;
if (remoteUrl && process.env.NODE_ENV !== 'production' && process.env.APP_ENV !== 'production') {
  throw new Error('Remote databases require production mode; demo seeding is local only.');
}
if (process.env.VERCEL && (!remoteUrl || !process.env.TURSO_AUTH_TOKEN)) {
  throw new Error('Connect a Turso database before deploying StockSense on Vercel.');
}
const localPath = path.resolve(process.env.DB_PATH || 'data/stocksense.db');
if (!remoteUrl) fs.mkdirSync(path.dirname(localPath), { recursive: true });
const client = createClient({
  url: remoteUrl || pathToFileURL(localPath).href,
  authToken: remoteUrl ? process.env.TURSO_AUTH_TOKEN : undefined,
  intMode: 'number',
});
const scope = new AsyncLocalStorage<Transaction>();
// Serialize work on this client so a local transaction never receives queries
// from another request. Remote write transactions also retain their own stream.
let pending: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const result = pending.then(fn, fn);
  pending = result.catch(() => undefined);
  return result;
}
function execute(sql: string, args: unknown[]) {
  const statement = { sql, args: args.map(v => v === undefined ? null : v) as InValue[] };
  const tx = scope.getStore();
  return tx ? tx.execute(statement) : exclusive(() => client.execute(statement));
}
export const db = {
  prepare(sql: string) {
    return {
      async all(...args: unknown[]): Promise<Record<string, any>[]> {
        return (await execute(sql, args)).rows.map(row => Object.fromEntries(Object.entries(row)));
      },
      async get(...args: unknown[]): Promise<Record<string, any> | undefined> {
        const row = (await execute(sql, args)).rows[0];
        return row ? Object.fromEntries(Object.entries(row)) : undefined;
      },
      async run(...args: unknown[]) {
        const result = await execute(sql, args);
        return { changes: result.rowsAffected, lastInsertRowid: result.lastInsertRowid };
      },
    };
  },
  async exec(sql: string) {
    const tx = scope.getStore();
    if (tx) await tx.executeMultiple(sql);
    else await exclusive(() => client.executeMultiple(sql));
  },
  async pragma(sql: string) {
    // The remote service manages journal mode and busy timeout itself.
    if (remoteUrl && /^(journal_mode|busy_timeout)\s*=/i.test(sql)) return [];
    return (await execute(`PRAGMA ${sql}`, [])).rows.map(row => Object.fromEntries(Object.entries(row))) as Record<string, any>[];
  },
  transaction<T>(fn: () => T | Promise<T>) {
    return async (): Promise<T> => {
      if (scope.getStore()) throw new Error('Nested database transactions are not supported.');
      return exclusive(async () => {
        const tx = await client.transaction('write');
        try {
          const result = await scope.run(tx, fn);
          await tx.commit();
          return result;
        } catch (error) {
          if (!tx.closed) await tx.rollback();
          throw error;
        } finally { tx.close(); }
      });
    };
  },
};
