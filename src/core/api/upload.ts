import { File } from 'expo-file-system';
import { storage, StorageKeys } from '@/src/core/storage';
import { isSessionExpiredResponse, reauthOnce } from './client';

/** Returned by Frappe's /api/method/upload_file on success. */
export type UploadedFile = {
  /** Path Frappe serves the file under (e.g. /files/photo-xxxx.jpg). */
  file_url: string;
  /** File doctype document name. */
  name: string;
  file_name: string;
};

/**
 * Upload a single local image file to Frappe via /api/method/upload_file.
 *
 * Uses fetch + FormData directly (rather than the axios client) because the
 * client's request interceptor pins Content-Type to application/json, which
 * breaks multipart uploads. That also means we miss the client's expired-
 * session handling, so it is repeated here: reauth once and retry.
 */
export async function uploadImage(
  localUri: string,
  fileName?: string,
): Promise<UploadedFile> {
  let res = await postFile(localUri, fileName);
  if (!res.ok && isSessionExpiredResponse(res.status, await readBody(res))) {
    if (await reauthOnce()) res = await postFile(localUri, fileName);
  }

  const body = await readBody(res);
  if (!res.ok) {
    if (isSessionExpiredResponse(res.status, body)) {
      throw new Error('Session expired — log in again and retake the photo.');
    }
    if (res.status === 413) throw new Error('Photo is too large for the server.');
    throw new Error('Upload failed (' + res.status + '): ' + frappeMessage(body));
  }
  const b = body as { message?: UploadedFile; data?: UploadedFile } | null;
  const message = b?.message ?? b?.data ?? b;
  if (!(message as UploadedFile | null)?.file_url) {
    throw new Error('Upload response missing file_url.');
  }
  return message as UploadedFile;
}

/** One upload attempt. Builds a fresh FormData and re-reads the cookie each
 *  time so a retry after reauth picks up the new session. */
async function postFile(localUri: string, fileName?: string): Promise<Response> {
  const baseUrl = await storage.get(StorageKeys.instanceUrl);
  if (!baseUrl) throw new Error('Instance URL is not configured.');
  const cookie = await storage.get(StorageKeys.cookie);

  const file = new File(localUri);
  const form = new FormData();
  form.append('file', {
    // Global fetch is expo/fetch, which rejects RN's `{ uri, name, type }`
    // parts ("Unsupported FormDataPart implementation"). It takes any part
    // with `bytes()`, and reads `name`/`type` for the part headers.
    // The cast is needed because lib.dom.d.ts thinks FormData entries are Blob | string.
    name: fileName || file.name || 'photo.jpg',
    type: 'image/jpeg',
    bytes: () => file.bytes(),
  } as unknown as Blob);
  form.append('is_private', '0');
  form.append('folder', 'Home');

  const headers: Record<string, string> = {};
  if (cookie) headers['Cookie'] = cookie;
  // Do NOT set Content-Type — fetch fills in the multipart boundary itself.

  return fetch(baseUrl + '/api/method/upload_file', {
    method: 'POST',
    headers,
    body: form,
  });
}

/** Parsed JSON body, or the raw text when it isn't JSON (e.g. an nginx page).
 *  Cached on the response because a body can only be read once. */
const bodies = new WeakMap<Response, unknown>();
async function readBody(res: Response): Promise<unknown> {
  if (bodies.has(res)) return bodies.get(res);
  const text = await res.text().catch(() => '');
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {}
  bodies.set(res, body);
  return body;
}

/** The human-readable part of a Frappe error body, falling back to raw text. */
function frappeMessage(body: unknown): string {
  if (typeof body === 'string') return body.slice(0, 200);
  const b = body as { _server_messages?: string; exception?: string; message?: unknown } | null;
  try {
    const first = JSON.parse(JSON.parse(b?._server_messages ?? '')[0]);
    if (first?.message) return String(first.message).replace(/<[^>]+>/g, '');
  } catch {}
  if (b?.exception) return b.exception.split('\n')[0].slice(0, 200);
  return JSON.stringify(body).slice(0, 200);
}
