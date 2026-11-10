import { useEffect, useRef } from 'react';
import { storage, StorageKeys } from '@/src/core/storage';
import { checkLatestVersion } from '@/src/core/version';
import { useApkUpdate } from '@/src/core/updates/UpdateProvider';
import { canInstallInApp } from '@/src/core/updates/install-apk';
import { showDialog } from '@/src/core/ui/DialogHost';

/** Once the user is past the gate, offer a newer APK -- only once it is fully
 *  downloaded and verified in the background (UpdateProvider), so "Install"
 *  always opens the installer on a complete file. "Later" silences that
 *  version; a newer release is offered again.
 *
 *  An APK too old to open the installer itself keeps the browser prompt.
 *  Must be used inside <UpdateProvider>. Fully best-effort. */
export function useUpdatePrompt(active: boolean): void {
  const { check, downloaded, install, refresh } = useApkUpdate();
  const offered = useRef<string | null>(null);

  useEffect(() => {
    if (!active || !canInstallInApp()) return;
    const apk = check?.available ? check.apk : null;
    if (!apk || downloaded !== apk.version || offered.current === apk.version) return;
    let cancelled = false;

    (async () => {
      const dismissed = await storage.get(StorageKeys.updateDismissedVersion);
      if (cancelled || dismissed === apk.version || offered.current === apk.version) return;
      offered.current = apk.version;
      showDialog(
        'Update ready',
        `Version ${apk.version} of Upande Quality is downloaded. You're on v${check?.current}.`,
        [
          {
            text: 'Later',
            style: 'cancel',
            onPress: () => {
              storage.set(StorageKeys.updateDismissedVersion, apk.version).catch(() => {});
            },
          },
          { text: 'Install', onPress: () => void install(check) },
        ],
        { name: 'cloud-download-outline', tone: 'success' },
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [active, check, downloaded, install]);

  useEffect(() => {
    if (!active || canInstallInApp()) return;
    let cancelled = false;

    (async () => {
      const latest = await checkLatestVersion();
      if (cancelled || !latest.updateAvailable || !latest.latest) return;
      const dismissed = await storage.get(StorageKeys.updateDismissedVersion);
      if (cancelled || dismissed === latest.latest) return;

      showDialog(
        'Update available',
        `A newer version (v${latest.latest}) of Upande Quality is available. ` +
          `You're on v${latest.current}. Update to get the latest fixes.`,
        [
          {
            text: 'Later',
            style: 'cancel',
            onPress: () => {
              storage.set(StorageKeys.updateDismissedVersion, latest.latest as string).catch(() => {});
            },
          },
          {
            text: 'Update',
            onPress: async () => {
              const found = await refresh();
              if (found?.apk) await install(found);
            },
          },
        ],
        { name: 'cloud-download-outline', tone: 'info' },
      );
    })();

    return () => {
      cancelled = true;
    };
    // refresh/install are only read when tapped; re-running on them would re-prompt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
