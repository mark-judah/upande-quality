import { useCallback, useMemo, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/src/core/ui/Screen';
import { COLORS, fontFamily, fontSize } from '@/src/core/theme';
import { mapAxiosError } from '@/src/core/api/client';
import { useAuthStore } from '@/src/core/auth/store';
import { getTenantByUrl } from '@/src/core/tenant/instance-mapper';
import { readUserStation } from '@/src/core/tenant/user-station';
import { tenantCompany } from '@/src/core/features/station/repository';
import { useKarenDashboardStore } from '@/src/tenants/karen/state/karen-dashboard-store';
import { karenNotReceivedApi } from '@/src/tenants/karen/api/karen-not-received-api';

type Bucket = {
  bucket: string;
  farm: string;
  greenhouse: string;
  varieties: string[];
  stems: number;
  lastHarvest: string;
};

/** HH:MM of a "YYYY-MM-DD HH:MM:SS" server time. */
const timeOf = (ts: string) => (ts.length >= 16 ? ts.slice(11, 16) : '');

/** Every bucket the home's Not Received tile counts, for the home's day and farm. */
export function NotReceivedScreen() {
  const date = useKarenDashboardStore((st) => st.selectedDate);
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
  const showFarm = !shownFarm;

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
      <View style={s.summary}>
        <Text style={s.summaryText}>
          {date}
          {` · ${shownFarm || 'All farms'}`}
        </Text>
        <Text style={s.summaryCount}>
          {(buckets?.length ?? 0).toLocaleString()} buckets · {stems.toLocaleString()} stems
        </Text>
      </View>

      {buckets && buckets.length === 0 ? <Text style={s.empty}>No buckets</Text> : null}

      {(buckets ?? []).map((b) => (
        <View key={b.bucket} style={s.row}>
          <View style={s.rowMain}>
            <Text style={s.bucket}>{b.bucket}</Text>
            <Text style={s.detail} numberOfLines={2}>
              {b.varieties.join(', ') || '—'}
            </Text>
            <Text style={s.meta} numberOfLines={1}>
              {[showFarm ? b.farm : '', b.greenhouse, timeOf(b.lastHarvest)].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <Text style={s.stems}>{b.stems.toLocaleString()}</Text>
        </View>
      ))}
    </Screen>
  );
}

const s = StyleSheet.create({
  headerBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  summary: { marginBottom: 12 },
  summaryText: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: COLORS.textMuted },
  summaryCount: { fontFamily: fontFamily.semiBold, fontSize: fontSize.lg, color: COLORS.text },
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
