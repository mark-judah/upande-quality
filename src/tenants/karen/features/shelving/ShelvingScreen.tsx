import { useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Screen } from '@/src/core/ui/Screen';
import { Card, Alert } from '@/src/core/ui/Card';
import { ScanField, type ScanFieldHandle } from '@/src/core/scanning/ScanField';
import { focusWhenReady } from '@/src/core/scanning/focus';
import { useToast } from '@/src/core/ui/Toast';
import { useKarenShelvingStore } from '@/src/tenants/karen/state/karen-shelving-store';
import { COLORS } from '@/src/core/theme';

export function KarenShelvingScreen({ userFarm }: { userFarm: string }) {
  const shelfRef = useRef<ScanFieldHandle>(null);
  const bucketRef = useRef<ScanFieldHandle>(null);
  const { shelfId, loading, lastOutcome, setShelfFromScan, submitBucket, clearShelf, reset } =
    useKarenShelvingStore();
  const { showSuccess, showError } = useToast();

  useEffect(() => () => reset(), [reset]);

  // On every screen entry (mount OR re-entry from another tab), drive focus
  // to whichever field is currently expected. This is what makes the Honeywell
  // operator never have to tap.
  useFocusEffect(
    useCallback(() => {
      focusWhenReady(shelfId ? bucketRef : shelfRef);
    }, [shelfId]),
  );

  // Within the same mount, switch focus the moment shelfId flips: setting a
  // shelf jumps to bucket; clearing the shelf jumps back to shelf.
  useEffect(() => {
    focusWhenReady(shelfId ? bucketRef : shelfRef);
  }, [shelfId]);

  const onShelfScan = (raw: string) => {
    const result = setShelfFromScan(raw);
    if (!result.ok) {
      showError(result.message ?? 'Invalid shelf QR.');
      shelfRef.current?.clear();
      focusWhenReady(shelfRef);
    }
    // success: the useEffect above moves focus to bucket
  };

  const onBucketScan = async (raw: string) => {
    const outcome = await submitBucket(raw, userFarm);
    if (outcome.kind === 'success') {
      showSuccess(outcome.message);
    } else {
      showError(outcome.message);
    }
    // Shelf is sticky — only clear the bucket field and refocus it so the
    // operator can keep loading buckets onto the same shelf.
    bucketRef.current?.clear();
    focusWhenReady(bucketRef);
  };

  return (
    <Screen title="Shelving">
      <Card title="Shelf">
        <ScanField
          ref={shelfRef}
          onScan={onShelfScan}
          autoFocus={!shelfId}
          placeholder="Scan shelf QR"
          value={shelfId ?? undefined}
          editable={!loading && !shelfId}
        />
        {shelfId ? (
          <View style={s.shelfStatusRow}>
            <Text style={s.shelfStatusLabel}>Active shelf</Text>
            <Pressable onPress={clearShelf} hitSlop={8}>
              <Text style={s.changeLink}>Change shelf</Text>
            </Pressable>
          </View>
        ) : null}
      </Card>

      <Card title="Bucket">
        <ScanField
          ref={bucketRef}
          onScan={onBucketScan}
          autoFocus={!!shelfId}
          placeholder={shelfId ? 'Scan bucket QR' : 'Scan the shelf first'}
          editable={!loading && !!shelfId}
        />
        {loading ? <Text style={s.muted}>Shelving…</Text> : null}
      </Card>

      {lastOutcome ? <OutcomeCard outcome={lastOutcome} /> : null}
    </Screen>
  );
}

function OutcomeCard({
  outcome,
}: {
  outcome: NonNullable<ReturnType<typeof useKarenShelvingStore.getState>['lastOutcome']>;
}) {
  if (outcome.kind === 'success') {
    return (
      <Card title="Shelved">
        <Row label="Shelf" value={outcome.shelfId} />
        <Row label="Bucket" value={outcome.bucketId} />
        {outcome.stems != null ? (
          <Row label="Stems" value={String(outcome.stems)} />
        ) : null}
        {outcome.stemLength ? (
          <Row label="Stem length" value={outcome.stemLength} />
        ) : null}
      </Card>
    );
  }
  if (outcome.kind === 'failure') {
    return (
      <>
        <Alert tone="danger">{outcome.message}</Alert>
        <Card title={`Bucket ${outcome.bucketId}`}>
          {outcome.payload?.origin_farm ? (
            <Row label="Origin farm" value={outcome.payload.origin_farm} />
          ) : null}
          {outcome.payload?.received_on ? (
            <Row label="Received on" value={outcome.payload.received_on} />
          ) : null}
          {outcome.payload?.harvested_on ? (
            <Row label="Harvested on" value={outcome.payload.harvested_on} />
          ) : null}
          {outcome.payload?.gap_days != null ? (
            <Row label="Gap (days)" value={String(outcome.payload.gap_days)} />
          ) : null}
          {outcome.payload?.days_since_receiving != null ? (
            <Row
              label="Days since receiving"
              value={String(outcome.payload.days_since_receiving)}
            />
          ) : null}
          {outcome.payload?.max_allowed_days != null ? (
            <Row
              label="Max allowed (days)"
              value={String(outcome.payload.max_allowed_days)}
            />
          ) : null}
        </Card>
      </>
    );
  }
  return <Alert tone="danger">{outcome.message}</Alert>;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.detailRow}>
      <Text style={s.detailLabel}>{label}</Text>
      <Text style={s.detailValue}>{value || '—'}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  shelfStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  shelfStatusLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  changeLink: { fontSize: 13, color: COLORS.text, fontWeight: '600' },
  muted: { fontSize: 12, color: COLORS.textMuted, marginTop: 8 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  detailLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  detailValue: { fontSize: 14, color: COLORS.text, flexShrink: 1, textAlign: 'right' },
});
