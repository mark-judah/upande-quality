import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import { Screen } from '@/src/core/ui/Screen';
import { Card, Alert } from '@/src/core/ui/Card';
import { Button } from '@/src/core/ui/Button';
import { LabeledInput } from '@/src/core/ui/LabeledInput';
import { ScanField, type ScanFieldHandle } from '@/src/core/scanning/ScanField';
import { useToast } from '@/src/core/ui/Toast';
import { useAuthStore } from '@/src/core/auth/store';
import { useReplacementStore } from './store';
import type {
  BucketOplAllocation,
  ReplacementCandidate,
  ReplacementRepository,
} from './types';
import type {
  BucketAllocationSnapshot,
  SessionBunch,
  TraceabilityRepository,
  TraceabilitySnapshot,
} from '@/src/core/features/traceability/types';
import { COLORS } from '@/src/core/theme';

type Props = {
  replacementRepo: ReplacementRepository;
  traceabilityRepo: TraceabilityRepository;
};

const HARVEST_DETAILS_UPDATER = 'Harvest Details Updater';

type ScanResult =
  | { kind: 'bucket'; id: string }
  | { kind: 'bunch'; id: string };

function parseScan(raw: string): ScanResult {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.bunch_id === 'string' && obj.bunch_id.trim()) {
        return { kind: 'bunch', id: obj.bunch_id.trim() };
      }
      if (typeof obj.bucket_id === 'string' && obj.bucket_id.trim()) {
        return { kind: 'bucket', id: obj.bucket_id.trim() };
      }
      for (const [id, kind] of Object.entries(obj)) {
        if (kind === 'bucket') return { kind: 'bucket', id };
        if (kind === 'bunch') return { kind: 'bunch', id };
      }
    }
  } catch {
    // not JSON
  }
  return { kind: 'bucket', id: trimmed };
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return format(parseISO(iso), 'd MMM yyyy');
  } catch {
    return iso;
  }
}

