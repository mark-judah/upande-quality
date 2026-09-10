import { useEffect } from 'react';
import { Alert, Linking } from 'react-native';
import { storage, StorageKeys } from '@/src/core/storage';
import { checkLatestVersion, UPDATE_DOWNLOAD_URL } from '@/src/core/version';

/** Once per app session (when `active` becomes true), check GitHub for a newer
 *  release and, if one exists, show a one-tap "Update available" prompt. The
 *  prompt is suppressed for a version the user already dismissed with "Later",
 *  so it won't nag every launch — only when a NEWER release appears.
 *
 *  Fully best-effort: any failure (offline, no releases yet) is a no-op. */
export function useUpdatePrompt(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    (async () => {
      const check = await checkLatestVersion();
      if (cancelled || !check.updateAvailable || !check.latest) return;

      const dismissed = await storage.get(StorageKeys.updateDismissedVersion);
      if (dismissed === check.latest) return; // already told them about this one

      Alert.alert(
        'Update available',
        `A newer version (v${check.latest}) of Upande Quality is available. ` +
          `You're on v${check.current}. Update to get the latest fixes.`,
        [
          {
            text: 'Later',
            style: 'cancel',
            onPress: () => {
              storage.set(StorageKeys.updateDismissedVersion, check.latest as string).catch(() => {});
            },
          },
          {
            text: 'Update',
            onPress: () => {
              Linking.openURL(UPDATE_DOWNLOAD_URL).catch(() => {});
            },
          },
        ],
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [active]);
}
