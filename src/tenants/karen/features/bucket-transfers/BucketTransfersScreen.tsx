import { useEffect, useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { Screen } from '@/src/core/ui/Screen';
import { Card, Alert } from '@/src/core/ui/Card';
import { Segmented } from '@/src/core/ui/Segmented';
import {
  useKarenBucketTransfersStore,
  type TransferTab,
  type TransferGroup,
} from '@/src/tenants/karen/state/karen-bucket-transfers-store';
import { borderRadius, COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';

const GREEN = '#12B76A';
const GREEN_BG = '#ECFDF3';
const AMBER = '#B54708';
const AMBER_BG = '#FFFAEB';

// Order-level label per the coldroom's mental model: nothing shelved yet = still
// coming in; some shelved = it's here and being put away; all shelved = done.
const STATUS_LABEL: Record<TransferGroup['status'], string> = {
  none: 'Incoming',
  progress: 'Arrived · shelving',
  ready: 'Ready to issue',
};

function prettyDate(iso: string): string {
  try {
    return format(new Date(iso + 'T00:00:00'), 'EEE, d MMM');
  } catch {
    return iso;
  }
}

export function KarenBucketTransfersScreen() {
  const { date, tab, groups, loading, error, loaded, setTab, stepDate, load } =
    useKarenBucketTransfersStore();

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const c = { progress: 0, ready: 0, none: 0 };
    for (const g of groups) c[g.status] += 1;
    return c;
  }, [groups]);

  const visible = useMemo(() => groups.filter((g) => g.status === tab), [groups, tab]);

  return (
    <Screen title="Bucket Transfers" onRefresh={load}>
      {/* Delivery-date stepper (single day; defaults to tomorrow). */}
      <View style={s.dateRow}>
        <Pressable onPress={() => stepDate(-1)} hitSlop={8} style={s.dateBtn}>
          <Ionicons name="chevron-back" size={20} color={COLORS.text} />
        </Pressable>
        <View style={s.dateCenter}>
          <Text style={s.dateLabel}>Delivery date</Text>
          <Text style={s.dateValue}>{prettyDate(date)}</Text>
        </View>
        <Pressable onPress={() => stepDate(1)} hitSlop={8} style={s.dateBtn}>
          <Ionicons name="chevron-forward" size={20} color={COLORS.text} />
        </Pressable>
      </View>

      <Segmented
        value={tab}
        onChange={(v) => setTab(v as TransferTab)}
        options={[
          { value: 'progress', label: `Shelving (${counts.progress})` },
          { value: 'ready', label: `Ready (${counts.ready})` },
          { value: 'none', label: `Not shelved (${counts.none})` },
        ]}
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {loading && groups.length === 0 ? (
        <Card>
          <View style={s.empty}>
            <ActivityIndicator color={COLORS.text} />
            <Text style={s.emptyHint}>Loading transfers…</Text>
          </View>
        </Card>
      ) : null}

      {loaded && !loading && visible.length === 0 && !error ? (
        <Card>
          <View style={s.empty}>
            <Ionicons name="cube-outline" size={26} color={COLORS.textMuted} />
            <Text style={s.emptyTitle}>Nothing here</Text>
            <Text style={s.emptyHint}>
              No orders in “{tabTitle(tab)}” for {prettyDate(date)}.
            </Text>
          </View>
        </Card>
      ) : null}

      {visible.map((g) => (
        <OrderCard key={g.oplName} g={g} />
      ))}
    </Screen>
  );
}

function tabTitle(tab: TransferTab): string {
  return tab === 'progress' ? 'Shelving in progress' : tab === 'ready' ? 'Ready to issue' : 'Not shelved';
}

function OrderCard({ g }: { g: TransferGroup }) {
  const label = STATUS_LABEL[g.status];
  const labelTone = g.status === 'ready' ? { fg: GREEN, bg: GREEN_BG } : { fg: AMBER, bg: AMBER_BG };
  return (
    <Card>
      <View style={s.hd}>
        <View style={{ flex: 1 }}>
          <Text style={s.order} numberOfLines={1}>
            {g.orderName}
          </Text>
          <Text style={s.meta} numberOfLines={1}>
            {[g.customer, g.farm].filter(Boolean).join(' · ') || '—'}
          </Text>
        </View>
        <View style={[s.statusTag, { backgroundColor: labelTone.bg }]}>
          <Text style={[s.statusTxt, { color: labelTone.fg }]}>{label}</Text>
        </View>
      </View>

      <View style={s.subRow}>
        <View style={s.truckPill}>
          <Ionicons name="car-outline" size={14} color={COLORS.text} />
          <Text style={s.truckPlate}>{g.truck || 'No truck'}</Text>
        </View>
        <Text style={s.count}>
          {g.shelvedCount}/{g.total} shelved
        </Text>
      </View>

      <View style={s.divider} />

      {g.buckets.map((b) => {
        const meta = [
          b.variety,
          b.stems != null ? `${Math.round(b.stems)} stems` : null,
          b.stemLength,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <View key={b.bucketId} style={s.bRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.bId}>{b.bucketId}</Text>
              {meta ? (
                <Text style={s.bMeta} numberOfLines={1}>
                  {meta}
                </Text>
              ) : null}
            </View>
            <ShelfPill shelved={b.shelved} />
          </View>
        );
      })}
    </Card>
  );
}

function ShelfPill({ shelved }: { shelved: boolean }) {
  return (
    <View style={[s.pill, shelved ? s.pillShelved : s.pillNot]}>
      <Ionicons
        name={shelved ? 'checkmark-circle' : 'ellipse-outline'}
        size={13}
        color={shelved ? GREEN : COLORS.textMuted}
      />
      <Text style={[s.pillTxt, { color: shelved ? GREEN : COLORS.textMuted }]}>
        {shelved ? 'Shelved' : 'Not shelved'}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
    borderRadius: borderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  dateBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  dateCenter: { alignItems: 'center' },
  dateLabel: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  dateValue: { fontFamily: fontFamily.bold, fontSize: fontSize.md, color: COLORS.text, marginTop: 2 },
  hd: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  order: { fontFamily: fontFamily.bold, fontSize: fontSize.sm, color: COLORS.text },
  meta: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: COLORS.textMuted, marginTop: 2 },
  statusTag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: borderRadius.full },
  statusTxt: { fontFamily: fontFamily.bold, fontSize: 11 },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  truckPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.md,
    backgroundColor: COLORS.surfaceAlt,
  },
  truckPlate: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.sm,
    color: COLORS.text,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  count: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: COLORS.textSecondary },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginVertical: spacing.sm,
  },
  bRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  bId: { fontFamily: 'monospace', fontSize: fontSize.sm, color: COLORS.text, fontWeight: '700' },
  bMeta: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: COLORS.textSecondary, marginTop: 2 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillShelved: { backgroundColor: GREEN_BG, borderColor: '#ABEFC6' },
  pillNot: { backgroundColor: COLORS.surfaceAlt, borderColor: COLORS.border },
  pillTxt: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs },
  empty: { alignItems: 'center', paddingVertical: spacing.lg, gap: spacing.xs },
  emptyTitle: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: COLORS.text },
  emptyHint: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: COLORS.textMuted, textAlign: 'center' },
});