export function ReplacementScreen({ replacementRepo, traceabilityRepo }: Props) {
  const scanRef = useRef<ScanFieldHandle>(null);
  const hasRole = useAuthStore((s) => s.hasRole(HARVEST_DETAILS_UPDATER));
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [snapshot, setSnapshot] = useState<TraceabilitySnapshot | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  const onScan = async (raw: string) => {
    const result = parseScan(raw);
    setScan(result);
    setSnapshot(null);
    setSnapshotError(null);
    setLoadingSnapshot(true);
    try {
      const snap = await traceabilityRepo.lookup({ kind: result.kind, id: result.id });
      setSnapshot(snap);
    } catch (err) {
      setSnapshotError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingSnapshot(false);
    }
  };

  const reset = () => {
    setScan(null);
    setSnapshot(null);
    setSnapshotError(null);
  };

  if (!hasRole) {
    return (
      <Screen title="Replacement">
        <Card>
          <Text style={s.muted}>
            You need the <Text style={s.strong}>Harvest Details Updater</Text> role to use this page.
          </Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen title="Replacement">
      <Card title="Scan a bucket or bunch">
        <Text style={s.helper}>
          Scan a bucket to replace it entirely, or a bunch to correct its details and move it to the right bucket.
        </Text>
        <View style={{ height: 12 }} />
        <ScanField ref={scanRef} onScan={onScan} autoFocus placeholder="Bucket / Bunch ID" />
      </Card>

      {loadingSnapshot ? (
        <Card>
          <Text style={s.muted}>Loading {scan?.kind ?? ''} {scan?.id ?? ''}…</Text>
        </Card>
      ) : snapshotError ? (
        <Alert tone="danger">{snapshotError}</Alert>
      ) : scan && snapshot ? (
        scan.kind === 'bucket' ? (
          <BucketReplaceFlow
            snapshot={snapshot}
            repository={replacementRepo}
            onDone={reset}
          />
        ) : (
          <BunchMoveFlow
            scannedBunchId={scan.id}
            snapshot={snapshot}
            repository={replacementRepo}
            onDone={reset}
          />
        )
      ) : null}
    </Screen>
  );
}

// ─── Bucket replacement ──────────────────────────────────────────────────────

function BucketReplaceFlow({
  snapshot,
  repository,
  onDone,
}: {
  snapshot: TraceabilitySnapshot;
  repository: ReplacementRepository;
  onDone: () => void;
}) {
  const {
    bucketCandidates,
    bucketCandidatesLoading,
    bucketCandidatesError,
    bucketOpls,
    bucketOplsLoading,
    bucketOplsError,
    acting,
    loadBucketCandidates,
    loadBucketOpls,
    replaceBucket,
  } = useReplacementStore();
  const { showSuccess, showError } = useToast();
  const [selected, setSelected] = useState<ReplacementCandidate | null>(null);
  const [pickedOpl, setPickedOpl] = useState<BucketOplAllocation | null>(null);
  const [scope, setScope] = useState<'whole' | 'stems' | null>(null);
  const [stemCount, setStemCount] = useState('1');
  const [stemResult, setStemResult] = useState<{
    donorBucket: string;
    donorShelf: string;
    stems: number;
  } | null>(null);

  useEffect(() => {
    loadBucketOpls(repository, snapshot.bucketId);
    loadBucketCandidates(repository, snapshot.bucketId);
  }, [loadBucketCandidates, loadBucketOpls, repository, snapshot.bucketId]);

  // Auto-select when only one OPL exists.
  useEffect(() => {
    if (bucketOpls.length === 1 && !pickedOpl) {
      setPickedOpl(bucketOpls[0]);
    }
  }, [bucketOpls, pickedOpl]);

  // A bucket can only be replaced if it's currently allocated to at least one OPL.
  // We treat "no OPLs" as a hard block — nothing to swap.
  const notAllocated = !bucketOplsLoading && !bucketOplsError && bucketOpls.length === 0;

  const onConfirm = async () => {
    if (!selected || !pickedOpl) return;
    const outcome = await replaceBucket(
      repository,
      snapshot.bucketId,
      selected.bucketId,
      pickedOpl.pickListItem,
    );
    if (outcome.ok) {
      showSuccess(
        `Replaced with bucket ${outcome.newBucket.toUpperCase()} on order ${pickedOpl.orderName || pickedOpl.oplName}.`,
      );
      onDone();
    } else {
      showError(outcome.error || 'Could not replace bucket.');
    }
  };

  return (
    <>
      <Card>
        <Text style={s.label}>BUCKET</Text>
        <Text style={s.bigId}>{snapshot.bucketId.toUpperCase()}</Text>
        <Text style={s.subId}>
          {snapshot.variety} · {snapshot.stemLength} · {snapshot.farm} · {snapshot.status}
        </Text>
        <AllocationPills allocation={snapshot.allocation} />
      </Card>

      {notAllocated && (
        <Alert tone="danger">
          Bucket {snapshot.bucketId.toUpperCase()} isn't allocated to any OPL — nothing to replace.
          Use Edit Details to correct its variety/length instead.
        </Alert>
      )}

      <Card title="Pick the order to replace from">
        <Text style={s.helper}>
          A bucket can be allocated to multiple orders. Only the chosen order line is swapped.
        </Text>

        {bucketOplsLoading ? (
          <Text style={[s.muted, { marginTop: 12 }]}>Loading allocations…</Text>
        ) : bucketOplsError ? (
          <Alert tone="danger">{bucketOplsError}</Alert>
        ) : bucketOpls.length === 0 ? (
          <Text style={[s.muted, { marginTop: 8 }]}>(no allocations)</Text>
        ) : (
          <View style={{ marginTop: 8 }}>
            {bucketOpls.map((opl) => (
              <OplRow
                key={opl.pickListItem}
                opl={opl}
                selected={pickedOpl?.pickListItem === opl.pickListItem}
                onPress={() => setPickedOpl(opl)}
              />
            ))}
          </View>
        )}
      </Card>

      {pickedOpl && !stemResult && (
        <Card title="How much to replace?">
          <View style={s.scopeRow}>
            <Pressable
              onPress={() => setScope('whole')}
              style={[s.scopeButton, scope === 'whole' && s.scopeButtonActive]}
            >
              <MaterialCommunityIcons
                name="bucket-outline"
                size={20}
                color={scope === 'whole' ? COLORS.info : COLORS.text}
              />
              <Text style={[s.scopeLabel, scope === 'whole' && s.scopeLabelActive]}>
                Whole bucket
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setScope('stems')}
              style={[s.scopeButton, scope === 'stems' && s.scopeButtonActive]}
            >
              <MaterialCommunityIcons
                name="flower-tulip-outline"
                size={20}
                color={scope === 'stems' ? COLORS.info : COLORS.text}
              />
              <Text style={[s.scopeLabel, scope === 'stems' && s.scopeLabelActive]}>
                Just some stems
              </Text>
            </Pressable>
          </View>
        </Card>
      )}

      {pickedOpl && scope === 'whole' && !stemResult && (
        <>
          <Card title="Pick a replacement bucket">
            <Text style={s.helper}>
              Shelved buckets matching {snapshot.variety} · {snapshot.stemLength} · {snapshot.farm}.
            </Text>

            {bucketCandidatesLoading ? (
              <Text style={[s.muted, { marginTop: 12 }]}>Searching for replacements…</Text>
            ) : bucketCandidatesError ? (
              <Alert tone="danger">{bucketCandidatesError}</Alert>
            ) : bucketCandidates && bucketCandidates.candidates.length === 0 ? (
              <Alert tone="warn">
                No shelved buckets match these criteria. Try the Pending Reshelving page if the
                bucket details are wrong.
              </Alert>
            ) : bucketCandidates ? (
              <View style={{ marginTop: 8 }}>
                {bucketCandidates.candidates.map((c) => (
                  <CandidateRow
                    key={c.bucketId}
                    candidate={c}
                    selected={selected?.bucketId === c.bucketId}
                    onPress={() => setSelected(c)}
                  />
                ))}
              </View>
            ) : null}
          </Card>

          <Card>
            <Button
              label={acting ? 'Replacing…' : 'Confirm replacement'}
              onPress={onConfirm}
              loading={acting}
              disabled={!selected}
              color={COLORS.danger}
            />
          </Card>
        </>
      )}

      {pickedOpl && scope === 'stems' && !stemResult && (
        <StemReplaceFlow
          snapshot={snapshot}
          pickedOpl={pickedOpl}
          repository={repository}
          stemCount={stemCount}
          setStemCount={setStemCount}
          onDone={(result) => setStemResult(result)}
        />
      )}

      {stemResult && (
        <Card title="Done — go to the shelf">
          <Text style={s.helper}>
            Take{' '}
            <Text style={s.strong}>
              {stemResult.stems} stem{stemResult.stems === 1 ? '' : 's'}
            </Text>{' '}
            from bucket <Text style={s.strong}>{stemResult.donorBucket.toUpperCase()}</Text> on
            shelf <Text style={s.strong}>{stemResult.donorShelf}</Text> and add to the order box.
          </Text>
          <View style={{ height: 16 }} />
          <Button label="Done" onPress={onDone} />
        </Card>
      )}
    </>
  );
}

