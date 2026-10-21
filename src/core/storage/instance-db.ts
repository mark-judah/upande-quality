import { storage, StorageKeys } from './index';
import { instanceKey } from '@/src/core/auth/known-instances';
import { createInstanceDbResolver } from './instance-db-resolve';

/**
 * The file name of an on-device database for the live instance, so scans
 * queued on one server are only ever read, and synced, while signed in to that
 * server. Switching instance restarts the app (src/core/auth/restart), so the
 * name is worked out once per start; when the restart fails,
 * `resetInstanceDbs` closes every open file and forgets the names.
 *
 * The plain base names stay with the instance the phone was on the first
 * time this ran (see instance-db-resolve), so nothing queued before the
 * update is lost; every other instance gets its own files.
 */

/** Every on-device database that holds one server's data. */
export const INSTANCE_DB_BASES = [
  'telemetry.db',
  'karen_bucket_requests.db',
  'karen_bucket_count.db',
  'karen_stock_take.db',
] as const;

const resolver = createInstanceDbResolver({
  currentKey: async () => {
    const [url, backup] = await Promise.all([
      storage.get(StorageKeys.instanceUrl).catch(() => null),
      storage.get(StorageKeys.instanceUrlBackup).catch(() => null),
    ]);
    return instanceKey(url || backup);
  },
  readOwners: () => storage.get(StorageKeys.instanceDbOwners),
  writeOwners: (raw) => storage.set(StorageKeys.instanceDbOwners, raw),
  knownBases: INSTANCE_DB_BASES,
  log: (m) => console.warn(m),
});

export function instanceDbName(base: string): Promise<string> {
  return resolver.nameFor(base);
}

type Closer = () => Promise<void> | void;
const closers = new Set<Closer>();

/** A database module registers how to close and drop its cached connection. */
export function onInstanceDbReset(close: Closer): void {
  closers.add(close);
}

/** The live server changed in place: close every open file and resolve again on next open. */
export async function resetInstanceDbs(): Promise<void> {
  resolver.reset();
  await Promise.all([...closers].map((c) => Promise.resolve().then(c).catch(() => {})));
}
