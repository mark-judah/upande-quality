import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/src/core/ui/Screen';
import { Card, Alert } from '@/src/core/ui/Card';
import { ScanField, type ScanFieldHandle } from '@/src/core/scanning/ScanField';
import { useToast } from '@/src/core/ui/Toast';
import { useKarenDiscardStore } from '@/src/tenants/karen/state/karen-discard-store';
import type { DiscardOutcome } from '@/src/tenants/karen/repository/karen-discard-repository';
import { COLORS } from '@/src/core/theme';

export function KarenDiscardsScreen() {
  const scanRef = useRef<ScanFieldHandle>(null);
  const { loading, lastOutcome, submitScan, reset } = useKarenDiscardStore();
  const { showSuccess, showError } = useToast();

  useEffect(() => () => reset(), [reset]);

  const handleScan = async (raw: string) => {
    const outcome = await submitScan(raw);
    if (outcome.kind === 'success') {
      showSuccess(outcome.message);
    } else {
      showError(outcome.message);
    }
    scanRef.current?.clear();
    scanRef.current?.focus();
  };

  return (
    <Screen title="Discards">
      <Card title="Scan bucket to discard">
        <ScanField
          ref={scanRef}
          onScan={handleScan}
          autoFocus
          placeholder="Scan bucket QR"
          editable={!loading}
        />
        {loading ? <Text style={s.muted}>Discarding…</Text> : null}
      </Card>

      {lastOutcome ? <OutcomeCard outcome={lastOutcome} /> : null}
    </Screen>
  );
}

function OutcomeCard({ outcome }: { outcome: DiscardOutcome }) {
  if (outcome.kind === 'success') {
    return (
      <Card title="Discarded">
        <Row label="Bucket" value={outcome.bucketId} />
        {outcome.variety ? <Row label="Variety" value={outcome.variety} /> : null}
        {outcome.stems != null ? (
          <Row label="Stems" value={String(outcome.stems)} />
        ) : null}
        {outcome.ageDays != null ? (
          <Row label="Age" value={`${outcome.ageDays} day${outcome.ageDays === 1 ? '' : 's'}`} />
        ) : null}
        {outcome.discardEntry ? (
          <Row label="Stock entry" value={outcome.discardEntry} />
        ) : null}
        {outcome.removedFromShelves.length > 0 ? (
          <Row label="Removed from" value={outcome.removedFromShelves.join(', ')} />
        ) : null}
      </Card>
    );
  }
  if (outcome.kind === 'failure') {
    const p = outcome.payload ?? {};
    const tone: 'warn' | 'danger' =
      outcome.reason === 'bucket_too_young' ? 'warn' : 'danger';
    return (
      <>
        <Alert tone={tone}>{outcome.message}</Alert>
        <Card title={`Bucket ${outcome.bucketId}`}>
          {p.variety ? <Row label="Variety" value={p.variety} /> : null}
          {p.stems != null ? <Row label="Stems" value={String(p.stems)} /> : null}
          {p.age_days != null ? (
            <Row label="Age" value={`${p.age_days} day${p.age_days === 1 ? '' : 's'}`} />
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
