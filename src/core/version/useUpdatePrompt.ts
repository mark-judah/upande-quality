import { useEffect } from 'react';
import { Linking } from 'react-native';
import { storage, StorageKeys } from '@/src/core/storage';
import { checkLatestVersion, UPDATE_DOWNLOAD_URL } from '@/src/core/version';
import { useApkUpdate } from '@/src/core/updates/UpdateProvider';
import { canInstallInApp } from '@/src/core/updates/install-apk';
import { showDialog } from '@/src/core/ui/DialogHost';

/** Once per app session (when `active` becomes true), check GitHub for a newer
 *  release and, if one exists, show a one-tap "Update available" prompt. The
 *  prompt is suppressed for a version the user already dismissed with "Later",
 *  so it won't nag every launch — only when a NEWER release appears.
 *
 *  "Update" downloads the APK in-app, then offers "Install" to open Android's
 *  installer, when the release has one attached; otherwise it opens the
 *  releases page as before.
 *  Must be used inside <UpdateProvider>.
 *
 *  Fully best-effort: any failure (offline, no releases yet) is a no-op. */
export function useUpdatePrompt(active: boolean): void {
  const { refresh, install } = useApkUpdate();

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    (async () => {
      const check = await checkLatestVersion();
      if (cancelled || !check.updateAvailable || !check.latest) return;

      const dismissed = await storage.get(StorageKeys.updateDismissedVersion);
      if (dismissed === check.latest) return; // already told them about this one

      showDialog(
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
            onPress: async () => {
              const apk = await refresh();
              if (apk?.available && (await install(apk))) {
                // The browser fallback handles the rest itself.
                if (!canInstallInApp()) return;
                // Downloaded; the installer opens on the next tap.
                showDialog(
                  'Update downloaded',
                  `v${apk.apk?.version ?? check.latest} is ready to install.`,
                  [
                    { text: 'Later', style: 'cancel' },
                    { text: 'Install', onPress: () => void install(apk) },
                  ],
                  { name: 'checkmark-circle-outline', tone: 'success' },
                );
                return;
              }
              Linking.openURL(UPDATE_DOWNLOAD_URL).catch(() => {});
            },
          },
        ],
        { name: 'cloud-download-outline', tone: 'info' },
      );
    })();

    return () => {
      cancelled = true;
    };
    // refresh/install are stable callbacks; re-running on `install` identity
    // changes would re-prompt every time a check lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
