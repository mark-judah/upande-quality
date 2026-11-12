import {
  consumeInstanceSwitched as kitConsumeInstanceSwitched,
  restartForInstance as kitRestartForInstance,
} from '@upande/mobile-kit';
import { resetInstanceDbs } from '@/src/core/storage/instance-db';

/**
 * Start the JavaScript over after the live instance changed (the kit does the
 * restart and remembers, for one start, that the sign-in was to `url`).
 *
 * Returns false when the app could not be restarted: every on-device database
 * is then closed and resolved again on its next open.
 */
export async function restartForInstance(url: string): Promise<boolean> {
  if (await kitRestartForInstance(url)) return true;
  await resetInstanceDbs();
  return false;
}

/** True once, on the start that follows a sign-in to `currentUrl`. */
export function consumeInstanceSwitched(currentUrl: string | null): Promise<boolean> {
  return kitConsumeInstanceSwitched(currentUrl);
}
