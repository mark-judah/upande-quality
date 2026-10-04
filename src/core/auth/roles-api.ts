import { api } from '@/src/core/api/client';

export type RawUserRolesResponse = {
  data?: {
    user?: string;
    full_name?: string;
    roles?: string[];
    error?: string;
  };
  message?: {
    user?: string;
    full_name?: string;
    roles?: string[];
    error?: string;
  };
};

/** The signed-in user's roles and full name. The name comes from this call
 *  because most users cannot read their own User record (only System Managers
 *  can), so reading it directly leaves the app showing their email. */
export async function fetchCurrentUser(): Promise<{ user: string | null; roles: string[]; fullName: string | null }> {
  const res = await api<RawUserRolesResponse>({
    method: 'POST',
    url: '/api/method/upande_packhouse.mobile.api.getCurrentUserRoles',
  });
  const payload = res.data ?? res.message ?? {};
  const name = (payload.full_name || '').trim();
  return {
    // The account's id (its email), whatever was typed to sign in.
    user: payload.user || null,
    roles: Array.isArray(payload.roles) ? payload.roles : [],
    // Frappe falls back to the email when a user has no name: that is no name.
    fullName: name && !name.includes('@') ? capitalizeName(name) : null,
  };
}

export async function fetchCurrentUserRoles(): Promise<string[]> {
  return (await fetchCurrentUser()).roles;
}

/** A person's name as the app shows it: each word capitalised ("james tinega",
 *  "JAMES TINEGA" -> "James Tinega"); a word already in mixed case ("McDonald")
 *  is left alone. */
export function capitalizeName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => {
      const plain = w === w.toLowerCase() || w === w.toUpperCase() ? w.toLowerCase() : w;
      return plain.replace(/(^|[-'])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
    })
    .join(' ');
}

/** `capitalizeName` for anything that is a name; an email or blank passes as is.
 *  A comma-separated list of names is capitalised name by name. */
export function displayName<T extends string | null | undefined>(value: T): T {
  if (!value || value.includes('@')) return value;
  return value
    .split(',')
    .map((n) => capitalizeName(n))
    .join(', ') as T;
}

/** A stored "full name" that is really an email (or blank) needs replacing. */
export function needsRealName(fullName: string | null | undefined): boolean {
  return !fullName || fullName.includes('@');
}
