import * as SecureStore from 'expo-secure-store';

/**
 * Keychain (iOS) / Keystore (Android) backed storage for secrets — currently
 * just the login password, which the biometric unlock and the silent 403
 * reauth feed back into the login endpoint.
 *
 * Every call is wrapped: on a device where the secure module is unavailable a
 * `get` yields null and a `set`/`remove` is a swallowed no-op, so callers
 * degrade to "no stored password" (biometric / silent reauth simply can't run)
 * rather than crash. Keys must match SecureStore's charset ([A-Za-z0-9._-]);
 * the StorageKeys values (e.g. `password_backup`) already do.
 */
export const secureStorage = {
  async get(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {
      /* secure store unavailable — password just won't persist */
    }
  },
  async remove(key: string): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      /* nothing to remove / unavailable */
    }
  },
};
