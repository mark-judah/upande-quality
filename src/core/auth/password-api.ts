import axios from 'axios';
import { probeBaseUrl } from './api';

export type PasswordResult = { ok: true; message: string } | { ok: false; message: string };

/** Frappe's msgprint text from a response body, if any. */
function serverMessage(body: unknown): string | null {
  const raw = (body as { _server_messages?: string } | null)?._server_messages;
  if (typeof raw !== 'string') return null;
  try {
    const first = (JSON.parse(raw) as string[])[0];
    const msg = (JSON.parse(first) as { message?: string }).message;
    return msg ? msg.replace(/<[^>]+>/g, '').trim() : null;
  } catch {
    return null;
  }
}

/**
 * Forgot password: Frappe emails the user a link to set a new one. Works signed
 * out, against the instance on the login screen. The server answers the same
 * whether or not the email is registered.
 */
export async function requestPasswordReset(bareUrl: string, email: string): Promise<PasswordResult> {
  try {
    const base = await probeBaseUrl(bareUrl.trim().toLowerCase());
    const form = new URLSearchParams();
    form.append('user', email.trim());
    const res = await axios.post(
      `${base}/api/method/frappe.core.doctype.user.user.reset_password`,
      form.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000, validateStatus: () => true },
    );
    if (res.status === 429) {
      return { ok: false, message: 'Too many reset requests. Try again in an hour.' };
    }
    if (res.status >= 400) {
      return { ok: false, message: serverMessage(res.data) ?? "Couldn't send the reset email. Try again later." };
    }
    return {
      ok: true,
      message:
        serverMessage(res.data) ??
        'If this email is registered, a link to set a new password has been sent to it. Check your inbox.',
    };
  } catch {
    return { ok: false, message: "Couldn't reach the server. Check the instance and your connection." };
  }
}
