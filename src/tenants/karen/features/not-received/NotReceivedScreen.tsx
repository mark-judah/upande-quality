import { useCallback, useMemo, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { format, parseISO } from 'date-fns';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/src/core/ui/Screen';
import { COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';
import { mapAxiosError } from '@/src/core/api/client';
import { useAuthStore } from '@/src/core/auth/store';
import { getTenantByUrl } from '@/src/core/tenant/instance-mapper';
import { readUserStation } from '@/src/core/tenant/user-station';
import { tenantCompany } from '@/src/core/features/station/repository';
import { useKarenDashboardStore } from '@/src/tenants/karen/state/karen-dashboard-store';
import { DayStepper } from '@/src/tenants/karen/features/dashboard/DayStepper';
import { karenNotReceivedApi } from '@/src/tenants/karen/api/karen-not-received-api';

type Bucket = {
  bucket: string;
  farm: string;
  greenhouse: string;
  varieties: string[];
  stems: number;
  lastHarvest: string;
};

const DARK_A = '#171717';
const DARK_B = '#1C1917';

/** "12 Nov 2026, 23:37" for a "YYYY-MM-DD HH:MM:SS[.ffffff]" server time. */
function harvestedAt(ts: string): string {
  if (ts.length < 16) return '';
  try {
    return format(parseISO(ts.slice(0, 19).replace(' ', 'T')), 'd MMM yyyy, HH:mm');
  } catch {
    return ts.slice(0, 16);
  }
}

/** Every bucket the home's Not Received tile counts, for the home's day and farm. */
export function NotReceivedScreen() {
  const homeDate = useKarenDashboardStore((st) => st.selectedDate);
  // Opens on the home's day; the stepper moves this page only.
  const [date, setDate] = useState(homeDate);
  const farm = useKarenDashboardStore((st) => st.selectedFarm ?? st.data?.farm ?? null);
  const [buckets, setBuckets] = useState<Bucket[] | null>(null);
  /** The farm the server listed; '' = every farm. */
  const [shownFarm, setShownFarm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { instanceUrl } = useAuthStore.getState();
      const station = await readUserStation().catch(() => null);
      const raw = await karenNotReceivedApi.fetch({
        date,
        // The home's farm; before the home has loaded, the station's.
        farm: farm ?? station?.userFarm ?? undefined,
        stationFarm: station?.userFarm,
        company: tenantCompany(getTenantByUrl(instanceUrl)),
      });
      const m = raw?.message;
      if (!m || typeof m !== 'object') throw new Error('Unexpected response from server.');
      if (m.error) throw new Error(m.error);
      setShownFarm(String(m.farm ?? ''));
      setBuckets(
        (m.buckets ?? []).map((b) => ({
          bucket: String(b.bucket ?? ''),
          farm: String(b.farm ?? ''),
          greenhouse: String(b.greenhouse ?? ''),
          varieties: (b.varieties ?? []).map(String),
          stems: Number(b.stems) || 0,
          lastHarvest: String(b.last_harvest ?? ''),
        })),
      );
    } catch (err) {
      setError(mapAxiosError(err).message);
    } finally {
      setLoading(false);
    }
  }, [date, farm]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const stems = useMemo(() => (buckets ?? []).reduce((t, b) => t + b.stems, 0), [buckets]);
  const allFarms = !shownFarm;

  // All farms: one group per farm, by name; one farm: a single group.
  const groups = useMemo(() => {
    const byFarm = new Map<string, Bucket[]>();
    for (const b of buckets ?? []) {
      const key = allFarms ? b.farm : '';
      const list = byFarm.get(key);
      if (list) list.push(b);
      else byFarm.set(key, [b]);
    }
    return [...byFarm.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, rows]) => ({ name, rows, stems: rows.reduce((t, b) => t + b.stems, 0) }));
  }, [buckets, allFarms]);

  return (
    <Screen
      title="Not Received"
      loading={loading && buckets === null}
      error={error}
      onRetry={load}
      onRefresh={load}
      headerRight={
        <Pressable
          style={s.headerBtn}
          hitSlop={6}
          onPress={() => router.navigate('/')}
          accessibilityRole="button"
          accessibilityLabel="Home"
        >
          <Ionicons name="home-outline" size={20} color={COLORS.text} />
        </Pressable>
      }
    >
      <DayStepper value={date} onChange={setDate} />
      <Text style={s.summaryText}>{shownFarm || 'All farms'}</Text>

      <View style={s.tiles}>
        <View style={[s.tile, { backgroundColor: DARK_A }]}>
          <Text style={s.tileChip}>BUCKETS</Text>
          <Text style={s.tileValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
            {(buckets?.length ?? 0).toLocaleString()}
          </Text>
        </View>
        <View style={[s.tile, { backgroundColor: DARK_B }]}>
          <Text style={s.tileChip}>STEMS</Text>
          <Text style={s.tileValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
            {stems.toLocaleString()}
          </Text>
        </View>
      </View>

      {buckets && buckets.length === 0 ? <Text style={s.empty}>No buckets</Text> : null}

      {groups.map((g) => (
        <View key={g.name || 'farm'} style={s.group}>
          {allFarms ? (
            <View style={s.groupHead}>
              <Text style={s.groupName} numberOfLines={1}>
                {g.name || '—'}
              </Text>
              <Text style={s.groupTotals}>
                {g.rows.length.toLocaleString()} buckets · {g.stems.toLocaleString()} stems
              </Text>
            </View>
          ) : null}
          {g.rows.map((b) => (
            <View key={b.bucket} style={s.row}>
              <View style={s.rowMain}>
                <Text style={s.bucket}>{b.bucket}</Text>
                <Text style={s.detail} numberOfLines={2}>
                  {b.varieties.join(', ') || '—'}
                </Text>
                <Text style={s.meta} numberOfLines={1}>
                  {[b.greenhouse, harvestedAt(b.lastHarvest)].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Text style={s.stems}>{b.stems.toLocaleString()}</Text>
            </View>
          ))}
        </View>
      ))}
    </Screen>
  );
}

const s = StyleSheet.create({
  headerBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  summaryText: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: COLORS.textMuted, marginBottom: spacing.sm },
  tiles: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  tile: { flex: 1, borderRadius: 20, padding: spacing.lg, minHeight: 96, justifyContent: 'flex-end' },
  tileChip: {
    fontFamily: fontFamily.medium,
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  tileValue: { fontFamily: fontFamily.bold, fontSize: 32, lineHeight: 38, color: '#FFFFFF' },
  group: { marginBottom: spacing.lg },
  groupHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.text,
  },
  groupName: { flex: 1, fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: COLORS.text },
  groupTotals: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: COLORS.textMuted },
  empty: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  rowMain: { flex: 1, paddingRight: 12 },
  bucket: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: COLORS.text },
  detail: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: COLORS.textSecondary },
  meta: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: COLORS.textMuted },
  stems: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: COLORS.danger },
});