function StemReplaceFlow({
  snapshot,
  pickedOpl,
  repository,
  stemCount,
  setStemCount,
  onDone,
}: {
  snapshot: TraceabilitySnapshot;
  pickedOpl: BucketOplAllocation;
  repository: ReplacementRepository;
  stemCount: string;
  setStemCount: (v: string) => void;
  onDone: (result: { donorBucket: string; donorShelf: string; stems: number }) => void;
}) {
  const {
    bucketCandidates,
    bucketCandidatesLoading,
    bucketCandidatesError,
    acting,
    replaceStems,
  } = useReplacementStore();
  const { showError } = useToast();
  const [donor, setDonor] = useState<ReplacementCandidate | null>(null);

  const stems = Math.max(0, Math.floor(Number(stemCount) || 0));

  const onConfirm = async () => {
    if (!donor || stems <= 0) return;
    if (donor.availableQty < stems) {
      showError(
        `Donor only has ${Math.floor(donor.availableQty)} of ${donor.stemQty ?? 0} stems available (rest already allocated).`,
      );
      return;
    }
    const outcome = await replaceStems(repository, {
      pickListItem: pickedOpl.pickListItem,
      donorBucketId: donor.bucketId,
      stems,
    });
    if (outcome.ok) {
      onDone({
        donorBucket: outcome.donorBucket,
        donorShelf: outcome.donorShelf,
        stems: outcome.stems,
      });
    } else {
      showError(outcome.error || 'Could not record stem replacement.');
    }
  };

  return (
    <>
      <Card title="How many stems?">
        <Text style={s.helper}>
          For small quality defects, swap individual stems instead of the whole bucket.
        </Text>
        <View style={{ height: 12 }} />
        <LabeledInput
          label="Stems to replace"
          iconName="flower-tulip-outline"
          value={stemCount}
          onChangeText={setStemCount}
          keyboardType="number-pad"
          placeholder="1"
        />
      </Card>

      <Card title="Pick a donor bucket">
        <Text style={s.helper}>
          Shelved buckets matching {snapshot.variety} · {snapshot.stemLength} · {snapshot.farm}.
        </Text>

        {bucketCandidatesLoading ? (
          <Text style={[s.muted, { marginTop: 12 }]}>Searching…</Text>
        ) : bucketCandidatesError ? (
          <Alert tone="danger">{bucketCandidatesError}</Alert>
        ) : bucketCandidates && bucketCandidates.candidates.length === 0 ? (
          <Alert tone="warn">
            No shelved buckets match these criteria.
          </Alert>
        ) : bucketCandidates ? (
          <View style={{ marginTop: 8 }}>
            {bucketCandidates.candidates.map((c) => (
              <CandidateRow
                key={c.bucketId}
                candidate={c}
                selected={donor?.bucketId === c.bucketId}
                minStemsNeeded={stems}
                onPress={() => setDonor(c)}
              />
            ))}
          </View>
        ) : null}
      </Card>

      <Card>
        <Button
          label={acting ? 'Recording…' : `Replace ${stems} stem${stems === 1 ? '' : 's'}`}
          onPress={onConfirm}
          loading={acting}
          disabled={
            !donor ||
            stems <= 0 ||
            (donor != null && donor.availableQty < stems)
          }
        />
      </Card>
    </>
  );
}

