import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { api, mapAxiosError } from '@/src/core/api/client';
import { storage, StorageKeys } from '@/src/core/storage';

export const APP_VERSION: string = Constants.expoConfig?.version ?? '1.0.0';

// The mobile app is versioned via semantic-release (see .releaserc.json): every
// merge to main publishes a GitHub Release tagged v<version>. The "latest
// version" the app compares against is therefore the newest GitHub Release.
export const GITHUB_OWNER = 'mark-judah';
export const GITHUB_REPO = 'upande-quality';
export const RELEASES_PAGE_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
// TODO: if you distribute via Play Store / a direct APK, point this at that URL
// instead — it's what the "Update" button opens.
export const UPDATE_DOWNLOAD_URL = RELEASES_PAGE_URL;

const LATEST_RELEASE_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

const ENDPOINT = '/api/method/upande_packhouse.mobile.api.reportAppVersion';

export type VersionCheck = {
  current: string;
  latest: string | null; // null = couldn't determine (no releases yet / offline)
  updateAvailable: boolean;
};

function parseSemver(v: string): [number, number, number] {
  const parts = String(v).replace(/^v/i, '').split('-')[0].split('.');
  return [parseInt(parts[0], 10) || 0, parseInt(parts[1], 10) || 0, parseInt(parts[2], 10) || 0];
}

/** True when `latest` is strictly newer than `current` (major.minor.patch). */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseSemver(latest);
  const b = parseSemver(current);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

/** Fetch the newest published GitHub Release and compare to the installed
 *  version. Uses plain fetch (NOT the Frappe api client) so no auth headers
 *  leak to GitHub. Never throws — returns updateAvailable=false on any failure
 *  (offline, rate-limited, or no releases published yet -> 404). */
export async function checkLatestVersion(): Promise<VersionCheck> {
  try {
    const res = await fetch(LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return { current: APP_VERSION, latest: null, updateAvailable: false };
    const json = (await res.json()) as { tag_name?: string };
    const tag = json?.tag_name ? String(json.tag_name).replace(/^v/i, '') : '';
    const latest = tag || null;
    return {
      current: APP_VERSION,
      latest,
      updateAvailable: !!latest && isNewerVersion(latest, APP_VERSION),
    };
  } catch {
    return { current: APP_VERSION, latest: null, updateAvailable: false };
  }
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function reportVersionIfDue(): Promise<void> {
  try {
    const today = todayISO();
    const last = await storage.get(StorageKeys.versionLastReportedOn);
    if (last === today) return;

    await api({
      method: 'POST',
      url: ENDPOINT,
      data: {
        app_version: APP_VERSION,
        platform: Platform.OS,
        device_model: Platform.OS === 'ios' ? 'iOS device' : 'Android device',
      },
    });

    await storage.set(StorageKeys.versionLastReportedOn, today);
  } catch (err) {
    // version reporting must never block the app; swallow but keep the error visible in logs
    console.warn('[version-report] failed', mapAxiosError(err).message);
  }
}
