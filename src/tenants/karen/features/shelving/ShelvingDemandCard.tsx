import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { Card } from '@/src/core/ui/Card';
import { api } from '@/src/core/api/client';
import { COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';

type DemandRow = {
  variety: string;
  demand: number;
  allocated: number;
  on_shelf: number;
  coverage: number;
  target_to_shelve: number;
};
type DemandResponse = {
  message?: {
    status?: string;
    date?: string;
    rows?: DemandRow[];
    totals?: { demand?: number; target_to_shelve?: number; varieties?: number };
    message?: string;
  };
};

// Only sales farms (Production Settings shelf_locations.sales_shelf) shelve for
// sales, so the guide hides itself for any non-sales farm.

function prettyDate(iso: string): string {
  try {
    return format(new Date(iso + 'T00:00:00'), 'EEE, d MMM');
  } catch {
    return iso;
  }
}

/** Shelving target board: tomorrow's demand per variety vs coverage (allocated +
 *  on-shelf), showing how much of each variety still needs shelving. Read-only;
 *  refreshes whenever the Shelving screen gains focus. */
export function ShelvingDemandCard({ farm }: { farm?: string }) {
  const [rows, setRows] = useState<DemandRow[]>([]);
  const [date, setDate] = useState<string>('');
  const [totalTarget, setTotalTarget] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Non-sales farm → the guide is not applicable; hide the card entirely.
  const [hidden, setHidden] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await api<DemandResponse>({
        method: 'POST',
        url: '/api/method/upande_quality.mobile.api.getShelvingDemand',
        data: farm ? { farm } : {},
        validateStatus: () => true,
      });
      const m = raw.message ?? {};
      if (m.status === 'not_applicable') {
        setHidden(true);
      } else if (m.status === 'success') {
        setHidden(false);
        setRows(m.rows ?? []);
        setDate(m.date ?? '');
        setTotalTarget(m.totals?.target_to_shelve ?? 0);
      } else {
        setError(m.message ?? 'Failed to load demand.');
      }
    } catch {
      setError('Failed to load demand.');
    } finally {
      setLoading(false);
    }
  }, [farm]);

  // Refresh each time the screen is focused (shelving changes coverage).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const visible = rows.filter((r) => r.target_to_shelve > 0);

  // Non-sales farm: the guide does not apply — render nothing.
  if (hidden) return null;

  return (
    <Card title="Shelving Guide">
      <View style={s.hd}>
        <Text style={s.sub}>
          {date ? `Delivery ${prettyDate(date)}` : 'Delivery tomorrow'}
          {farm ? ` · ${farm} shelves` : ' · all farms'}
          {totalTarget > 0 ? ` · ${Math.round(totalTarget).toLocaleString()} stems to balance` : ''}
        </Text>
        <Pressable onPress={load} hitSlop={8} style={s.refresh}>
          <Ionicons name="refresh" size={16} color={COLORS.textMuted} />
        </Pressable>
      </View>

      {error ? <Text style={s.err}>{error}</Text> : null}

      {loading && rows.length === 0 ? (
        <View style={s.center}>
          <ActivityIndicator color={COLORS.text} />
        </View>
      ) : null}

      {!loading && rows.length > 0 ? (
        <>
          <View style={[s.row, s.headRow]}>
            <Text style={[s.cVar, s.hCell]}>Variety</Text>
            <Text style={[s.cNum, s.hCell]}>Balance</Text>
            <Text style={[s.cNum, s.hCell]}>Ordered</Text>
            <Text style={[s.cNum, s.hCell]}>Shelved</Text>
          </View>
          {visible.map((r) => {
            const short = r.target_to_shelve > 0;
            return (
              <View key={r.variety} style={s.row}>
                <Text style={s.cVar} numberOfLines={1}>
                  {r.variety}
                </Text>
                <Text style={[s.cNum, short ? s.needShort : s.needOk]}>
                  {short ? Math.round(r.target_to_shelve).toLocaleString() : '✓'}
                </Text>
                <Text style={s.cNumMuted}>{Math.round(r.demand).toLocaleString()}</Text>
                <Text style={s.cNumMuted}>{Math.round(r.coverage).toLocaleString()}</Text>
              </View>
            );
          })}
          {visible.length === 0 ? (
            <Text style={s.allMet}>All of tomorrow&apos;s demand is covered. 🎉</Text>
          ) : null}
        </>
      ) : null}

      {!loading && rows.length === 0 && !error ? (
        <Text style={s.allMet}>No sales orders for tomorrow&apos;s delivery yet.</Text>
      ) : null}
    </Card>
  );
}

const s = StyleSheet.create({
  hd: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sub: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: COLORS.textMuted, flex: 1 },
  refresh: { padding: 4 },
  err: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: COLORS.danger, marginTop: spacing.xs },
  center: { paddingVertical: spacing.md, alignItems: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  headRow: { borderBottomColor: COLORS.textMuted, marginTop: spacing.sm },
  hCell: { fontFamily: fontFamily.semiBold, fontSize: 11, color: COLORS.textMuted, textTransform: 'uppercase' },
  cVar: { flex: 1, fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.text },
  cNum: { width: 66, textAlign: 'right', fontFamily: fontFamily.bold, fontSize: fontSize.sm },
  cNumMuted: { width: 66, textAlign: 'right', fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: COLORS.textMuted },
  needShort: { color: COLORS.danger },
  needOk: { color: COLORS.success },
  allMet: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: COLORS.success, paddingVertical: spacing.sm },
});