// ─── Bunch move ──────────────────────────────────────────────────────────────

function BunchMoveFlow({
  scannedBunchId,
  snapshot,
  repository,
  onDone,
}: {
  scannedBunchId: string;
  snapshot: TraceabilitySnapshot;
  repository: ReplacementRepository;
  onDone: () => void;
}) {
  const bunch = snapshot.bunches.find((b) => b.bunchId === scannedBunchId);

  if (!bunch) {
    return (
      <Alert tone="danger">
        Bunch {scannedBunchId} not found in the current session of bucket {snapshot.bucketId}.
      </Alert>
    );
  }

  return (
    <BunchMoveEditor
      bunch={bunch}
      snapshot={snapshot}
      repository={repository}
      onDone={onDone}
    />
  );
}

function BunchMoveEditor({
  bunch,
  snapshot,
  repository,
  onDone,
}: {
  bunch: SessionBunch;
  snapshot: TraceabilitySnapshot;
  repository: ReplacementRepository;
  onDone: () => void;
}) {
  const {
    bunchDestinations,
    bunchDestinationsLoading,
    bunchDestinationsError,
    bucketOpls,
    acting,
    loadBunchDestinations,
    loadBucketOpls,
    moveBunch,
    replaceBunchInOpl,
  } = useReplacementStore();
  const { showSuccess, showError } = useToast();

  const [variety, setVariety] = useState(bunch.variety);
  const [stemLength, setStemLength] = useState(bunch.stemLength);
  const [varieties, setVarieties] = useState<string[]>([]);
  const [stemLengths, setStemLengths] = useState<string[]>([]);
  const [destination, setDestination] = useState<ReplacementCandidate | null>(null);

  // After a successful move, transition to a replacement-donor picker phase so
  // the now-short OPL gets a fresh bunch from the shelf.
  const [phase, setPhase] = useState<'edit' | 'replace'>('edit');
  const [moveSummary, setMoveSummary] = useState<{ destBucket: string; destShelf: string } | null>(
    null,
  );
  const [replacementDonor, setReplacementDonor] = useState<ReplacementCandidate | null>(null);

  // Load OPL allocations for the source bucket up-front so we can identify
  // the order that just lost a bunch and needs a replacement.
  useEffect(() => {
    loadBucketOpls(repository, snapshot.bucketId);
  }, [loadBucketOpls, repository, snapshot.bucketId]);

  // PLI picked manually when there's ambiguity (source bucket allocated to
  // multiple orders and we can't tell which one this bunch went to).
  const [pickedReplacePli, setPickedReplacePli] = useState<BucketOplAllocation | null>(null);

  // Resolve the PLI to replace into. Preference order:
  //   1. The OPL the bunch was flagged as issued to (`bunch.issuedOpl`)
  //   2. The only OPL the source bucket is allocated to (if just one)
  //   3. Whatever the user picked in the OPL picker (multi-OPL case)
  const targetPli: BucketOplAllocation | null = (() => {
    if (bunch.issuedOpl) {
      const m = bucketOpls.find((o) => o.oplName === bunch.issuedOpl);
      if (m) return m;
    }
    if (bucketOpls.length === 1) return bucketOpls[0];
    return pickedReplacePli;
  })();

  // Load picker options once
  useEffect(() => {
    let cancelled = false;
    const lv = repository.listVarieties?.() ?? Promise.resolve<string[]>([]);
    const ll = repository.listStemLengths?.() ?? Promise.resolve<string[]>([]);
    Promise.all([lv, ll])
      .then(([vs, ls]) => {
        if (cancelled) return;
        setVarieties(vs);
        setStemLengths(ls);
      })
      .catch(() => {
        // typeahead just won't suggest
      });
    return () => {
      cancelled = true;
    };
  }, [repository]);

  // Re-fetch destinations whenever corrected variety/length changes.
  // Debounce 250ms so partial typing doesn't fire a query on every keystroke.
  useEffect(() => {
    const v = variety.trim();
    const l = stemLength.trim();
    if (!v || !l) return;
    const handle = setTimeout(() => {
      loadBunchDestinations(repository, v, l, snapshot.farm, snapshot.bucketId);
      setDestination(null); // any prior selection is invalid for new criteria
    }, 250);
    return () => clearTimeout(handle);
  }, [variety, stemLength, snapshot.farm, snapshot.bucketId, loadBunchDestinations, repository]);

  const varietyValid =
    variety.trim() === '' ||
    varieties.length === 0 ||
    varieties.some((v) => v.toLowerCase() === variety.trim().toLowerCase());
  const lengthValid =
    stemLength.trim() === '' ||
    stemLengths.length === 0 ||
    stemLengths.some((l) => l.toLowerCase() === stemLength.trim().toLowerCase());

  const varietyChanged = variety.trim() !== bunch.variety.trim();
  const lengthChanged = stemLength.trim() !== bunch.stemLength.trim();
  const anyCorrection = varietyChanged || lengthChanged;

  const apply = async (mode: 'move' | 'pending') => {
    if (!varietyValid || !lengthValid) {
      showError('Pick variety and stem length from the lists.');
      return;
    }
    const payload = {
      bunchId: bunch.bunchId,
      sourceBucketId: snapshot.bucketId,
      variety: varietyChanged ? variety.trim() : undefined,
      stemLength: lengthChanged ? stemLength.trim() : undefined,
      destBucketId: mode === 'move' && destination ? destination.bucketId : undefined,
    };
    const outcome = await moveBunch(repository, payload);
    if (!outcome.ok) {
      showError(outcome.error || 'Could not apply changes.');
      return;
    }
    if (outcome.status === 'moved') {
      showSuccess(`Moved to bucket ${outcome.destBucket?.toUpperCase()}.`);
    } else {
      showSuccess('Bunch sent to pending reshelving.');
    }

    // If the source bucket was allocated to any OPL, the move leaves at least
    // one order short. Transition to the donor-picker phase. (If we can't
    // resolve a single PLI yet, the user picks the OPL in that phase.)
    if (outcome.status === 'moved' && bucketOpls.length > 0) {
      setMoveSummary({
        destBucket: outcome.destBucket ?? '',
        destShelf: outcome.destShelf ?? '',
      });
      setReplacementDonor(null);
      setPhase('replace');
      // Donor lookup runs in the replace phase's own effect once targetPli
      // is known — see the useEffect below.
    } else {
      onDone();
    }
  };

  // In the replace phase, refresh donor candidates whenever the target PLI
  // becomes known (or changes via the OPL picker for the multi-OPL case).
  useEffect(() => {
    if (phase !== 'replace') return;
    if (!targetPli) return;
    const orderVariety = (targetPli.itemCode || bunch.variety).trim();
    const orderLength = (targetPli.stemLength || bunch.stemLength).trim();
    if (!orderVariety || !orderLength) return;
    loadBunchDestinations(
      repository,
      orderVariety,
      orderLength,
      snapshot.farm,
      snapshot.bucketId,
    );
    setReplacementDonor(null);
  }, [
    phase,
    targetPli,
    bunch.variety,
    bunch.stemLength,
    snapshot.farm,
    snapshot.bucketId,
    loadBunchDestinations,
    repository,
  ]);

  const allocateReplacement = async () => {
    if (!replacementDonor || !targetPli) return;
    const outcome = await replaceBunchInOpl(repository, {
      pickListItem: targetPli.pickListItem,
      donorBucketId: replacementDonor.bucketId,
      reason: 'Replacement after bunch correction',
    });
    if (outcome.ok) {
      showSuccess(
        `Replacement ready on shelf ${outcome.donorShelf || '—'}. Take ${outcome.stems} stems from bucket ${replacementDonor.bucketId.toUpperCase()}.`,
      );
      onDone();
    } else {
      showError(outcome.error || 'Could not allocate replacement.');
    }
  };

  const skipReplacement = () => {
    showSuccess('Replacement skipped. The order is short — handle it manually.');
    onDone();
  };

  // ── Phase 2: replacement-donor picker ────────────────────────────────────
  if (phase === 'replace') {
    const orderVariety = (targetPli?.itemCode || bunch.variety).trim() || '—';
    const orderLength = (targetPli?.stemLength || bunch.stemLength).trim() || '—';
    const conv = Math.max(
      1,
      Math.floor(
        targetPli?.stemsFromThisBucket && targetPli?.bunchesFromThisBucket
          ? targetPli.stemsFromThisBucket / Math.max(1, targetPli.bunchesFromThisBucket)
          : 10,
      ),
    );
    const needsOplPick = !targetPli && bucketOpls.length > 1;
    return (
      <>
        <Card>
          <Text style={s.label}>BUNCH MOVED</Text>
          <Text style={s.bigId}>{bunch.bunchId.toUpperCase()}</Text>
          <Text style={s.subId}>
            now in bucket {moveSummary?.destBucket?.toUpperCase() || '—'}
            {moveSummary?.destShelf ? ` · shelf ${moveSummary.destShelf}` : ''}
          </Text>
        </Card>

        {needsOplPick ? (
          <Card title="Which order needs the replacement?">
            <Text style={s.helper}>
              Source bucket {snapshot.bucketId.toUpperCase()} was allocated to multiple orders.
              Pick the one this bunch came from.
            </Text>
            <View style={{ marginTop: 8 }}>
              {bucketOpls.map((opl) => (
                <OplRow
                  key={opl.pickListItem}
                  opl={opl}
                  selected={pickedReplacePli?.pickListItem === opl.pickListItem}
                  onPress={() => setPickedReplacePli(opl)}
                />
              ))}
            </View>
          </Card>
        ) : null}

        {targetPli ? (
          <Card title="Order is short — pick a replacement">
            <Text style={s.helper}>
              Order{' '}
              <Text style={s.strong}>
                {targetPli.orderName || targetPli.oplName || '—'}
              </Text>{' '}
              ({targetPli.customer || '—'}) needs{' '}
              <Text style={s.strong}>{conv} stems</Text> of{' '}
              <Text style={s.strong}>{orderVariety}</Text> ·{' '}
              <Text style={s.strong}>{orderLength}</Text>. Pick a donor from the shelf.
            </Text>

            {bunchDestinationsLoading ? (
              <Text style={[s.muted, { marginTop: 12 }]}>Searching donors…</Text>
            ) : bunchDestinationsError ? (
              <Alert tone="danger">{bunchDestinationsError}</Alert>
            ) : bunchDestinations && bunchDestinations.candidates.length === 0 ? (
              <Alert tone="warn">
                No shelved buckets match. The order will be short until a matching bucket appears
                — skip and handle manually.
              </Alert>
            ) : bunchDestinations ? (
              <View style={{ marginTop: 8 }}>
                {bunchDestinations.candidates.map((c) => (
                  <CandidateRow
                    key={c.bucketId}
                    candidate={c}
                    selected={replacementDonor?.bucketId === c.bucketId}
                    onPress={() => setReplacementDonor(c)}
                    minStemsNeeded={conv}
                  />
                ))}
              </View>
            ) : null}
          </Card>
        ) : !needsOplPick ? (
          <Alert tone="warn">
            Couldn't determine which order needs the replacement — handle it manually.
          </Alert>
        ) : null}

        <Card>
          <Button
            label={acting ? 'Allocating…' : 'Allocate replacement'}
            onPress={allocateReplacement}
            loading={acting}
            disabled={!replacementDonor || !targetPli}
          />
          <View style={{ height: 8 }} />
          <Button
            label="Skip — leave the order short"
            onPress={skipReplacement}
            variant="outline"
            color={COLORS.warn}
            disabled={acting}
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <Card>
        <Text style={s.label}>BUNCH</Text>
        <Text style={s.bigId}>{bunch.bunchId.toUpperCase()}</Text>
        <Text style={s.subId}>
          currently in bucket {snapshot.bucketId.toUpperCase()} · {snapshot.farm}
        </Text>
        <AllocationPills allocation={snapshot.allocation} />
      </Card>

      <Card title="Correct details">
        <Text style={s.helper}>
          Update what the bunch actually is. Pick variety and length from the lists.
        </Text>
        <View style={{ height: 12 }} />
        <Typeahead
          label="Variety"
          iconName="flower"
          value={variety}
          onChange={setVariety}
          options={varieties}
          invalid={!varietyValid}
          placeholder="Type to search varieties"
          autoCapitalize="words"
          maxSuggestions={8}
        />
        <View style={{ height: 12 }} />
        <Typeahead
          label="Stem length"
          iconName="ruler"
          value={stemLength}
          onChange={setStemLength}
          options={stemLengths}
          invalid={!lengthValid}
          placeholder="e.g. 62cm"
          autoCapitalize="none"
          maxSuggestions={10}
        />
        {anyCorrection ? (
          <Text style={[s.muted, { marginTop: 10 }]}>
            After correction, this bunch needs to go into a bucket of{' '}
            <Text style={s.strong}>{variety.trim() || bunch.variety}</Text> ·{' '}
            <Text style={s.strong}>{stemLength.trim() || bunch.stemLength}</Text>.
          </Text>
        ) : null}
      </Card>

      <Card title="Pick a destination bucket">
        <Text style={s.helper}>
          Showing shelved buckets that match the current values:{' '}
          <Text style={s.strong}>{(variety || bunch.variety).trim() || '—'}</Text> ·{' '}
          <Text style={s.strong}>{(stemLength || bunch.stemLength).trim() || '—'}</Text> ·{' '}
          <Text style={s.strong}>{snapshot.farm}</Text>
        </Text>

        {bunchDestinationsLoading ? (
          <Text style={[s.muted, { marginTop: 12 }]}>Searching…</Text>
        ) : bunchDestinationsError ? (
          <Alert tone="danger">{bunchDestinationsError}</Alert>
        ) : bunchDestinations && bunchDestinations.candidates.length === 0 ? (
          <Alert tone="warn">
            No shelved buckets match. The bunch can be flagged for pending reshelving — it'll
            wait on the packhouse floor until a matching bucket appears.
          </Alert>
        ) : bunchDestinations ? (
          <View style={{ marginTop: 8 }}>
            {bunchDestinations.candidates.map((c) => (
              <CandidateRow
                key={c.bucketId}
                candidate={c}
                selected={destination?.bucketId === c.bucketId}
                onPress={() => setDestination(c)}
              />
            ))}
          </View>
        ) : null}
      </Card>

      <Card>
        <Button
          label={acting ? 'Moving…' : 'Apply correction & move bunch'}
          onPress={() => apply('move')}
          loading={acting}
          disabled={!destination}
        />
        <View style={{ height: 8 }} />
        <Button
          label="Flag for pending reshelving"
          onPress={() => apply('pending')}
          variant="outline"
          color={COLORS.warn}
          disabled={acting}
        />
      </Card>
    </>
  );
}

// ─── Reusable bits ───────────────────────────────────────────────────────────

function OplRow({
  opl,
  selected,
  onPress,
}: {
  opl: BucketOplAllocation;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[s.candidateRow, selected && s.candidateRowSelected]}>
      <View style={s.candidateHeader}>
        <Text style={s.candidateId} numberOfLines={1}>
          {opl.orderName || opl.oplName || '—'}
        </Text>
        <MaterialCommunityIcons
          name={selected ? 'check-circle' : 'checkbox-blank-circle-outline'}
          size={20}
          color={selected ? COLORS.info : COLORS.textMuted}
        />
      </View>
      <Text style={[s.candidateFooter, { marginTop: 2 }]} numberOfLines={1}>
        {opl.customer || '—'}
        {opl.team ? `  ·  ${opl.team}` : ''}
        {opl.dateCreated ? `  ·  ${opl.dateCreated}` : ''}
      </Text>
      <View style={s.candidateMeta}>
        <Pill label="Item" value={opl.itemCode || '—'} />
        <Pill label="Length" value={opl.stemLength || '—'} />
        <Pill
          label={opl.issued ? 'Issued' : 'Pending'}
          value={`${opl.stemsFromThisBucket} stems`}
          warn={opl.issued}
        />
      </View>
    </Pressable>
  );
}

