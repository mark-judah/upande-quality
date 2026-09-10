import AsyncStorage from '@react-native-async-storage/async-storage';

export { secureStorage } from './secure';

export const StorageKeys = {
  cookie: 'cookie',
  instanceUrl: 'instanceurl',
  instanceUrlBackup: 'instanceurl_backup',
  emailBackup: 'email_backup',
  fullName: 'fullname',
  userStation: 'userStation',
  versionLastReportedOn: 'versionLastReportedOn',
  // Latest app version for which the user tapped "Later" on the update prompt —
  // so we don't nag every launch for the same release.
  updateDismissedVersion: 'updateDismissedVersion',
  userRoles: 'userRoles',
  biometricEnabled: 'biometric_enabled',
  // Password is saved on every successful password login so the biometric flow
  // AND the silent 403-reauth can re-authenticate by feeding it back to the
  // login endpoint. Stored in expo-secure-store (Keychain/Keystore), NOT
  // AsyncStorage — read/written via `secureStorage`, not `storage`. This same
  // key names the legacy plaintext AsyncStorage entry that `getPassword()`
  // migrates from on first read.
  passwordBackup: 'password_backup',
} as const;

export const storage = {
  get: (key: string): Promise<string | null> => AsyncStorage.getItem(key),
  set: (key: string, value: string): Promise<void> => AsyncStorage.setItem(key, value),
  remove: (key: string): Promise<void> => AsyncStorage.removeItem(key),
  async clearExcept(keep: string[]): Promise<void> {
    const allKeys = Object.values(StorageKeys);
    await Promise.all(
      allKeys
        .filter((k) => !keep.includes(k))
        .map((k) => AsyncStorage.removeItem(k)),
    );
  },
};
