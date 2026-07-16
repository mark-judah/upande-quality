import { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/src/core/ui/Screen';
import { Card, Alert } from '@/src/core/ui/Card';
import { ScanField, type ScanFieldHandle } from '@/src/core/scanning/ScanField';
import { useToast } from '@/src/core/ui/Toast';
import { useKarenDiscardStore } from '@/src/tenants/karen/state/karen-discard-store';
import type { DiscardListBucket } from '@/src/tenants/karen/repository/karen-discard-repository';
import { borderRadius, COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';

const norm = (id: string): string => id.trim().toLowerCase();

export function KarenDiscardsScreen({ userFarm }: { userFarm: string }) {
  const scanRef = useRef<ScanFieldHandle>(null);
  const {
    buckets,
    listLoading,
    listError,
    discardedIds,
    discardingId,
    loadList,
    discard,
    submitScan,
    reset,
  } = useKarenDiscardStore();
  const { showSuccess, showError } = useToast();

  useEffect(() => {
    loadList(userFarm);
    return () => reset();
  }, [loadList, reset, userFarm]);

  const onScan = async (raw: string) => {
    const outcome = await submitScan(raw, userFarm);
    if (outcome.kind === 'success') showSuccess(outcome.message);
    else showError(outcome.message);
    scanRef.current?.clear();
    scanRef.current?.focus();
  };

  const onDiscard = async (b: DiscardListBucket) => {
    const outcome = await discard(b.bucketId, userFarm);
    if (outcome.kind === 'success') showSuccess(outcome.message);
    else showError(outcome.message);
  };

  // Group the work-list by shelf for display.
  const shelves = useMemo(() => {
    const m = new Map<string, DiscardListBucket[]>();
    for (const b of buckets) {
      const key = b.shelf || 'No shelf';
      const arr = m.get(key);
      if (arr) arr.push(b);
      else m.set(key, [b]);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [buckets]);

  const done = discardedIds.length;

  return (
    <Screen title="Discards" onRefresh={() => loadList(userFarm)}>
      <Card title="Scan bucket to discard">
        <ScanField
          ref={scanRef}
          onScan={onScan}
          autoFocus
          placeholder="Scan bucket QR"
          editable={!discardingId}
        />
        <Text style={s.muted}>
          {userFarm} · {done}/{buckets.length} discarded
        </Text>
      </Card>

      {listError ? <Alert tone="danger">{listError}</Alert> : null}

      {listLoading && buckets.length === 0 ? (
        <Card>
          <View style={s.empty}>
            <ActivityIndicator color={COLORS.text} />
            <Text style={s.emptyHint}>Loading discard list…</Text>
          </View>
        </Card>
      ) : null}

      {!listLoading && buckets.length === 0 ? (
        <Card>
          <View style={s.empty}>
            <Ionicons name="trash-outline" size={26} color={COLORS.textMuted} />
            <Text style={s.emptyTitle}>Nothing to discard</Text>
            <Text style={s.emptyHint}>No approved discard requests for {userFarm}.</Text>
          </View>
        </Card>
      ) : null}

      {shelves.map(([shelf, rows]) => (
        <View key={shelf} style={s.shelfBlock}>
          <Text style={s.shelfHdr}>
            {shelf} · {rows.length}
          </Text>
          <Card>
            {rows.map((b, i) => (
              <BucketRow
                key={b.bucketId}
                b={b}
                first={i === 0}
                discarded={discardedIds.includes(norm(b.bucketId))}
                busy={discardingId === norm(b.bucketId)}
                onDiscard={() => onDiscard(b)}
              />
            ))}
          </Card>
        </View>
      ))}
    </Screen>
  );
}

function BucketRow({
  b,
  first,
  discarded,
  busy,
  onDiscard,
}: {
  b: DiscardListBucket;
  first: boolean;
  discarded: boolean;
  busy: boolean;
  onDiscard: () => void;
}) {
  const meta = [
    b.variety,
    b.stems != null ? `${b.stems} stems` : null,
    b.ageDays != null ? `${b.ageDays}d` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <View style={[s.row, !first && s.rowBorder]}>
      <View style={{ flex: 1 }}>
        <Text style={[s.bId, discarded && s.bIdDone]}>{b.bucketId}</Text>
        {meta ? (
          <Text style={s.bMeta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      {discarded ? (
        <View style={s.doneTag}>
          <Ionicons name="checkmark-circle" size={16} color={COLORS.success ?? '#12B76A'} />
          <Text style={s.doneText}>Discarded</Text>
        </View>
      ) : (
        <Pressable
          onPress={onDiscard}
          disabled={busy}
          hitSlop={6}
          style={[s.discardBtn, busy && s.discardBtnBusy]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={COLORS.danger ?? '#B42318'} />
          ) : (
            <>
              <Ionicons name="trash-outline" size={15} color={COLORS.danger ?? '#B42318'} />
              <Text style={s.discardText}>Discard</Text>
            </>
          )}
        </Pressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  muted: { fontSize: 12, color: COLORS.textMuted, marginTop: 8 },
  shelfBlock: { marginTop: spacing.md },
  shelfHdr: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.sm,
    color: COLORS.text,
    marginBottom: spacing.xs,
    marginLeft: spacing.xs,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  bId: { fontFamily: 'monospace', fontSize: fontSize.sm, color: COLORS.text, fontWeight: '700' },
  bIdDone: { color: COLORS.textMuted, textDecorationLine: 'line-through' },
  bMeta: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: COLORS.textSecondary, marginTop: 2 },
  discardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: borderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.danger ?? '#B42318',
    minWidth: 92,
    justifyContent: 'center',
  },
  discardBtnBusy: { opacity: 0.6 },
  discardText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: COLORS.danger ?? '#B42318' },
  doneTag: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 92, justifyContent: 'center' },
  doneText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: COLORS.success ?? '#12B76A' },
  empty: { alignItems: 'center', paddingVertical: spacing.lg, gap: spacing.xs },
  emptyTitle: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: COLORS.text },
  emptyHint: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: COLORS.textMuted, textAlign: 'center' },
});