function CandidateRow({
  candidate,
  selected,
  minStemsNeeded = 1,
  onPress,
}: {
  candidate: ReplacementCandidate;
  selected: boolean;
  /** Min stems required (1 for whole-bucket; configurable for stem-replace). */
  minStemsNeeded?: number;
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
  const insufficient = candidate.availableQty < minStemsNeeded;

  return (
    <Pressable
      onPress={insufficient ? undefined : onPress}
      style={[
        s.candidateRow,
        selected && s.candidateRowSelected,
        insufficient && s.candidateRowDisabled,
      ]}
    >
      <View style={s.candidateHeader}>
        <Text style={s.candidateId}>{candidate.bucketId.toUpperCase()}</Text>
        <MaterialCommunityIcons
          name={
            insufficient
              ? 'lock-outline'
              : selected
                ? 'check-circle'
                : 'checkbox-blank-circle-outline'
          }
          size={20}
          color={
            insufficient
              ? COLORS.textMuted
              : selected
                ? COLORS.info
                : COLORS.textMuted
          }
        />
      </View>
      <View style={s.candidateMeta}>
        <Pill label="Shelf" value={candidate.shelf} />
        {candidate.variety ? <Pill label="Variety" value={candidate.variety} /> : null}
        {candidate.stemLength ? <Pill label="Length" value={candidate.stemLength} /> : null}
        <Pill label="Age" value={ageLabel} warn={ageWarn} />
      </View>
      <View style={[s.candidateMeta, { marginTop: 6 }]}>
        {candidate.stemQty != null ? (
          <Pill label="Total" value={`${Math.floor(candidate.stemQty)} stems`} />
        ) : null}
        <Pill label="Allocated" value={String(Math.floor(candidate.allocatedQty))} />
        <Pill
          label="Available"
          value={`${Math.floor(candidate.availableQty)} stems`}
          warn={insufficient}
        />
      </View>
      <Text style={s.candidateFooter}>
        {candidate.greenhouse ? `${candidate.greenhouse}  ·  ` : ''}
        added {formatDate(candidate.dateAdded)}
      </Text>
      {insufficient ? (
        <Text style={s.insufficientText}>
          Fully allocated — no stems available.
        </Text>
      ) : null}
    </Pressable>
  );
}

function AllocationPills({ allocation }: { allocation: BucketAllocationSnapshot | null }) {
  if (!allocation || !allocation.exists) return null;
  const total = Math.floor(allocation.totalQuantity);
  const allocated = Math.floor(allocation.allocatedQuantity);
  const available = Math.floor(allocation.availableQuantity);
  const statusLabel = allocation.fullyAllocated
    ? 'Fully allocated'
    : allocation.isAllocated
      ? 'Partially allocated'
      : 'Unallocated';
  const statusWarn = allocation.fullyAllocated;
  const availableWarn = available === 0;
  return (
    <View style={{ marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      <Pill label="Status" value={statusLabel} warn={statusWarn} />
      <Pill label="Variety" value={allocation.variety || '—'} />
      <Pill label="Total" value={`${total} stems`} />
      <Pill label="Allocated" value={String(allocated)} />
      <Pill label="Available" value={`${available} stems`} warn={availableWarn} />
    </View>
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

function Typeahead({
  label,
  iconName,
  value,
  onChange,
  options,
  placeholder,
  autoCapitalize,
  invalid,
  maxSuggestions = 8,
}: {
  label: string;
  iconName: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  autoCapitalize?: 'none' | 'words' | 'sentences' | 'characters';
  invalid?: boolean;
  maxSuggestions?: number;
}) {
  const [focused, setFocused] = useState(false);
  const q = value.trim().toLowerCase();
  const suggestions = q
    ? options.filter((o) => o.toLowerCase().includes(q)).slice(0, maxSuggestions)
    : options.slice(0, maxSuggestions);

  return (
    <View>
      <LabeledInput
        label={label}
        iconName={iconName}
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        placeholder={placeholder}
        style={invalid ? s.invalidInput : undefined}
      />
      {focused && suggestions.length > 0 ? (
        <View style={s.suggestions}>
          {suggestions.map((opt) => (
            <Pressable
              key={opt}
              onPress={() => {
                onChange(opt);
                setFocused(false);
              }}
              style={s.suggestion}
            >
              <Text style={s.suggestionText}>{opt}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {invalid && !focused ? (
        <Text style={s.invalidText}>Pick a value from the list.</Text>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  helper: { fontSize: 13, color: COLORS.textMuted },
  muted: { fontSize: 13, color: COLORS.textMuted },
  strong: { color: COLORS.text, fontWeight: '600' },

  label: { fontSize: 11, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  bigId: { fontSize: 20, fontWeight: '700', color: COLORS.text, marginTop: 2, letterSpacing: 1 },
  subId: { fontSize: 12, color: COLORS.textMuted, marginTop: 4 },

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
  candidateRowDisabled: {
    opacity: 0.55,
    backgroundColor: '#f4f5f6',
  },
  insufficientText: {
    marginTop: 6,
    fontSize: 11,
    color: '#9a1f33',
    fontWeight: '600',
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

  suggestions: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    backgroundColor: COLORS.bg,
    maxHeight: 220,
    overflow: 'hidden',
  },
  suggestion: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  suggestionText: { fontSize: 14, color: COLORS.text },
  invalidInput: { borderColor: '#9a1f33' },
  invalidText: { marginTop: 4, fontSize: 11, color: '#9a1f33' },

  scopeRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  scopeButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    gap: 6,
  },
  scopeButtonActive: {
    borderColor: COLORS.info,
    borderWidth: 2,
    backgroundColor: '#f0f7ff',
  },
  scopeLabel: { fontSize: 13, color: COLORS.text },
  scopeLabelActive: { color: COLORS.info, fontWeight: '600' },
});
