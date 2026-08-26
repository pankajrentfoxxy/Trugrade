import * as SQLite from 'expo-sqlite';
import { migrate, type Db, type SqlValue } from './db';

/**
 * The production driver. The only file in the queue's dependency chain that
 * knows React Native exists.
 *
 * WAL is on because the sync worker writes while a screen reads, and the default
 * rollback journal makes those block each other — on a phone that shows up as
 * the camera stuttering while the queue drains.
 */
let opened: Promise<Db> | null = null;

export function openDb(name = 'technician.db'): Promise<Db> {
  opened ??= (async () => {
    const native = await SQLite.openDatabaseAsync(name);
    await native.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    const db: Db = {
      exec: (sql) => native.execAsync(sql),
      run: async (sql, params = []) => {
        await native.runAsync(sql, params as SQLite.SQLiteBindValue[]);
      },
      all: <T>(sql: string, params: readonly SqlValue[] = []) =>
        native.getAllAsync<T>(sql, params as SQLite.SQLiteBindValue[]),
    };
    await migrate(db);
    return db;
  })();
  return opened;
}
