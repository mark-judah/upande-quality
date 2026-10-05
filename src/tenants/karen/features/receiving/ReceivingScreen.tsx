import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Screen } from '@/src/core/ui/Screen';
import { Card, Alert } from '@/src/core/ui/Card';
import { Button } from '@/src/core/ui/Button';
import { Dialog, DialogList, DialogRow } from '@/src/core/ui/Dialog';
import { ScanField, type ScanFieldHandle } from '@/src/core/scanning/ScanField';
import { focusWhenReady } from '@/src/core/scanning/focus';
import { useToast } from '@/src/core/ui/Toast';
import { useKarenReceivingStore } from '@/src/tenants/karen/state/karen-receiving-store';
import type {
  BucketDetails,
  ReceivingOutcome,
} from '@/src/tenants/karen/repository/karen-receiving-repository';
import { COLORS, fontFamily, scaleFont } from '@/src/core/theme';

export function KarenReceivingScreen() {
  const scanRef = useRef<ScanFieldHandle>(null);
  const { loading, lastOutcome, batchMode, batchId, toggleBatchMode, submitScan, confirmReceive, reset } =
    useKarenReceivingStore();
  const { showSuccess, showError } = useToast();
  /** The successful receive that drives the popup. Cleared when dismissed. */
  const [receivedPopup, setReceivedPopup] = useState<
    Extract<ReceivingOutcome, { kind: 'received' }> | null
  >(null);
  /** A bucket whose latest harvest isn't from today, or that's already been
   *  received — surfaced as a popup (not a toast) since "already received or
   *  not, receive anyway?" is something the operator needs to actively read
   *  and respond to, not glance past. */
  const [stalePopup, setStalePopup] = useState<
    Extract<ReceivingOutcome, { kind: 'already_received' } | { kind: 'no_harvest_on_date' }> | null
  >(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => () => reset(), [reset]);

  // Park the cursor on the scan field on every screen entry. Cheap insurance
  // against transitions / re-entry from another tab dropping autoFocus.
  useFocusEffect(
    useCallback(() => {
      focusWhenReady(scanRef);
    }, []),
  );

  const handleToggleBatch = () => {
    toggleBatchMode();
    // Enabling or disabling batch mode must NOT make the operator tap back
    // into the input — yank the cursor right back.
    focusWhenReady(scanRef);
  };

  const handleScan = async (raw: string) => {
    const outcome = await submitScan(raw);
    switch (outcome.kind) {
      case 'received':
        showSuccess(`Received bucket ${outcome.bucketId}`);
        setReceivedPopup(outcome);
        // Don't refocus yet — the popup is modal; the dismiss handler will.
        return;
      case 'already_received':
      case 'no_harvest_on_date':
        setStalePopup(outcome);
        return;
      case 'not_harvested':
      case 'not_exist':
      case 'error':
        showError(outcome.message);
        break;
    }
    focusWhenReady(scanRef);
  };

  const dismissPopup = useCallback(() => {
    setReceivedPopup(null);
    focusWhenReady(scanRef);
  }, []);

  const dismissStalePopup = useCallback(() => {
    setStalePopup(null);
    focusWhenReady(scanRef);
  }, []);

  const handleConfirmReceive = async () => {
    if (!stalePopup) return;
    setConfirming(true);
    const outcome = await confirmReceive(stalePopup.bucketId);
    setConfirming(false);
    if (outcome.kind === 'received') {
      setStalePopup(null);
      showSuccess(`Received bucket ${outcome.bucketId}`);
      setReceivedPopup(outcome);
      return;
    }
    // Something changed between the popup showing and confirming (e.g. it
    // got received from another device in between) — surface whatever the
    // server says now instead of silently closing.
    if (outcome.kind === 'already_received' || outcome.kind === 'no_harvest_on_date') {
      setStalePopup(outcome);
    } else {
      setStalePopup(null);
      showError(outcome.message);
      focusWhenReady(scanRef);
    }
  };

  return (
    <Screen title="Receiving">
      <Card title="Batch mode">
        <View style={s.row}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.bodyText}>
              {batchMode ? `Active · ${batchId}` : 'Each scan submits independently'}
            </Text>
            <Text style={s.muted}>
              Toggle on to group consecutive scans under one batch ID.
            </Text>
          </View>
          <Switch
            value={batchMode}
            onValueChange={handleToggleBatch}
            trackColor={{ false: COLORS.border, true: COLORS.text }}
            thumbColor={COLORS.bg}
          />
        </View>
      </Card>

      <Card title="Scan">
        <ScanField
          ref={scanRef}
          onScan={handleScan}
          autoFocus
          placeholder="Scan bucket QR"
          editable={!loading}
        />
      </Card>

      {loading ? (
        <Card>
          <Text style={s.muted}>Submitting…</Text>
        </Card>
      ) : lastOutcome &&
        lastOutcome.kind !== 'received' &&
        lastOutcome.kind !== 'already_received' &&
        lastOutcome.kind !== 'no_harvest_on_date' ? (
        // 'received' goes through its own popup; 'already_received' and
        // 'no_harvest_on_date' go through the stale-bucket popup below — only
        // render the inline card for the remaining failures.
        <OutcomeCard outcome={lastOutcome} />
      ) : null}

      {batchMode ? (
        <Pressable
          onPress={() => {
            useKarenReceivingStore.getState().endBatch();
            focusWhenReady(scanRef);
          }}
          style={s.endBatch}
        >
          <Text style={s.endBatchLabel}>End batch</Text>
        </Pressable>
      ) : null}

      <ReceivedPopup outcome={receivedPopup} onDismiss={dismissPopup} />
      <StaleHarvestPopup
        outcome={stalePopup}
        onDismiss={dismissStalePopup}
        onConfirm={handleConfirmReceive}
        confirming={confirming}
      />
    </Screen>
  );
}

