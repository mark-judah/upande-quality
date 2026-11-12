import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { Screen } from '@/src/core/ui/Screen';
import { COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';
import { mapAxiosError } from '@/src/core/api/client';
import { useKarenDashboardStore } from '@/src/tenants/karen/state/karen-dashboard-store';
import {
  BucketRow,
  FarmCards,
  HomeButton,
  homeScopeParams,
  serverDateTime,
  TotalTiles,
} from '@/src/tenants/karen/features/bucket-list/BucketList';
import { karenNeedsAttentionApi } from '@/src/tenants/karen/api/karen-needs-attention-api';

type Item = {
  kind: 'reshelve' | 'replacement';
  name: string;
  bucket: string;
  bunch: string;
  farm: string;
  variety: string;
  stemLength: string;
  stems: number;
  reason: string;
  since: string;
};

const farmOf = (i: Item) => i.farm;
const stemsOf = (i: Item) => i.stems;

/** What the home's Needs Attention tile counts, for the home's farm: bunches
 *  waiting to be reshelved and open bucket replacements. */
export function NeedsAttentionScreen() {
  const farm = useKarenDashboardStore((st) => st.selectedFarm ?? st.data?.farm ?? null);
  const [items, setItems] = useState<Item[] | null>(null);
  /** The farm the server listed; '' = every farm. */
  const [shownFarm, setShownFarm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await karenNeedsAttentionApi.fetch(await homeScopeParams(farm));
      const m = raw?.message;
      if (!m || typeof m !== 'object') throw new Error('Unexpected response from server.');
      if (m.error) throw new Error(m.error);
      setShownFarm(String(m.farm ?? ''));
      setItems(
        (m.items ?? []).map((r) => ({
          kind: r.kind === 'reshelve' ? 'reshelve' : 'replacement',
          name: String(r.name ?? ''),
          bucket: String(r.bucket ?? ''),
          bunch: String(r.bunch ?? ''),
          farm: String(r.farm ?? ''),
          variety: String(r.variety ?? ''),
          stemLength: String(r.stem_length ?? ''),
          stems: Number(r.stems) || 0,
          reason: String(r.reason ?? ''),
          since: String(r.since ?? ''),
        })),
      );
    } catch (err) {
      setError(mapAxiosError(err).message);
    } finally {
      setLoading(false);
    }
  }, [farm]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const counts = useMemo(() => {
    let reshelve = 0;
    for (const i of items ?? []) if (i.kind === 'reshelve') reshelve++;
    return { reshelve, replacement: (items?.length ?? 0) - reshelve };
  }, [items]);

  return (
    <Screen
      title="Needs Attention"
      loading={loading && items === null}
      error={error}
      onRetry={load}
      onRefresh={load}
      headerRight={<HomeButton />}
    >
      <Text style={s.summaryText}>{shownFarm || 'All farms'}</Text>

      <TotalTiles
        tiles={[
          { label: 'PENDING RESHELVING', value: counts.reshelve },
          { label: 'OPEN REPLACEMENTS', value: counts.replacement },
        ]}
      />

      {items && items.length === 0 ? <Text style={s.empty}>Nothing needs attention</Text> : null}

      <FarmCards
        rows={items ?? []}
        allFarms={!shownFarm}
        farmOf={farmOf}
        stemsOf={stemsOf}
        unit="items"
        renderRow={(i, inCard) => (
          <BucketRow
            key={i.name}
            inCard={inCard}
            title={i.bucket || i.bunch || i.name}
            lines={[
              i.kind === 'reshelve'
                ? `Pending reshelving${i.bunch ? ` · bunch ${i.bunch}` : ''}`
                : `Replacement${i.reason ? ` · ${i.reason}` : ''}`,
              [i.variety, i.stemLength].filter(Boolean).join(' · ') || '—',
              serverDateTime(i.since),
            ].filter(Boolean)}
            value={i.stems}
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
