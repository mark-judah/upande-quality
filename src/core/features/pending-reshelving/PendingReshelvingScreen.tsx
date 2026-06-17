import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import { Screen } from '@/src/core/ui/Screen';
import { Card, Alert } from '@/src/core/ui/Card';
import { Button } from '@/src/core/ui/Button';
import { useToast } from '@/src/core/ui/Toast';
import { useAuthStore } from '@/src/core/auth/store';
import { useReplacementStore } from '../replacement/store';
import type {
  PendingBunch,
  ReplacementCandidate,
  ReplacementRepository,
} from '../replacement/types';
import { COLORS } from '@/src/core/theme';

type Props = { repository: ReplacementRepository };

const HARVEST_DETAILS_UPDATER = 'Harvest Details Updater';

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return format(parseISO(iso), 'd MMM yyyy');
  } catch {
    return iso;
  }
}

export function PendingReshelvingScreen({ repository }: Props) {
  const hasRole = useAuthStore((s) => s.hasRole(HARVEST_DETAILS_UPDATER));
  const {
    pending,
    pendingLoading,
    pendingError,
    loadPending,
  } = useReplacementStore();

  const [openBunchId, setOpenBunchId] = useState<string | null>(null);

  useEffect(() => {
    loadPending(repository);
  }, [loadPending, repository]);

  if (!hasRole) {
    return (
      <Screen title="Pending Reshelving">
        <Card>
          <Text style={s.muted}>
            You need the <Text style={s.strong}>Harvest Details Updater</Text> role to use this page.
          </Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen title="Pending Reshelving">
      <Card>
        <View style={s.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>BUNCHES WAITING</Text>
            <Text style={s.bigNum}>{pending.length}</Text>
            <Text style={s.muted}>
              Each bunch is on the packhouse floor until a matching bucket appears.
            </Text>
          </View>
          <Pressable
            onPress={() => loadPending(repository)}
            hitSlop={8}
            style={s.refreshBtn}
          >
            <MaterialCommunityIcons name="refresh" size={18} color={COLORS.text} />
          </Pressable>
        </View>
      </Card>

      {pendingLoading ? (
        <Card><Text style={s.muted}>Loading…</Text></Card>
      ) : pendingError ? (
        <Alert tone="danger">{pendingError}</Alert>
      ) : pending.length === 0 ? (
        <Card><Text style={s.muted}>No bunches pending reshelving.</Text></Card>
      ) : (
        pending.map((b) => (
          <PendingBunchCard
            key={b.gradingSe}
            bunch={b}
            repository={repository}
            expanded={openBunchId === b.gradingSe}
            onToggle={() =>
              setOpenBunchId((prev) => (prev === b.gradingSe ? null : b.gradingSe))
            }
            onMoved={() => {
              setOpenBunchId(null);
              loadPending(repository);
            }}
          />
        ))
      )}
    </Screen>
  );
}

function PendingBunchCard({
  bunch,
  repository,
  expanded,
  onToggle,
  onMoved,
}: {
  bunch: PendingBunch;
  repository: ReplacementRepository;
  expanded: boolean;
  onToggle: () => void;
  onMoved: () => void;
}) {
  return (
    <Card>
      <Pressable onPress={onToggle}>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.bunchId}>{bunch.bunchId}</Text>
            <Text style={s.muted}>
              {bunch.variety} · {bunch.stemLength} · {bunch.farm}
            </Text>
            <Text style={s.subtle}>
              From bucket {bunch.sourceBucket.toUpperCase()} · since {formatDate(bunch.pendingSince)}
              {bunch.flaggedBy ? `  ·  by ${bunch.flaggedBy}` : ''}
            </Text>
          </View>
          <MaterialCommunityIcons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={22}
            color={COLORS.textMuted}
          />
        </View>
      </Pressable>

      {expanded && (
        <View style={{ marginTop: 12 }}>
          <ReshelveSection bunch={bunch} repository={repository} onMoved={onMoved} />
        </View>
      )}
    </Card>
  );
}

function ReshelveSection({
  bunch,
  repository,
  onMoved,
}: {
  bunch: PendingBunch;
  repository: ReplacementRepository;
  onMoved: () => void;
}) {
  const {
    bunchDestinations,
    bunchDestinationsLoading,
    bunchDestinationsError,
    acting,
    loadBunchDestinations,
    moveBunch,
  } = useReplacementStore();
  const { showSuccess, showError } = useToast();
  const [destination, setDestination] = useState<ReplacementCandidate | null>(null);

  // Always load destinations for THIS bunch's corrected variety/length when expanded
  useEffect(() => {
    loadBunchDestinations(repository, bunch.variety, bunch.stemLength, bunch.farm, bunch.sourceBucket);
    setDestination(null);
  }, [
    bunch.variety,
    bunch.stemLength,
    bunch.farm,
    bunch.sourceBucket,
    loadBunchDestinations,
    repository,
  ]);

  const onConfirm = async () => {
    if (!destination) return;
    const outcome = await moveBunch(repository, {
      bunchId: bunch.bunchId,
      sourceBucketId: bunch.sourceBucket,
      destBucketId: destination.bucketId,
    });
    if (outcome.ok && outcome.status === 'moved') {
      showSuccess(`Reshelved to bucket ${outcome.destBucket?.toUpperCase()}.`);
      onMoved();
    } else if (!outcome.ok) {
      showError(outcome.error || 'Could not reshelve bunch.');
    }
  };

  if (bunchDestinationsLoading) {
    return <Text style={s.muted}>Searching for matching buckets…</Text>;
  }
  if (bunchDestinationsError) {
    return <Alert tone="danger">{bunchDestinationsError}</Alert>;
  }
  if (bunchDestinations && bunchDestinations.candidates.length === 0) {
    return (
      <Alert tone="warn">
        Still no shelved buckets match {bunch.variety} · {bunch.stemLength} · {bunch.farm}.
        Check back when one is shelved.
      </Alert>
    );
  }

  return (
    <View>
      <Text style={s.helper}>
        Pick a destination bucket. Stems will be added to its shelved stock.
      </Text>
      <View style={{ height: 8 }} />
      {bunchDestinations?.candidates.map((c) => (
        <CandidateRow
          key={c.bucketId}
          candidate={c}
          selected={destination?.bucketId === c.bucketId}
          onPress={() => setDestination(c)}
        />
      ))}
      <View style={{ height: 8 }} />
      <Button
        label={acting ? 'Reshelving…' : 'Reshelve bunch'}
        onPress={onConfirm}
        loading={acting}
        disabled={!destination}
      />
    </View>
  );
}

function CandidateRow({
  candidate,
  selected,
  onPress,
}: {
  candidate: ReplacementCandidate;
  selected: boolean;
  onPress: () => void;
}) {
  const ageLabel =
    candidate.ageDays == null
      ? '—'
      : candidate.ageDays === 0
        ? 'today'
        : candidate.ageDays === 1
          ? '1 day'
          : `${candidate.ageDays} days`;
  const ageWarn = candidate.ageDays != null && candidate.ageDays >= 5;

  return (
    <Pressable onPress={onPress} style={[s.candidateRow, selected && s.candidateRowSelected]}>
      <View style={s.candidateHeader}>
        <Text style={s.candidateId}>{candidate.bucketId.toUpperCase()}</Text>
        <MaterialCommunityIcons
          name={selected ? 'check-circle' : 'checkbox-blank-circle-outline'}
          size={20}
          color={selected ? COLORS.info : COLORS.textMuted}
        />
      </View>
      <View style={s.candidateMeta}>
        <Pill label="Shelf" value={candidate.shelf} />
        <Pill label="Age" value={ageLabel} warn={ageWarn} />
        {candidate.stemQty != null ? <Pill label="Stems" value={String(candidate.stemQty)} /> : null}
      </View>
      <Text style={s.candidateFooter}>
        {candidate.greenhouse ? `${candidate.greenhouse}  ·  ` : ''}
        added {formatDate(candidate.dateAdded)}
      </Text>
    </Pressable>
  );
}

function Pill({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={[s.pill, warn && s.pillWarn]}>
      <Text style={[s.pillLabel, warn && s.pillLabelWarn]}>{label}</Text>
      <Text style={[s.pillValue, warn && s.pillValueWarn]}>{value || '—'}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  helper: { fontSize: 13, color: COLORS.textMuted },
  muted: { fontSize: 13, color: COLORS.textMuted },
  strong: { color: COLORS.text, fontWeight: '600' },
  subtle: { fontSize: 11, color: COLORS.textMuted, marginTop: 4 },

  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { fontSize: 11, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  bigNum: { fontSize: 28, fontWeight: '700', color: COLORS.text, marginTop: 2 },
  refreshBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f4f5f6',
    alignItems: 'center',
    justifyContent: 'center',
  },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bunchId: { fontSize: 14, fontWeight: '700', color: COLORS.text, letterSpacing: 0.4 },

  candidateRow: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    marginBottom: 8,
    backgroundColor: COLORS.bg,
  },
  candidateRowSelected: {
    borderColor: COLORS.info,
    borderWidth: 2,
    backgroundColor: '#f0f7ff',
  },
  candidateHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  candidateId: { fontSize: 14, fontWeight: '700', color: COLORS.text, letterSpacing: 0.5 },
  candidateMeta: { marginTop: 6, flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  candidateFooter: { marginTop: 6, fontSize: 11, color: COLORS.textMuted },

  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#f4f5f6',
    flexDirection: 'row',
    gap: 5,
    alignItems: 'baseline',
  },
  pillWarn: { backgroundColor: '#fde8ec' },
  pillLabel: { fontSize: 10, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 0.3 },
  pillLabelWarn: { color: '#9a1f33' },
  pillValue: { fontSize: 12, color: COLORS.text, fontWeight: '600' },
  pillValueWarn: { color: '#9a1f33' },
});
