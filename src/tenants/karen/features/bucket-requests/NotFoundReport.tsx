import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ScanField, type ScanFieldHandle } from '@/src/core/scanning/ScanField';
import { InlineCamera } from '@/src/core/scanning/InlineCamera';
import { focusWhenReady } from '@/src/core/scanning/focus';
import { borderRadius, COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';
import {
  karenBucketRequestsRepository,
  type NotFoundReport as Report,
} from '@/src/tenants/karen/repository/karen-bucket-requests-repository';

/** The cameras open inside the sheet, this tall. */
const CAMERA_HEIGHT = 280;
/** A shelf check that has not answered by then is given up: scan again. */
const CHECK_TIMEOUT_MS = 15000;

/** A shelf QR (`{"shelf": "KPK-G3M"}`) or the shelf typed in, upper case -- as the server reads it. */
export function parseShelf(scan: string): string {
  let text = (scan || '').trim();
  if (text.startsWith('{')) {
    try {
      text = String((JSON.parse(text) as { shelf?: string })?.shelf ?? '');
    } catch {
      text = '';
    }
  }
  return text.trim().toUpperCase();
}

/** The shelf scanned against the shelf this bucket shows on the phone: null when it matches, else why not. */
export function shelfMismatch(bucketId: string, expected: string, scan: string): string | null {
  const scanned = parseShelf(scan);
  const want = (expected || '').trim().toUpperCase();
  if (!scanned) return want ? `That is not a shelf QR: scan shelf ${want}.` : 'That is not a shelf QR: scan the shelf.';
  if (want && scanned !== want) {
    return `${bucketId.toUpperCase()} was put on ${want}, not ${scanned}: look on ${want} and scan it.`;
  }
  return null;
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * A bucket being reported (missing, damaged, wrong variety, issued offline): scan the shelf the system put it on.
 * Only then can it be replaced, marked not found or marked issued -- the shelf scanned is the evidence and goes on
 * the record. A different shelf is refused. A Honeywell scanner types into the shelf field, which holds the
 * focus (on opening, after every check, when a camera closes); the phone camera opens inside the sheet.
 */
export function NotFoundReportSteps({
  pliId,
  bucketId,
  shelfHint,
  onReady,
}: {
  pliId: string;
  bucketId: string;
  /** The shelf the phone shows for the bucket: the scan is checked against it here, without a connection. */
  shelfHint?: string;
  /** The finished report, or null while a step is missing. */
  onReady: (report: Report | null) => void;
}) {
  const scanRef = useRef<ScanFieldHandle>(null);
  const busy = useRef(false);
  const [shelf, setShelf] = useState('');
  const [expected, setExpected] = useState((shelfHint || '').toUpperCase());
  const [shelfError, setShelfError] = useState('');
  const [checking, setChecking] = useState(false);
  const [camera, setCamera] = useState<'scan' | null>(null);

  // the shelf field takes the Honeywell scan: focused whenever a shelf is still to be scanned
  useEffect(() => {
    if (!shelf && camera !== 'scan') focusWhenReady(scanRef);
  }, [shelf, camera]);

  const onShelfScan = async (raw: string) => {
    setCamera(null);
    scanRef.current?.clear();
    const code = raw.trim();
    if (!code || busy.current) return;
    busy.current = true;
    setShelfError('');
    // the shelf this bucket shows: checked on the phone, so it works without a connection
    if (expected) {
      const wrong = shelfMismatch(bucketId, expected, code);
      busy.current = false;
      if (wrong) {
        setShelfError(wrong);
        focusWhenReady(scanRef);
        return;
      }
      const ok = parseShelf(code);
      setShelf(ok);
      onReady(report(ok));
      return;
    }
    setChecking(true);
    try {
      const r = await withTimeout(
        karenBucketRequestsRepository.checkNotFoundShelf(pliId, code),
        CHECK_TIMEOUT_MS,
        'No reply from the server. Scan the shelf again.',
      );
      if (r.expected) setExpected(r.expected);
      if (r.ok) {
        setShelf(r.shelf);
        onReady(report(r.shelf));
      } else {
        setShelfError(r.message);
      }
    } catch {
      // no shelf on the phone and no connection: the server checks the shelf when the report is sent
      const scanned = parseShelf(code);
      if (scanned) {
        setShelf(scanned);
        onReady(report(scanned));
      } else {
        setShelfError('That is not a shelf QR: scan the shelf.');
      }
    } finally {
      busy.current = false;
      setChecking(false);
      focusWhenReady(scanRef);
    }
  };

  const report = (shelfName: string): Report => ({ shelf: shelfName, photo: '' });

  return (
    <View style={s.box}>
      <View style={s.step}>
        <StepMark done={!!shelf} n={1} />
        <View style={{ flex: 1, gap: spacing.xs }}>
          <Text style={s.stepTitle}>{shelf ? `Shelf ${shelf}` : `Scan shelf ${expected}`.trim()}</Text>
          {!shelf ? (
            <>
              {camera === 'scan' ? (
                <View style={s.camera}>
                  <InlineCamera onScan={(code) => void onShelfScan(code)} onClose={() => setCamera(null)} />
                </View>
              ) : null}
              <ScanField
                ref={scanRef}
                autoFocus
                placeholder={checking ? 'Checking…' : 'Scan the shelf QR'}
                onScan={(code) => void onShelfScan(code)}
                onCameraPress={() => setCamera((c) => (c === 'scan' ? null : 'scan'))}
                cameraOpen={camera === 'scan'}
              />
              {shelfError ? <Text style={s.error}>{shelfError}</Text> : null}
            </>
          ) : null}
        </View>
      </View>

    </View>
  );
}

function StepMark({ done, n }: { done: boolean; n: number }) {
  return done ? (
    <Ionicons name="checkmark-circle" size={22} color={COLORS.success} />
  ) : (
    <View style={s.num}>
      <Text style={s.numText}>{n}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    marginTop: spacing.sm,
  },
  step: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  stepTitle: { fontFamily: fontFamily.bold, fontSize: fontSize.sm, color: COLORS.text, marginTop: 2 },
  camera: { height: CAMERA_HEIGHT },
  num: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: COLORS.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numText: { fontFamily: fontFamily.bold, fontSize: 12, color: COLORS.text },
  error: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: COLORS.danger },
});
