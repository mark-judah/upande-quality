import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Screen } from '@/src/core/ui/Screen';
import { Card, Alert } from '@/src/core/ui/Card';
import { Button } from '@/src/core/ui/Button';
import { LabeledInput } from '@/src/core/ui/LabeledInput';
import { ScanField, type ScanFieldHandle } from '@/src/core/scanning/ScanField';
import { useToast } from '@/src/core/ui/Toast';
import { useAuthStore } from '@/src/core/auth/store';
import { useReplacementStore } from '@/src/core/features/replacement/store';
import type { ReplacementRepository } from '@/src/core/features/replacement/types';
import type {
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

type ScanResult = { kind: 'bucket'; id: string } | { kind: 'bunch'; id: string };

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

export function EditDetailsScreen({ replacementRepo, traceabilityRepo }: Props) {
  const scanRef = useRef<ScanFieldHandle>(null);
  const hasRole = useAuthStore((s) => s.hasRole(HARVEST_DETAILS_UPDATER));
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [snapshot, setSnapshot] = useState<TraceabilitySnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const onScan = async (raw: string) => {
    const result = parseScan(raw);
    setScan(result);
    setSnapshot(null);
    setLoadError(null);
    setLoading(true);
    try {
      const snap = await traceabilityRepo.lookup({ kind: result.kind, id: result.id });
      setSnapshot(snap);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setScan(null);
    setSnapshot(null);
    setLoadError(null);
  };

  if (!hasRole) {
    return (
      <Screen title="Edit Details">
        <Card>
          <Text style={s.muted}>
            You need the <Text style={s.strong}>Harvest Details Updater</Text> role to use this page.
          </Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen title="Edit Details">
      <Card title="Scan a bucket or bunch">
        <Text style={s.helper}>
          Correct the variety or stem length that was entered wrong at harvesting or grading.
        </Text>
        <View style={{ height: 12 }} />
        <ScanField ref={scanRef} onScan={onScan} autoFocus placeholder="Bucket / Bunch ID" />
      </Card>

      {loading ? (
        <Card>
          <Text style={s.muted}>
            Loading {scan?.kind ?? ''} {scan?.id ?? ''}…
          </Text>
        </Card>
      ) : loadError ? (
        <Alert tone="danger">{loadError}</Alert>
      ) : scan && snapshot ? (
        scan.kind === 'bucket' ? (
          <BucketEditor snapshot={snapshot} repository={replacementRepo} onDone={reset} />
        ) : (
          <BunchEditor
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

// ─── Bucket-level editor ─────────────────────────────────────────────────────

function BucketEditor({
  snapshot,
  repository,
  onDone,
}: {
  snapshot: TraceabilitySnapshot;
  repository: ReplacementRepository;
  onDone: () => void;
}) {
  // For sprays, the bucket contains many bunches — each may need different corrections.
  // Show the bunch list and let the user pick one.
  if (snapshot.roseType === 'Spray Roses' && snapshot.bunches.length > 0) {
    return (
      <SprayBunchListEditor snapshot={snapshot} repository={repository} onDone={onDone} />
    );
  }

  // Standards: one bucket = one variety/length. Edit at the bucket level.
  return (
    <EditPanel
      title="Bucket details"
      currentId={snapshot.bucketId}
      currentVariety={snapshot.variety}
      currentStemLength={snapshot.stemLength}
      subtitle={`${snapshot.variety} · ${snapshot.stemLength} · ${snapshot.farm} · ${snapshot.status}`}
      onSubmit={async (variety, stemLength) =>
        repository.correctDetails({
          kind: 'bucket',
          id: snapshot.bucketId,
          variety,
          stemLength,
        })
      }
      repository={repository}
      onDone={onDone}
    />
  );
}

// ─── Sprays: list bunches and let the user pick one ──────────────────────────

function SprayBunchListEditor({
  snapshot,
  repository,
  onDone,
}: {
  snapshot: TraceabilitySnapshot;
  repository: ReplacementRepository;
  onDone: () => void;
}) {
  const [openBunchId, setOpenBunchId] = useState<string | null>(null);
  const [wholeBucketOpen, setWholeBucketOpen] = useState(false);
  const sessionVariety = snapshot.variety.trim().toLowerCase();
  const sessionLength = snapshot.stemLength.trim().toLowerCase();

  return (
    <>
      <Card>
        <Text style={s.label}>BUCKET</Text>
        <Text style={s.bigId}>{snapshot.bucketId.toUpperCase()}</Text>
        <Text style={s.subId}>
          {snapshot.variety} · {snapshot.stemLength} · {snapshot.farm} · {snapshot.bunches.length}{' '}
          bunch{snapshot.bunches.length === 1 ? '' : 'es'}
        </Text>
      </Card>

      <Card title="Edit the whole bucket">
        <Text style={s.helper}>
          Use this when every bunch in the bucket has the same wrong variety or length — e.g. the
          whole bucket was harvested or graded incorrectly. Applies the same correction to all{' '}
          {snapshot.bunches.length} bunches in one go.
        </Text>
        <View style={{ height: 8 }} />
        {!wholeBucketOpen ? (
          <Button
            label={`Correct all ${snapshot.bunches.length} bunches`}
            onPress={() => {
              setWholeBucketOpen(true);
              setOpenBunchId(null);
            }}
            variant="outline"
          />
        ) : (
          <>
            <Alert tone="warn">
              This correction will be applied to <Text style={s.strong}>every bunch</Text> in this
              bucket (Bunch QR Codes, Grading SEs, Harvest SEs, Receiving SE, Shelf Item). Use the
              per-bunch list below if only some bunches are wrong.
            </Alert>
            <View style={{ height: 10 }} />
            <EditPanel
              title=""
              embedded
              currentId={snapshot.bucketId}
              currentVariety={snapshot.variety}
              currentStemLength={snapshot.stemLength}
              subtitle=""
              onSubmit={(variety, stemLength) =>
                repository.correctDetails({
                  kind: 'bucket',
                  id: snapshot.bucketId,
                  variety,
                  stemLength,
                })
              }
              repository={repository}
              onDone={onDone}
            />
            <View style={{ height: 8 }} />
            <Button
              label="Cancel"
              onPress={() => setWholeBucketOpen(false)}
              variant="outline"
              color={COLORS.textMuted}
            />
          </>
        )}
      </Card>

      <Card title="Bunches in this bucket">
        <Text style={s.helper}>
          Tap a bunch to correct its variety or stem length. Mismatches against the bucket session
          are highlighted.
        </Text>
        <View style={{ height: 8 }} />
        {snapshot.bunches.map((bunch) => {
          const isOpen = openBunchId === bunch.bunchId;
          const varietyMismatch =
            bunch.variety.trim() !== '' &&
            sessionVariety !== '' &&
            bunch.variety.trim().toLowerCase() !== sessionVariety;
          const lengthMismatch =
            bunch.stemLength.trim() !== '' &&
            sessionLength !== '' &&
            bunch.stemLength.trim().toLowerCase() !== sessionLength;

          return (
            <View key={bunch.bunchId} style={s.bunchRow}>
              <Pressable onPress={() => setOpenBunchId(isOpen ? null : bunch.bunchId)}>
                <View style={s.bunchHeader}>
                  <Text style={s.bunchId}>{bunch.bunchId}</Text>
                  <MaterialCommunityIcons
                    name={isOpen ? 'chevron-up' : 'chevron-down'}
                    size={22}
                    color={COLORS.textMuted}
                  />
                </View>
                <View style={s.pillRow}>
                  <Pill
                    label="Variety"
                    value={bunch.variety || '—'}
                    warn={varietyMismatch}
                  />
                  <Pill
                    label="Length"
                    value={bunch.stemLength || '—'}
                    warn={lengthMismatch}
                  />
                  {bunch.bunchSize ? (
                    <Pill label="Size" value={bunch.bunchSize} />
                  ) : null}
                </View>
              </Pressable>

              {isOpen && (
                <View style={{ marginTop: 12 }}>
                  <EditPanel
                    title=""
                    embedded
                    currentId={bunch.bunchId}
                    currentVariety={bunch.variety}
                    currentStemLength={bunch.stemLength}
                    subtitle=""
                    onSubmit={(variety, stemLength) =>
                      repository.correctDetails({
                        kind: 'bunch',
                        id: bunch.bunchId,
                        bucketId: snapshot.bucketId,
                        variety,
                        stemLength,
                      })
                    }
                    repository={repository}
                    onDone={onDone}
                  />
                </View>
              )}
            </View>
          );
        })}
      </Card>
    </>
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

// ─── Bunch-level editor ──────────────────────────────────────────────────────

function BunchEditor({
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
  const bunch: SessionBunch | undefined = snapshot.bunches.find(
    (b) => b.bunchId === scannedBunchId,
  );
  if (!bunch) {
    return (
      <Alert tone="danger">
        Bunch {scannedBunchId} not found in the current session of bucket {snapshot.bucketId}.
      </Alert>
    );
  }
  return (
    <EditPanel
      title="Bunch details"
      currentId={bunch.bunchId}
      currentVariety={bunch.variety}
      currentStemLength={bunch.stemLength}
      subtitle={`In bucket ${snapshot.bucketId.toUpperCase()} · ${snapshot.farm}`}
      onSubmit={async (variety, stemLength) =>
        repository.correctDetails({
          kind: 'bunch',
          id: bunch.bunchId,
          bucketId: snapshot.bucketId,
          variety,
          stemLength,
        })
      }
      repository={repository}
      onDone={onDone}
    />
  );
}

// ─── Shared editor panel ─────────────────────────────────────────────────────

function EditPanel({
  title,
  currentId,
  currentVariety,
  currentStemLength,
  subtitle,
  onSubmit,
  repository,
  onDone,
  embedded,
}: {
  title: string;
  currentId: string;
  currentVariety: string;
  currentStemLength: string;
  subtitle: string;
  onSubmit: (
    variety?: string,
    stemLength?: string,
  ) => Promise<{ ok: true; message: string } | { ok: false; error: string }>;
  repository: ReplacementRepository;
  onDone: () => void;
  /** When true, skip the outer header card + standalone wrapping cards. */
  embedded?: boolean;
}) {
  const { showSuccess, showError } = useToast();
  const acting = useReplacementStore((st) => st.acting);
  const [variety, setVariety] = useState(currentVariety || '');
  const [stemLength, setStemLength] = useState(currentStemLength || '');
  const [varieties, setVarieties] = useState<string[]>([]);
  const [stemLengths, setStemLengths] = useState<string[]>([]);

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
        // ignore — typeahead won't suggest
      });
    return () => {
      cancelled = true;
    };
  }, [repository]);

  const varietyValid =
    variety.trim() === '' ||
    varieties.length === 0 ||
    varieties.some((v) => v.toLowerCase() === variety.trim().toLowerCase());
  const lengthValid =
    stemLength.trim() === '' ||
    stemLengths.length === 0 ||
    stemLengths.some((l) => l.toLowerCase() === stemLength.trim().toLowerCase());

  const varietyChanged = variety.trim() !== (currentVariety || '').trim();
  const lengthChanged = stemLength.trim() !== (currentStemLength || '').trim();
  const dirty = varietyChanged || lengthChanged;

  const onApply = async () => {
    if (!varietyValid) {
      showError('Pick a variety from the list.');
      return;
    }
    if (!lengthValid) {
      showError('Pick a stem length from the list.');
      return;
    }
    const outcome = await onSubmit(
      varietyChanged ? variety.trim() : undefined,
      lengthChanged ? stemLength.trim() : undefined,
    );
    if (outcome.ok) {
      showSuccess(outcome.message || 'Details updated.');
      onDone();
    } else {
      showError(outcome.error || 'Could not apply changes.');
    }
  };

  const form = (
    <>
      <Typeahead
        label="Variety"
        iconName="flower"
        value={variety}
        onChange={setVariety}
        options={varieties}
        invalid={!varietyValid}
        placeholder="Type to search varieties"
        autoCapitalize="words"
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
      />
      <View style={{ height: 12 }} />
      <Button
        label={acting ? 'Saving…' : 'Apply correction'}
        onPress={onApply}
        loading={acting}
        disabled={!dirty}
      />
    </>
  );

  if (embedded) {
    return form;
  }

  return (
    <>
      <Card>
        <Text style={s.label}>{title.toUpperCase()}</Text>
        <Text style={s.bigId}>{currentId.toUpperCase()}</Text>
        <Text style={s.subId}>{subtitle}</Text>
      </Card>

      <Card title="Correct values">
        <Text style={s.helper}>Pick from the list.</Text>
        <View style={{ height: 12 }} />
        {form}
      </Card>
    </>
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
}: {
  label: string;
  iconName: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  autoCapitalize?: 'none' | 'words' | 'sentences' | 'characters';
  invalid?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const q = value.trim().toLowerCase();
  const suggestions = (
    q ? options.filter((o) => o.toLowerCase().includes(q)) : options
  ).slice(0, 10);

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

  bunchRow: {
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  bunchHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  bunchId: { fontSize: 13, fontWeight: '700', color: COLORS.text },
  pillRow: { marginTop: 6, flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
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
});
