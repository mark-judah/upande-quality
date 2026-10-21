import { create } from 'zustand';
import { authRepository } from './repository';
import { displayName, fetchCurrentUser, needsRealName } from './roles-api';
import { storage, StorageKeys } from '@/src/core/storage';
import * as Biometric from '@/src/core/biometric';
import { reportInstall } from '@/src/core/version/install-register';
import { setLoginServer } from './server-change';
import { instanceKey, knownInstances } from './known-instances';
import { consumeInstanceSwitched, restartForInstance } from './restart';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** How long a switching sign-in waits for the device register before restarting. */
const LOGIN_REPORT_WAIT_MS = 3000;
/** How long the start after a switch waits for roles before showing the app. */
const FINISH_LOGIN_WAIT_MS = 8000;

/** The one place the role rule lives: an explicit grant, or Administrator.
 *  Pure so callers that already hold `roles` can apply it without the store. */
export function rolesInclude(roles: string[], role: string): boolean {
  return roles.includes(role) || roles.includes('Administrator');
}

type AuthState = {
  status: 'idle' | 'loading' | 'success' | 'error';
  error: string | null;
  fullName: string | null;
  email: string | null;
  instanceUrl: string | null;
  hasSession: boolean;
  hydrated: boolean;
  roles: string[];

  /** Per-device biometric setting. */
  biometricEnabled: boolean;
  /** Runtime gate — true when the app should show the biometric lock screen. */
  biometricLocked: boolean;

  hydrate: () => Promise<void>;
  login: (email: string, password: string, url: string) => Promise<boolean>;
  /** Prompt the OS biometric, then re-authenticate using the stored password.
   *  Returns a structured outcome so the screen can show the right message. */
  biometricLogin: () => Promise<
    | { ok: true }
    | { ok: false; reason: 'cancelled' | 'no_credentials' | 'auth_failed' | 'unavailable'; message?: string }
  >;
  setBiometricEnabled: (on: boolean) => Promise<void>;
  unlock: () => void;
  /** Soft logout of the live instance only — its session cookie goes, the
   *  password + biometric flag stay so the user can sign back in with
   *  biometrics. */
  logout: () => Promise<void>;
  /** Sign out and move the login screen to another server. One server at a
   *  time: nothing of this one is kept for it but its queued scans. */
  changeServer: (url: string) => Promise<void>;
  /** Hard logout — wipe everything. Used on 401 / "Forget device". */
  forgetDevice: () => Promise<void>;
  hasRole: (role: string) => boolean;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'idle',
  error: null,
  fullName: null,
  email: null,
  instanceUrl: null,
  hasSession: false,
  hydrated: false,
  roles: [],
  biometricEnabled: false,
  biometricLocked: false,

  hydrate: async () => {
    const [hasSession, roles, email, fullName, instanceUrl, bioFlag, justSwitched] = await Promise.all([
      authRepository.hasSession(),
      authRepository.loadRoles(),
      storage.get(StorageKeys.emailBackup),
      storage.get(StorageKeys.fullName),
      storage.get(StorageKeys.instanceUrl),
      storage.get(StorageKeys.biometricEnabled),
      consumeInstanceSwitched(),
    ]);
    const biometricEnabled = bioFlag === '1';
    // The start right after a sign-in to this very server was signed in a moment ago.
    const switchedHere = hasSession && !!justSwitched && justSwitched === instanceKey(instanceUrl);
    const biometricLocked =
      hasSession && biometricEnabled && !switchedHere && Biometric.isModuleAvailable();

    // That sign-in restarted the app before its follow-ups (roles, real name):
    // they run now, on a fresh start with nothing of the old server open.
    let signedIn = { roles, email, fullName };
    if (switchedHere && email && instanceUrl) {
      const done = authRepository.completeLogin(email, fullName ?? email, instanceUrl);
      const quick = await Promise.race([done, delay(FINISH_LOGIN_WAIT_MS).then(() => null)]);
      if (quick) signedIn = quick;
      else
        done
          .then((r) => set({ roles: r.roles, email: r.email, fullName: displayName(r.fullName) }))
          .catch(() => {});
    }
    set({
      hasSession,
      hydrated: true,
      roles: signedIn.roles,
      email: signedIn.email,
      fullName: displayName(signedIn.fullName),
      instanceUrl,
      biometricEnabled,
      biometricLocked,
    });
    // Sessions from before the name fix stored the email as the name: look the
    // real one up once, in the background.
    if (hasSession && needsRealName(fullName)) {
      fetchCurrentUser()
        .then(async (me) => {
          if (!me.fullName) return;
          await storage.set(StorageKeys.fullName, me.fullName);
          set({ fullName: me.fullName });
        })
        .catch(() => {});
    }
  },

  login: async (email, password, url) => {
    set({ status: 'loading', error: null });
    const result = await authRepository.login(email, password, url);
    if (result.ok) {
      if (result.switched) {
        // Signed in to a different instance than the one live before: start the
        // app over before anything (Bucket Requests, telemetry) opens or syncs
        // the previous instance's files. The register hears of it first.
        await Promise.race([reportInstall({ reason: 'login', user: result.email }), delay(LOGIN_REPORT_WAIT_MS)]);
        if (await restartForInstance(instanceKey(result.instanceUrl))) return true;
        // No restart: the databases were closed and re-resolve for this server.
        Object.assign(result, await authRepository.completeLogin(result.email, result.fullName, result.instanceUrl));
      }
      set({
        status: 'success',
        fullName: displayName(result.fullName),
        email: result.email,
        instanceUrl: result.instanceUrl,
        hasSession: true,
        roles: result.roles,
        error: null,
        // A fresh password login never lands on the biometric lock screen.
        biometricLocked: false,
      });
      if (!result.switched) reportInstall({ reason: 'login', user: result.email });
      return true;
    }
    set({ status: 'error', error: result.error, hasSession: false });
    return false;
  },

  biometricLogin: async () => {
    if (!Biometric.isModuleAvailable()) {
      return { ok: false, reason: 'unavailable' };
    }
    const auth = await Biometric.authenticate({
      promptMessage: 'Sign in to Upande Quality',
      fallbackLabel: 'Use password',
      cancelLabel: 'Cancel',
    });
    if (!auth.success) {
      if (auth.error === 'user_cancel' || auth.error === 'system_cancel') {
        return { ok: false, reason: 'cancelled' };
      }
      return { ok: false, reason: 'auth_failed', message: auth.error };
    }
    const { email, password, url } = await authRepository.loadFullCredentials();
    if (!email || !password || !url) {
      return { ok: false, reason: 'no_credentials' };
    }
    const ok = await get().login(email, password, url);
    if (!ok) {
      return { ok: false, reason: 'auth_failed', message: get().error ?? undefined };
    }
    return { ok: true };
  },

  setBiometricEnabled: async (on) => {
    await storage.set(StorageKeys.biometricEnabled, on ? '1' : '0');
    set({ biometricEnabled: on });
  },

  unlock: () => set({ biometricLocked: false }),

  logout: async () => {
    // The server's session goes; the password stays for biometric sign-in.
    await storage.remove(StorageKeys.cookie);
    set({
      status: 'idle',
      error: null,
      hasSession: false,
      biometricLocked: false,
    });
  },

  changeServer: async (url) => {
    const known = (await knownInstances.list()).find((k) => instanceKey(k.url) === instanceKey(url));
    // A server not signed in to before starts with an empty account field.
    await setLoginServer(known?.url ?? url, known?.email ?? null);
    set({
      status: 'idle',
      error: null,
      fullName: null,
      instanceUrl: null,
      hasSession: false,
      roles: [],
      biometricLocked: false,
    });
    // Every store, open database and request belonged to the old server: start over, at login.
    await restartForInstance(instanceKey(known?.url ?? url));
  },

  forgetDevice: async () => {
    await authRepository.logout();
    await storage.remove(StorageKeys.biometricEnabled);
    set({
      status: 'idle',
      error: null,
      fullName: null,
      email: null,
      instanceUrl: null,
      hasSession: false,
      roles: [],
      biometricEnabled: false,
      biometricLocked: false,
    });
  },

  hasRole: (role) => rolesInclude(get().roles, role),
}));
