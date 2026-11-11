import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/src/core/ui/Screen';
import { Card, Alert } from '@/src/core/ui/Card';
import { SkeletonCards } from '@/src/core/ui/SkeletonCards';
import { ScanField, type ScanFieldHandle } from '@/src/core/scanning/ScanField';
import { useToast } from '@/src/core/ui/Toast';
import { useKarenDiscardStore } from '@/src/tenants/karen/state/karen-discard-store';
import type {
  DiscardListBucket,
  DiscardRequestGroup,
} from '@/src/tenants/karen/repository/karen-discard-repository';
import { COLORS, fontFamily, fontSize, spacing, scaleFont } from '@/src/core/theme';

const norm = (id: string): string => id.trim().toLowerCase();

export function KarenDiscardsScreen({ userFarm }: { userFarm: string }) {
  const scanRef = useRef<ScanFieldHandle>(null);
  const {
    requests,
    listLoading,
    listError,
    discardedIds,
    discardingId,
    loadList,
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

  // A bucket is discarded if the server says so, or it was scanned off in this session.
  const isDone = (b: DiscardListBucket) => b.discarded || discardedIds.includes(norm(b.bucketId));
  const groups = useMemo(
    () =>
      requests.map((g) => ({
        ...g,
        // Still to discard first (by shelf), then the discarded ones.
        buckets: [...g.buckets].sort(
          (a, b) => Number(isDone(a)) - Number(isDone(b)) || a.shelf.localeCompare(b.shelf),
        ),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [requests, discardedIds],
  );
  const total = groups.reduce((n, g) => n + g.buckets.length, 0);
  const done = groups.reduce((n, g) => n + g.buckets.filter(isDone).length, 0);

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
          {userFarm} · {done}/{total} discarded
        </Text>
      </Card>

      {listError ? <Alert tone="danger">{listError}</Alert> : null}

      {listLoading && groups.length === 0 ? (
        <SkeletonCards cards={3} rows={2} />
      ) : null}

      {!listLoading && !listError && groups.length === 0 ? (
        <Card>
          <View style={s.empty}>
            <Ionicons name="trash-outline" size={26} color={COLORS.textMuted} />
            <Text style={s.emptyTitle}>Nothing to discard</Text>
            <Text style={s.emptyHint}>No approved discard requests for {userFarm}.</Text>
          </View>
        </Card>
      ) : null}

      {groups.map((g) => (
        <View key={g.name} style={s.groupBlock}>
          <RequestHeader g={g} done={g.buckets.filter(isDone).length} />
          <Card>
            {g.buckets.map((b, i) => (
              <BucketRow key={b.bucketId} b={b} first={i === 0} discarded={isDone(b)} />
            ))}
          </Card>
        </View>
      ))}
    </Screen>
  );
}

function RequestHeader({ g, done }: { g: DiscardRequestGroup; done: number }) {
  const who = [
    g.requestedBy ? `Requested by ${g.requestedBy}` : null,
    g.approvedBy ? `Approved by ${g.approvedBy}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <View style={s.groupHdr}>
      <View style={s.groupHdrTop}>
        <Text style={s.groupName} numberOfLines={1}>
          {g.name || 'Discard request'}
          {g.requestedDate ? <Text style={s.groupDate}>  {g.requestedDate}</Text> : null}
        </Text>
        <Text style={[s.groupCount, done === g.buckets.length && s.groupCountDone]}>
          {done}/{g.buckets.length} discarded
        </Text>
      </View>
      {who ? <Text style={s.groupWho}>{who}</Text> : null}
    </View>
  );
}

function BucketRow({
  b,
  first,
  discarded,
}: {
  b: DiscardListBucket;
  first: boolean;
  discarded: boolean;
}) {
  const meta = [
    b.shelf || null,
    b.variety,
    b.stems != null ? `${b.stems} stems` : null,
    b.ageDays != null ? `${b.ageDays}d` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <View style={[s.row, !first && s.rowBorder]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.bId, discarded && s.bIdDone]} numberOfLines={1}>
          {b.bucketId}
        </Text>
        {meta ? (
          <Text style={s.bMeta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      {discarded ? (
        <View style={s.doneTag}>
          <View style={s.doneTop}>
            <Ionicons name="checkmark-circle" size={16} color={COLORS.success ?? '#12B76A'} />
            <Text style={s.doneText}>Discarded</Text>
          </View>
          {b.discardedBy || b.discardedAt ? (
            <Text style={s.doneMeta} numberOfLines={1}>
              {[b.discardedBy, b.discardedAt?.slice(0, 16)].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
        </View>
      ) : (
        <Text style={s.todoText}>To discard</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  muted: { fontFamily: fontFamily.regular, fontSize: scaleFont(12), color: COLORS.textMuted, marginTop: 8 },
  groupBlock: { marginTop: spacing.md },
  groupHdr: { marginBottom: spacing.xs, marginHorizontal: spacing.xs, gap: 2 },
  groupHdrTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  groupName: { flex: 1, fontFamily: fontFamily.bold, fontSize: fontSize.sm, color: COLORS.text },
  groupDate: { fontFamily: fontFamily.medium, color: COLORS.textSecondary },
  groupCount: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: COLORS.textSecondary },
  groupCountDone: { color: COLORS.success ?? '#12B76A' },
  groupWho: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: COLORS.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  bId: { fontFamily: fontFamily.bold, fontSize: fontSize.sm, color: COLORS.text },
  bIdDone: { color: COLORS.textMuted, textDecorationLine: 'line-through' },
  bMeta: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: COLORS.textSecondary, marginTop: 2 },
  doneTag: { alignItems: 'flex-end', maxWidth: '50%' },
  doneTop: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  doneText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: COLORS.success ?? '#12B76A' },
  doneMeta: { fontFamily: fontFamily.regular, fontSize: scaleFont(10), color: COLORS.textMuted, marginTop: 2 },
  todoText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: COLORS.textSecondary },
  empty: { alignItems: 'center', paddingVertical: spacing.lg, gap: spacing.xs },
  emptyTitle: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: COLORS.text },
  emptyHint: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: COLORS.textMuted, textAlign: 'center' },
});
