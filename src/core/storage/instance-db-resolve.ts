/**
 * The file-name rule behind instance-db, free of React Native so it can be
 * exercised on its own (scripts/test-instance-db.ts).
 *
 * `owners` (one JSON map, base name -> instance key) says which server owns
 * each plain, unsuffixed file:
 *
 * - no map yet (the first start after this shipped): every known base name is
 *   claimed, in one write, for the server the phone is on, which is the
 *   server whatever is queued in those files was scanned for;
 * - after that a plain file is never claimed again: every other server, and
 *   any base name missing from the map, gets its own suffixed file;
 * - a map that cannot be read counts as owned by an unknown server: suffixed
 *   files only, and the map is left as it is.
 *
 * Every resolve runs on one chain, so two resolving at once cannot both read
 * the map before either writes it.
 */

export type ResolverDeps = {
  /** The live server's key (`instanceKey`), '' when there is none. */
  currentKey: () => Promise<string>;
  readOwners: () => Promise<string | null>;
  writeOwners: (raw: string) => Promise<void>;
  /** Every base name the app opens, claimed together on the first start. */
  knownBases: readonly string[];
  log?: (message: string) => void;
};

export function suffixedName(base: string, key: string): string {
  const slug = key.replace(/[^A-Za-z0-9.-]/g, '_');
  return base.replace(/\.db$/, '') + `.${slug}.db`;
}

type Owners = Record<string, string>;
type ReadResult = { kind: 'missing' } | { kind: 'ok'; owners: Owners } | { kind: 'unreadable' };

function parseOwners(raw: string | null): ReadResult {
  if (raw == null) return { kind: 'missing' };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { kind: 'unreadable' };
    const owners: Owners = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') owners[k] = v;
    }
    return { kind: 'ok', owners };
  } catch {
    return { kind: 'unreadable' };
  }
}

export function createInstanceDbResolver(deps: ResolverDeps) {
  const resolved = new Map<string, Promise<string>>();
  let chain: Promise<unknown> = Promise.resolve();
  let logged = false;
  const logOnce = (message: string) => {
    if (logged) return;
    logged = true;
    deps.log?.(message);
  };

  async function resolveNow(base: string): Promise<{ name: string; keep: boolean }> {
    const key = await deps.currentKey().catch(() => '');
    let read: ReadResult;
    try {
      read = parseOwners(await deps.readOwners());
    } catch {
      read = { kind: 'unreadable' };
    }

    // No server known: nothing can sync from here. A fresh phone opens the
    // plain file; otherwise the plain file stays with whoever owns it. Not
    // kept, so the next open after a sign-in works it out again.
    if (!key) {
      return { name: read.kind === 'missing' ? base : suffixedName(base, 'noserver'), keep: false };
    }

    if (read.kind === 'missing') {
      const owners: Owners = {};
      for (const b of new Set([...deps.knownBases, base])) owners[b] = key;
      try {
        await deps.writeOwners(JSON.stringify(owners));
      } catch (e) {
        // Unrecorded, a later start on another server could claim the plain
        // file: use this server's own file until the claim is written.
        logOnce(`[instance-db] owners not saved: ${e instanceof Error ? e.message : String(e)}`);
        return { name: suffixedName(base, key), keep: false };
      }
      return { name: base, keep: true };
    }

    if (read.kind === 'unreadable') {
      logOnce('[instance-db] owners map unreadable; using per-server files');
      return { name: suffixedName(base, key), keep: true };
    }

    return { name: read.owners[base] === key ? base : suffixedName(base, key), keep: true };
  }

  function enqueue(base: string): Promise<{ name: string; keep: boolean }> {
    const run = chain.then(
      () => resolveNow(base),
      () => resolveNow(base),
    );
    chain = run.catch(() => null);
    return run;
  }

  return {
    /** The file name `base` opens for the live server; worked out once per base. */
    nameFor(base: string): Promise<string> {
      const hit = resolved.get(base);
      if (hit) return hit;
      const p: Promise<string> = enqueue(base).then(
        (r) => {
          if (!r.keep && resolved.get(base) === p) resolved.delete(base);
          return r.name;
        },
        (e) => {
          if (resolved.get(base) === p) resolved.delete(base);
          throw e;
        },
      );
      resolved.set(base, p);
      return p;
    },
    /** Forget every resolution (the live server changed without a restart). */
    reset(): void {
      resolved.clear();
    },
  };
}