function ReceivedPopup({
  outcome,
  onDismiss,
}: {
  outcome: Extract<ReceivingOutcome, { kind: 'received' }> | null;
  onDismiss: () => void;
}) {
  // Auto-hide after 1.7s so the operator can keep scanning without tapping
  // "Next bucket". Manual dismiss (tap/button) still works and clears the timer.
  useEffect(() => {
    if (!outcome) return;
    const t = setTimeout(onDismiss, 1700);
    return () => clearTimeout(t);
  }, [outcome, onDismiss]);

  return (
    <Dialog
      visible={!!outcome}
      onClose={onDismiss}
      icon={{ name: 'checkmark-circle', tone: 'success' }}
      title="Bucket received"
      subtitle={outcome?.bucketId}
      actions={<Button label="Next bucket" onPress={onDismiss} style={{ flex: 1 }} />}
    >
      {outcome ? (
        <DialogList>
          <DialogRow label="Variety" value={outcome.details.variety} />
          <DialogRow label="Stems" value={outcome.details.numberOfStems} />
          <DialogRow label="Bunches" value={outcome.details.bunches} />
          <DialogRow label="Greenhouse" value={outcome.details.greenhouse} />
          <DialogRow label="Harvested" value={outcome.details.harvestDate} />
        </DialogList>
      ) : null}
    </Dialog>
  );
}

/** Shown instead of a toast when the bucket's latest harvest isn't from
 *  today — an operator scanning it may have the wrong bucket, or expect
 *  today's harvest to be inside it, so this needs an active read, not a
 *  glance-past toast. Covers two backend statuses with the same layout:
 *  'already_received' (informational — nothing to confirm, just an OK) and
 *  'no_harvest_on_date' (still unclaimed — offers to receive it anyway
 *  against the stale harvest). */
