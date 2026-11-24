import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/src/core/ui/Button';
import { ScanField, type ScanFieldHandle } from '@/src/core/scanning/ScanField';
import { InlineCamera } from '@/src/core/scanning/InlineCamera';
import { InlinePhoto } from '@/src/core/scanning/InlinePhoto';
import { focusWhenReady } from '@/src/core/scanning/focus';
import { uploadImage } from '@/src/core/api/upload';
import { borderRadius, COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';
import {
  karenBucketRequestsRepository,
  type NotFoundReport as Report,
} from '@/src/tenants/karen/repository/karen-bucket-requests-repository';

/** The cameras open inside the sheet, this tall. */
const CAMERA_HEIGHT = 280;
/** A shelf check that has not answered by then is given up: scan again. */
const CHECK_TIMEOUT_MS = 15000;

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
 * A bucket being reported (missing, damaged, wrong variety, issued offline): scan the shelf the system put it on,
 * then photograph that shelf. Only then can it be replaced, marked not found or marked issued -- the shelf and photo
 * go on the record. A different shelf is refused. A Honeywell scanner types into the shelf field, which holds the
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
  /** The shelf the phone has for the bucket (the server's is the one checked). */
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
  const [camera, setCamera] = useState<'scan' | 'photo' | null>(null);
  const [photo, setPhoto] = useState<{ uri: string; url: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState('');

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
    setChecking(true);
    setShelfError('');
    try {
      const r = await withTimeout(
        karenBucketRequestsRepository.checkNotFoundShelf(pliId, code),
        CHECK_TIMEOUT_MS,
        'No reply from the server. Scan the shelf again.',
      );
      if (r.expected) setExpected(r.expected);
      if (r.ok) {
        setShelf(r.shelf);
        onReady(photo ? { shelf: r.shelf, photo: photo.url } : null);
      } else {
        setShelfError(r.message);
      }
    } catch (e) {
      setShelfError((e as Error)?.message || 'Could not check the shelf. Scan it again.');
    } finally {
      busy.current = false;
      setChecking(false);
      focusWhenReady(scanRef);
    }
  };

  const onPhoto = async (uri: string) => {
    setCamera(null);
    setUploading(true);
    setPhotoError('');
    try {
      const f = await uploadImage(uri, `shelf-${shelf || expected || 'x'}-${bucketId}.jpg`);
      setPhoto({ uri, url: f.file_url });
      onReady(shelf ? { shelf, photo: f.file_url } : null);
    } catch (e) {
      setPhoto(null);
      onReady(null);
      setPhotoError((e as Error)?.message || 'The photo did not upload. Take it again.');
    } finally {
      setUploading(false);
    }
  };

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

      <View style={[s.step, !shelf && s.stepOff]}>
        <StepMark done={!!photo} n={2} />
        <View style={{ flex: 1, gap: spacing.xs }}>
          <Text style={s.stepTitle}>Photo of the shelf</Text>
          {camera === 'photo' ? (
            <View style={s.camera}>
              <InlinePhoto onTaken={(uri) => void onPhoto(uri)} onClose={() => setCamera(null)} />
            </View>
          ) : photo ? (
            <Pressable onPress={() => setCamera('photo')} style={s.photoRow} accessibilityLabel="Retake the photo">
              <Image source={{ uri: photo.uri }} style={s.thumb} />
              <Text style={s.retake}>Retake</Text>
            </Pressable>
          ) : (
            <Button
              size="sm"
              variant="outline"
              singleLine
              iconLeft="camera-outline"
              label={uploading ? 'Uploading…' : 'Take photo'}
              loading={uploading}
              disabled={!shelf || uploading}
              onPress={() => setCamera('photo')}
            />
          )}
          {photoError ? <Text style={s.error}>{photoError}</Text> : null}
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
  stepOff: { opacity: 0.45 },
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
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  thumb: { width: 64, height: 64, borderRadius: borderRadius.sm, backgroundColor: COLORS.border },
  retake: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.primary },
});
