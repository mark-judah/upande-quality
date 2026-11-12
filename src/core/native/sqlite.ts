import { requireOptionalNativeModule } from 'expo';
import type { SQLiteDatabase } from 'expo-sqlite';

type SQLiteModule = typeof import('expo-sqlite');

/**
 * expo-sqlite, loaded on first use and only when its native side exists:
 * importing it on a build without it (an older dev client) throws at load time
 * and takes the whole app down. Without it only the offline screens fail.
 */
let mod: SQLiteModule | null | undefined;
function load(): SQLiteModule | null {
  if (mod !== undefined) return mod;
  try {
    mod = requireOptionalNativeModule('ExpoSQLite')
      ? // eslint-disable-next-line @typescript-eslint/no-require-imports -- must not load without the native module
        (require('expo-sqlite') as SQLiteModule)
      : null;
  } catch {
    mod = null;
  }
  return mod;
}

export async function openDatabaseAsync(name: string): Promise<SQLiteDatabase> {
  const m = load();
  if (!m) throw new Error('Offline storage is not available in this build of the app.');
  return m.openDatabaseAsync(name);
}
