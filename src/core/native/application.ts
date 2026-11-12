import { requireOptionalNativeModule } from 'expo';

type ApplicationModule = typeof import('expo-application');

/**
 * expo-application, or null on a build without its native side (an older dev
 * client): importing it there throws at load time and takes the whole app down
 * before the error screen can render.
 */
let mod: ApplicationModule | null | undefined;
function load(): ApplicationModule | null {
  if (mod !== undefined) return mod;
  try {
    mod = requireOptionalNativeModule('ExpoApplication')
      ? // eslint-disable-next-line @typescript-eslint/no-require-imports -- must not load without the native module
        (require('expo-application') as ApplicationModule)
      : null;
  } catch {
    mod = null;
  }
  return mod;
}

export const Application = {
  get applicationName(): string | null {
    return load()?.applicationName ?? null;
  },
  get nativeApplicationVersion(): string | null {
    return load()?.nativeApplicationVersion ?? null;
  },
  get nativeBuildVersion(): string | null {
    return load()?.nativeBuildVersion ?? null;
  },
  getAndroidId(): string | null {
    const m = load();
    return m ? m.getAndroidId() : null;
  },
  async getIosIdForVendorAsync(): Promise<string | null> {
    const m = load();
    return m ? m.getIosIdForVendorAsync() : null;
  },
};
