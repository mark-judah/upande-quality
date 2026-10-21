import { DevSettings } from 'react-native';
import * as Updates from 'expo-updates';
import { storage, StorageKeys } from '@/src/core/storage';
import { resetInstanceDbs } from '@/src/core/storage/instance-db';

/**
 * Start the JavaScript over after the live instance changed. Every screen's
 * store, every in-memory cache, open database and in-flight request belonged
 * to the previous instance; a fresh start drops them all at once instead of
 * relying on each one being reset by hand. The next start, when signed in to
 * `targetKey` (the instance key switched to), skips the biometric lock once.
 *
 * Returns false when the app could not be restarted: every on-device database
 * is then closed and resolved again on its next open, and the flag is gone.
 */
export async function restartForInstance(targetKey: string): Promise<boolean> {
  await storage.set(StorageKeys.instanceSwitched, targetKey).catch(() => {});
  try {
    await Updates.reloadAsync();
    return true;
  } catch {
    // Development builds: expo-updates refuses, the dev menu's reload works.
  }
  if (__DEV__) {
    try {
      DevSettings.reload();
      return true;
    } catch {
      // fall through
    }
  }
  await storage.remove(StorageKeys.instanceSwitched).catch(() => {});
  await resetInstanceDbs();
  return false;
}

/** The instance key switched to, once, on the start that follows a switch. */
export async function consumeInstanceSwitched(): Promise<string | null> {
  const flag = await storage.get(StorageKeys.instanceSwitched).catch(() => null);
  if (flag) await storage.remove(StorageKeys.instanceSwitched).catch(() => {});
  return flag || null;
}
