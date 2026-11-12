import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { Screen } from '@/src/core/ui/Screen';
import { COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';
import { mapAxiosError } from '@/src/core/api/client';
import { useKarenDashboardStore } from '@/src/tenants/karen/state/karen-dashboard-store';
import { DayStepper } from '@/src/tenants/karen/features/dashboard/DayStepper';
import {
  BucketRow,
  FarmCards,
  HomeButton,
  homeScopeParams,
  serverDateTime,
  TotalTiles,
} from '@/src/tenants/karen/features/bucket-list/BucketList';
import { karenNotReceivedApi } from '@/src/tenants/karen/api/karen-not-received-api';

type Bucket = {
  bucket: string;
  farm: string;
  greenhouse: string;
  varieties: string[];
  stems: number;
  lastHarvest: string;
};

const farmOf = (b: Bucket) => b.farm;
const stemsOf = (b: Bucket) => b.stems;

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
      const raw = await karenNotReceivedApi.fetch({ date, ...(await homeScopeParams(farm)) });
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

  return (
    <Screen
      title="Not Received"
      loading={loading && buckets === null}
      error={error}
      onRetry={load}
      onRefresh={load}
      headerRight={<HomeButton />}
    >
      <DayStepper value={date} onChange={setDate} />
      <Text style={s.summaryText}>{shownFarm || 'All farms'}</Text>

      <TotalTiles
        tiles={[
          { label: 'BUCKETS', value: buckets?.length ?? 0 },
          { label: 'STEMS', value: stems },
        ]}
      />

      {buckets && buckets.length === 0 ? <Text style={s.empty}>No buckets</Text> : null}

      <FarmCards
        rows={buckets ?? []}
        allFarms={!shownFarm}
        farmOf={farmOf}
        stemsOf={stemsOf}
        unit="buckets"
        renderRow={(b, inCard) => (
          <BucketRow
            key={b.bucket}
            inCard={inCard}
            title={b.bucket}
            lines={[
              b.varieties.join(', ') || '—',
              [b.greenhouse, serverDateTime(b.lastHarvest)].filter(Boolean).join(' · '),
            ]}
            value={b.stems}
          />
        )}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  summaryText: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: COLORS.textMuted, marginBottom: spacing.sm },
  empty: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 24,
  },
});