function StaleHarvestPopup({
  outcome,
  onDismiss,
  onConfirm,
  confirming,
}: {
  outcome: Extract<ReceivingOutcome, { kind: 'already_received' } | { kind: 'no_harvest_on_date' }> | null;
  onDismiss: () => void;
  onConfirm: () => void;
  confirming: boolean;
}) {
  const canConfirm = outcome?.kind === 'no_harvest_on_date';

  return (
    <Dialog
      visible={!!outcome}
      onClose={onDismiss}
      busy={confirming}
      icon={{ name: 'alert-circle', tone: 'warn' }}
      title={canConfirm ? 'Not harvested today' : 'Already received'}
      subtitle={outcome ? `${outcome.bucketId}\n${outcome.message}` : undefined}
      actions={
        canConfirm ? (
          <>
            <Button label="Cancel" variant="outline" onPress={onDismiss} disabled={confirming} style={{ flex: 1 }} />
            <Button label="Receive anyway" onPress={onConfirm} loading={confirming} style={{ flex: 1 }} />
          </>
        ) : (
          <Button label="OK" onPress={onDismiss} style={{ flex: 1 }} />
        )
      }
    >
      {outcome ? (
        <DialogList>
          <DialogRow label="Variety" value={outcome.details.variety} />
          <DialogRow label="Greenhouse" value={outcome.details.greenhouse} />
          <DialogRow label="Farm" value={outcome.details.farm} />
          <DialogRow label="Harvested" value={outcome.details.harvestDate} />
          <DialogRow label="Stems" value={outcome.details.numberOfStems} />
        </DialogList>
      ) : null}
    </Dialog>
  );
}


function OutcomeCard({ outcome }: { outcome: ReceivingOutcome }) {
  switch (outcome.kind) {
    case 'received':
      return (
        <Card title="Received">
          <Text style={s.bodyText}>Bucket {outcome.bucketId}</Text>
          {outcome.stockEntryName ? (
            <Text style={s.muted}>Stock entry: {outcome.stockEntryName}</Text>
          ) : null}
          <View style={s.divider} />
          <Details details={outcome.details} />
        </Card>
      );

    case 'already_received':
      return (
        <Card title="Already received">
          <Text style={s.bodyText}>Bucket {outcome.bucketId}</Text>
          <Text style={s.muted}>{outcome.message}</Text>
          <View style={s.divider} />
          <Details details={outcome.details} />
        </Card>
      );

    case 'no_harvest_on_date':
      return (
        <>
          <Alert tone="danger">{outcome.message}</Alert>
          <Card title={`Bucket ${outcome.bucketId}`}>
            <Details details={outcome.details} />
          </Card>
        </>
      );

    case 'not_harvested':
    case 'not_exist':
      return <Alert tone="danger">{outcome.message}</Alert>;

    case 'error':
    default:
      return <Alert tone="danger">{outcome.message}</Alert>;
  }
}

function Details({ details }: { details: BucketDetails }) {
  return (
    <View>
      {details.variety ? <Row label="Variety" value={details.variety} /> : null}
      <Row label="Farm" value={details.farm} />
      <Row label="Greenhouse" value={details.greenhouse} />
      <Row label="Stem length" value={details.stemLength} />
      <Row label="Number of stems" value={details.numberOfStems} />
      {details.bunches ? <Row label="Bunches" value={details.bunches} /> : null}
      {details.harvestDate ? <Row label="Harvested" value={details.harvestDate} /> : null}
    </View>
  );
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bodyText: { fontFamily: fontFamily.regular, fontSize: scaleFont(14), color: COLORS.text },
  muted: { fontFamily: fontFamily.regular, fontSize: scaleFont(12), color: COLORS.textMuted, marginTop: 4 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginVertical: 10,
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 4 },
  detailLabel: {
    fontFamily: fontFamily.regular,
    fontSize: scaleFont(12),
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  detailValue: { fontFamily: fontFamily.regular, fontSize: scaleFont(14), color: COLORS.text, flexShrink: 1, textAlign: 'right' },
  endBatch: {
    alignSelf: 'flex-end',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: COLORS.text,
  },
  endBatchLabel: { fontFamily: fontFamily.semiBold, color: COLORS.text, fontSize: scaleFont(14) },
});
