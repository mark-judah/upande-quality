import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/src/core/ui/Screen';
import { Card, Alert } from '@/src/core/ui/Card';
import { Button } from '@/src/core/ui/Button';
import { ScanField, type ScanFieldHandle } from '@/src/core/scanning/ScanField';
import { focusWhenReady } from '@/src/core/scanning/focus';
import { useToast } from '@/src/core/ui/Toast';
import { useKarenReceivingStore } from '@/src/tenants/karen/state/karen-receiving-store';
import type {
  BucketDetails,
  ReceivingOutcome,
} from '@/src/tenants/karen/repository/karen-receiving-repository';
import { borderRadius, COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';

export function KarenReceivingScreen() {
  const scanRef = useRef<ScanFieldHandle>(null);
  const { loading, lastOutcome, batchMode, batchId, toggleBatchMode, submitScan, reset } =
    useKarenReceivingStore();
  const { showSuccess, showError } = useToast();
  /** The successful receive that drives the popup. Cleared when dismissed. */
  const [receivedPopup, setReceivedPopup] = useState<
    Extract<ReceivingOutcome, { kind: 'received' }> | null
  >(null);

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
      case 'not_harvested':
      case 'not_exist':
      case 'no_harvest_on_date':
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

  return (
    <Screen title="Receiving">
      <Card title="Batch mode">
        <View style={s.row}>
          <View style={{ flex: 1 }}>
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
      ) : lastOutcome && lastOutcome.kind !== 'received' ? (
        // Success goes through the popup — only render the inline card for
        // failures so the operator can read the reason without dismissing.
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
    <Modal
      visible={!!outcome}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
      statusBarTranslucent
    >
      <Pressable style={popup.backdrop} onPress={onDismiss}>
        <Pressable style={popup.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={popup.iconCircle}>
            <Ionicons name="checkmark-circle" size={32} color={COLORS.success ?? '#22C55E'} />
          </View>
          <Text style={popup.title}>Bucket received</Text>
          {outcome ? (
            <>
              <Text style={popup.subtitle}>{outcome.bucketId}</Text>
              <View style={popup.divider} />
              <PopupRow label="Variety" value={outcome.details.variety} />
              <PopupRow label="Stems" value={outcome.details.numberOfStems} />
              {outcome.details.bunches ? (
                <PopupRow label="Bunches" value={outcome.details.bunches} />
              ) : null}
              <PopupRow label="Greenhouse" value={outcome.details.greenhouse} />
              <PopupRow label="Harvested" value={outcome.details.harvestDate} />
            </>
          ) : null}
          <View style={{ height: spacing.md }} />
          <Button label="Next bucket" onPress={onDismiss} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function PopupRow({ label, value }: { label: string; value: string | undefined }) {
  if (!value) return null;
  return (
    <View style={popup.row}>
      <Text style={popup.rowLabel}>{label}</Text>
      <Text style={popup.rowValue}>{value}</Text>
    </View>
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
  bodyText: { fontSize: 14, color: COLORS.text },
  muted: { fontSize: 12, color: COLORS.textMuted, marginTop: 4 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginVertical: 10,
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  detailLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  detailValue: { fontSize: 14, color: COLORS.text, flexShrink: 1, textAlign: 'right' },
  endBatch: {
    alignSelf: 'flex-end',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: COLORS.text,
  },
  endBatchLabel: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
});

const popup = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: COLORS.overlay ?? 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  sheet: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: COLORS.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    alignItems: 'stretch',
  },
  iconCircle: {
    alignSelf: 'center',
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.lg,
    color: COLORS.text,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginVertical: spacing.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  rowLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  rowValue: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: COLORS.text,
    flexShrink: 1,
    textAlign: 'right',
  },
});
