import { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Card } from '@/src/core/ui/Card';
import { Button } from '@/src/core/ui/Button';
import { DecisionChip } from '@/src/core/ui/DecisionChip';
import { Dropdown } from '@/src/core/ui/Dropdown';
import { LabeledInput } from '@/src/core/ui/LabeledInput';
import { ProgressBar } from '@/src/core/ui/ProgressBar';
import { useToast } from '@/src/core/ui/Toast';
import { COLORS } from '@/src/core/theme';
import {
  snakeCaseParam,
  uniqueVarieties,
  useKarenQcStore,
  type Concern,
} from '@/src/tenants/karen/state/karen-qc-store';
import type { QualityBucket } from '@/src/tenants/karen/repository/karen-qc-repository';

export function InspectionMode() {
  const batch = useKarenQcStore((s) => s.batch);
  const parameters = useKarenQcStore((s) => s.parameters);
  const concerns = useKarenQcStore((s) => s.concerns);
  const stemsCheckedByVariety = useKarenQcStore((s) => s.stemsCheckedByVariety);
  const selectedVariety = useKarenQcStore((s) => s.selectedVariety);
  const solutionLevel = useKarenQcStore((s) => s.solutionLevel);
  const solutionHygiene = useKarenQcStore((s) => s.solutionHygiene);
  const solutionPh = useKarenQcStore((s) => s.solutionPh);
  const chlorinePpm = useKarenQcStore((s) => s.chlorinePpm);
  const batchAction = useKarenQcStore((s) => s.batchAction);
  const quarantineScope = useKarenQcStore((s) => s.quarantineScope);
  const selectedBucketsForQuarantine = useKarenQcStore((s) => s.selectedBucketsForQuarantine);
  const submitting = useKarenQcStore((s) => s.submitting);

  const setStemsCheckedForVariety = useKarenQcStore((s) => s.setStemsCheckedForVariety);
  const setSelectedVariety = useKarenQcStore((s) => s.setSelectedVariety);
  const setSolutionLevel = useKarenQcStore((s) => s.setSolutionLevel);
  const setSolutionHygiene = useKarenQcStore((s) => s.setSolutionHygiene);
  const setSolutionPh = useKarenQcStore((s) => s.setSolutionPh);
  const setChlorinePpm = useKarenQcStore((s) => s.setChlorinePpm);
  const addConcern = useKarenQcStore((s) => s.addConcern);
  const removeConcern = useKarenQcStore((s) => s.removeConcern);
  const updateConcern = useKarenQcStore((s) => s.updateConcern);
  const setBatchAction = useKarenQcStore((s) => s.setBatchAction);
  const setQuarantineScope = useKarenQcStore((s) => s.setQuarantineScope);
  const toggleBucketForQuarantine = useKarenQcStore((s) => s.toggleBucketForQuarantine);
  const submitInspection = useKarenQcStore((s) => s.submitInspection);
  const resetBatch = useKarenQcStore((s) => s.resetBatch);

  const { showSuccess, showError } = useToast();

  const [addConcernOpen, setAddConcernOpen] = useState(false);

  const varietyOptions = useMemo(
    () => (batch ? uniqueVarieties(batch.buckets) : []),
    [batch],
  );
  const stemsPerVariety = useMemo(() => {
    const map: Record<string, number> = {};
    if (!batch) return map;
    for (const b of batch.buckets) {
      map[b.itemCode] = (map[b.itemCode] ?? 0) + b.stems;
    }
    return map;
  }, [batch]);

  if (!batch) return null;

  const onSubmit = async () => {
    const outcome = await submitInspection();
    if (outcome.kind === 'ok') {
      showSuccess(outcome.message);
      resetBatch();
    } else {
      showError(outcome.message);
    }
  };

  const activeVariety = selectedVariety ?? varietyOptions[0] ?? null;
  const activeVarietyStems = Number.parseInt(
    activeVariety ? (stemsCheckedByVariety[activeVariety] ?? '') : '',
    10,
  ) || 0;
  const varietyConcerns = concerns.filter((c) => c.variety === activeVariety);
  const usedKeysForVariety = new Set(varietyConcerns.map((c) => c.paramKey));
  const availableParams = parameters.filter(
    (p) => !usedKeysForVariety.has(snakeCaseParam(p.parameter)),
  );

  /** Any concern in any variety exceeded → blocks Accept globally. */
  const exceeded = concerns.some((c) => {
    if (!c.variety) return false;
    const param = parameters.find((p) => snakeCaseParam(p.parameter) === c.paramKey);
    if (!param) return false;
    const stems = Number.parseInt(stemsCheckedByVariety[c.variety] ?? '', 10) || 0;
    const tol = Number(param.toleranceThresholds);
    if (tol === 0 && c.count > 0) return true;
    if (stems === 0) return false;
    return (c.count / stems) * 100 > tol;
  });

  return (
    <>
      {/* VARIETY (top of the screen) ──────────────── */}
      <Card>
        <Text style={s.section}>VARIETY</Text>
        <Text style={s.hint}>
          Pick the variety you&apos;re inspecting. Stems sampled and concerns
          below apply to this variety only.
        </Text>
        <View style={{ height: 12 }} />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.pillRow}
        >
          {varietyOptions.map((v) => {
            const sampled =
              Number.parseInt(stemsCheckedByVariety[v] ?? '', 10) || 0;
            const variantConcerns = concerns.filter((c) => c.variety === v).length;
            const isActive = v === activeVariety;
            return (
              <Pressable
                key={v}
                onPress={() => setSelectedVariety(v)}
                style={[s.varietyPill, isActive && s.varietyPillActive]}
              >
                <Text
                  style={[s.varietyPillLabel, isActive && s.varietyPillLabelActive]}
                  numberOfLines={1}
                >
                  {v}
                </Text>
                <Text
                  style={[s.varietyPillMeta, isActive && s.varietyPillMetaActive]}
                >
                  {sampled > 0 ? `${sampled} sampled` : `${stemsPerVariety[v] ?? 0} stems`}
                  {variantConcerns > 0 ? ` · ${variantConcerns} concern${variantConcerns === 1 ? '' : 's'}` : ''}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {!activeVariety ? (
          <>
            <View style={{ height: 8 }} />
            <Text style={s.empty}>No varieties in this batch.</Text>
          </>
        ) : null}
      </Card>

      {/* SOLUTION ─────────────────────────────────── */}
      <Card>
        <Text style={s.section}>SOLUTION</Text>
        <View style={{ height: 12 }} />
        <LabeledInput
          label="Solution Quantity (L)"
          iconName="water-outline"
          value={solutionLevel}
          onChangeText={setSolutionLevel}
          keyboardType="number-pad"
          placeholder="0"
        />
        <View style={{ height: 12 }} />
        <Dropdown
          label="Solution Hygiene"
          iconName="hand-wash-outline"
          value={solutionHygiene}
          placeholder="Select hygiene"
          options={[
            { label: 'Clean', value: 'Clean' },
            { label: 'Not Clean', value: 'Not Clean' },
          ]}
          onChange={(v) => setSolutionHygiene(v)}
        />
        <View style={{ height: 16 }} />
        <Text style={s.sliderLabel}>Chlorine: {Math.round(chlorinePpm)} ppm</Text>
        <Slider
          minimumValue={0}
          maximumValue={200}
          step={10}
          value={chlorinePpm}
          onValueChange={setChlorinePpm}
          minimumTrackTintColor={COLORS.text}
          maximumTrackTintColor={COLORS.border}
          thumbTintColor={COLORS.text}
        />
        <View style={{ height: 8 }} />
        <Text style={s.sliderLabel}>pH: {solutionPh.toFixed(1)}</Text>
        <Slider
          minimumValue={3.0}
          maximumValue={6.5}
          step={0.5}
          value={solutionPh}
          onValueChange={setSolutionPh}
          minimumTrackTintColor={COLORS.text}
          maximumTrackTintColor={COLORS.border}
          thumbTintColor={COLORS.text}
        />
      </Card>

      {/* QUALITY CONCERNS (scoped to the variety picked above) ──── */}
      {activeVariety ? (
        <Card>
          <Text style={s.section}>QUALITY CONCERNS · {activeVariety}</Text>
          <View style={{ height: 12 }} />
          <LabeledInput
            label="Stems Sampled"
            iconName="grass"
            value={stemsCheckedByVariety[activeVariety] ?? ''}
            onChangeText={(v) => setStemsCheckedForVariety(activeVariety, v)}
            keyboardType="number-pad"
            placeholder={`0 / ${stemsPerVariety[activeVariety] ?? 0} in batch`}
          />
          <View style={{ height: 4 }} />
          <Pressable
            onPress={() => setAddConcernOpen(true)}
            style={s.addRow}
            disabled={availableParams.length === 0}
          >
            <MaterialCommunityIcons name="plus-circle-outline" size={20} color={COLORS.text} />
            <Text style={s.addLabel}>
              {availableParams.length === 0
                ? 'All concerns added for this variety'
                : 'Add Quality Concern'}
            </Text>
          </Pressable>
          <View style={{ height: 12 }} />
          {varietyConcerns.length === 0 ? (
            <Text style={s.empty}>No concerns added for {activeVariety} yet</Text>
          ) : (
            varietyConcerns.map((c) => {
              const param = parameters.find(
                (p) => snakeCaseParam(p.parameter) === c.paramKey,
              );
              return (
                <ConcernRow
                  key={c.id}
                  concern={c}
                  displayName={param?.parameter ?? c.paramKey}
                  tolerance={Number(param?.toleranceThresholds ?? 0)}
                  stemsCheckedForVariety={activeVarietyStems}
                  onUpdate={(patch) => updateConcern(c.id, patch)}
                  onRemove={() => removeConcern(c.id)}
                />
              );
            })
          )}
        </Card>
      ) : null}

      {/* BATCH ACTION ─────────────────────────────── */}
      <Card>
        <Text style={s.section}>BATCH ACTION</Text>
        <View style={{ height: 12 }} />
        <View style={s.actionRow}>
          <DecisionChip
            label="Accept"
            selected={batchAction === 'accept'}
            disabled={exceeded}
            onPress={() => setBatchAction('accept')}
          />
          <DecisionChip
            label="Quarantine"
            selected={batchAction === 'quarantine'}
            onPress={() => setBatchAction('quarantine')}
          />
          <DecisionChip
            label="Reject"
            selected={batchAction === 'reject'}
            onPress={() => setBatchAction('reject')}
          />
        </View>
      </Card>

      {/* QUARANTINE SCOPE ─────────────────────────── */}
      {batchAction === 'quarantine' ? (
        <Card>
          <Text style={s.section}>QUARANTINE SCOPE</Text>
          <View style={{ height: 12 }} />
          <View style={s.scopeRow}>
            <ScopePill
              label="Bucket(s)"
              selected={quarantineScope === 'buckets'}
              onPress={() => setQuarantineScope('buckets')}
            />
            <ScopePill
              label="Entire Batch"
              selected={quarantineScope === 'batch'}
              onPress={() => setQuarantineScope('batch')}
            />
          </View>
          {quarantineScope === 'buckets' ? (
            <BucketSelectionList
              buckets={batch.buckets}
              selected={selectedBucketsForQuarantine}
              onToggle={toggleBucketForQuarantine}
            />
          ) : null}
        </Card>
      ) : null}

      <Button
        label={submitting ? 'Submitting…' : 'SUBMIT'}
        loading={submitting}
        onPress={onSubmit}
        style={{ height: 56 }}
      />

      <AddConcernModal
        open={addConcernOpen}
        onClose={() => setAddConcernOpen(false)}
        options={availableParams.map((p) => ({
          label: p.parameter,
          value: snakeCaseParam(p.parameter),
        }))}
        onPick={(key) => {
          addConcern(key);
          setAddConcernOpen(false);
        }}
      />
    </>
  );
}

function ConcernRow({
  concern,
  displayName,
  tolerance,
  stemsCheckedForVariety,
  onUpdate,
  onRemove,
}: {
  concern: Concern;
  displayName: string;
  tolerance: number;
  /** Sample size of the variety this concern belongs to — drives the % calc. */
  stemsCheckedForVariety: number;
  onUpdate: (patch: Partial<Concern>) => void;
  onRemove: () => void;
}) {
  const pct =
    stemsCheckedForVariety > 0 ? (concern.count / stemsCheckedForVariety) * 100 : 0;
  const exceeded =
    (tolerance === 0 && concern.count > 0) || (tolerance > 0 && pct > tolerance);
  const ratio = tolerance > 0 ? pct / tolerance : 0;

  return (
    <View style={s.concernCard}>
      <View style={s.concernHead}>
        <Text style={s.concernTitle}>{displayName}</Text>
        <Pressable onPress={onRemove} hitSlop={8}>
          <MaterialCommunityIcons name="close" size={18} color={COLORS.textMuted} />
        </Pressable>
      </View>
      <View style={{ height: 12 }} />
      <View style={s.affectedRow}>
        <Text style={s.affectedLabel}>Affected stems:</Text>
        <TextInput
          value={String(concern.count || '')}
          onChangeText={(t) => onUpdate({ count: Number.parseInt(t, 10) || 0 })}
          keyboardType="number-pad"
          textAlign="center"
          style={s.affectedInput}
        />
      </View>
      {tolerance > 0 ? (
        <>
          <View style={{ height: 12 }} />
          <View style={s.tolRow}>
            <Text style={s.tolLabel}>Tolerance ≤ {tolerance.toFixed(1)}%</Text>
            <Text style={[s.tolValue, exceeded ? s.tolExceeded : null]}>
              {pct.toFixed(1)}%
            </Text>
          </View>
          <View style={{ height: 6 }} />
          <ProgressBar value={ratio} exceeded={exceeded} />
        </>
      ) : null}
    </View>
  );
}

function ScopePill({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[s.scopePill, selected && s.scopePillSelected]}>
      <Text style={[s.scopePillLabel, selected && s.scopePillLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

function BucketSelectionList({
  buckets,
  selected,
  onToggle,
}: {
  buckets: QualityBucket[];
  selected: Record<string, boolean>;
  onToggle: (id: string) => void;
}) {
  const groups: Record<string, QualityBucket[]> = {};
  for (const b of buckets) {
    if (!groups[b.itemCode]) groups[b.itemCode] = [];
    groups[b.itemCode].push(b);
  }

  return (
    <View style={{ marginTop: 16 }}>
      <Text style={s.scopeHelper}>Select buckets to quarantine:</Text>
      {Object.entries(groups).map(([variety, group]) => {
        const total = group.reduce((sum, b) => sum + b.stems, 0);
        return (
          <View key={variety || '—'}>
            <Text style={s.groupHeader}>
              {variety || '—'} · {group.length} bucket(s), {total} stems
            </Text>
            {group.map((b) => {
              const id = b.bucketId.toUpperCase();
              const isOn = !!selected[id];
              return (
                <Pressable key={b.bucketId} onPress={() => onToggle(b.bucketId)} style={s.checkRow}>
                  <MaterialCommunityIcons
                    name={isOn ? 'checkbox-marked' : 'checkbox-blank-outline'}
                    size={20}
                    color={COLORS.text}
                  />
                  <Text style={s.checkLabel}>
                    {id} ({b.stems} stems)
                  </Text>
                </Pressable>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

function AddConcernModal({
  open,
  onClose,
  options,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  options: { label: string; value: string }[];
  onPick: (key: string) => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = search
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <View style={s.modalRoot}>
        <View style={s.modalHeader}>
          <Text style={s.modalTitle}>Add Quality Concern</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={s.modalClose}>Cancel</Text>
          </Pressable>
        </View>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search concern…"
          placeholderTextColor={COLORS.textMuted}
          autoCapitalize="none"
          style={s.modalSearch}
        />
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.value}
          ItemSeparatorComponent={() => <View style={s.modalSep} />}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Pressable onPress={() => onPick(item.value)} style={s.modalRow}>
              <Text style={s.modalRowText}>{item.label}</Text>
            </Pressable>
          )}
          ListEmptyComponent={<Text style={s.modalEmpty}>No matches.</Text>}
        />
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  section: {
    fontWeight: '700',
    color: COLORS.textMuted,
    fontSize: 12,
    letterSpacing: 0.4,
  },
  hint: { fontSize: 12, color: COLORS.textMuted, marginTop: 4 },
  pillRow: { flexDirection: 'row', gap: 8, paddingRight: 8 },
  varietyPill: {
    minWidth: 140,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bgMuted,
  },
  varietyPillActive: {
    borderColor: COLORS.text,
    backgroundColor: COLORS.bg,
  },
  varietyPillLabel: { fontSize: 13, fontWeight: '600', color: COLORS.textMuted },
  varietyPillLabelActive: { color: COLORS.text },
  varietyPillMeta: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  varietyPillMetaActive: { color: COLORS.text },
  sliderLabel: { fontSize: 13, color: COLORS.text, fontWeight: '600' },
  empty: {
    color: COLORS.textMuted,
    textAlign: 'center',
    paddingVertical: 16,
    fontSize: 13,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: COLORS.bgMuted,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  addLabel: { color: COLORS.text, fontWeight: '600' },
  concernCard: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    backgroundColor: COLORS.bg,
  },
  concernHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  concernTitle: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  affectedRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  affectedLabel: { color: COLORS.textMuted, fontSize: 13 },
  affectedInput: {
    width: 80,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingVertical: 6,
    fontSize: 14,
    color: COLORS.text,
    backgroundColor: COLORS.bg,
  },
  tolRow: { flexDirection: 'row', justifyContent: 'space-between' },
  tolLabel: { fontSize: 12, color: COLORS.textMuted },
  tolValue: { fontSize: 12, fontWeight: '600', color: COLORS.text },
  tolExceeded: { color: COLORS.danger },
  actionRow: { flexDirection: 'row', gap: 12 },
  scopeRow: { flexDirection: 'row', gap: 12 },
  scopePill: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bgMuted,
    alignItems: 'center',
  },
  scopePillSelected: { borderColor: COLORS.text, backgroundColor: COLORS.bg },
  scopePillLabel: { fontWeight: '600', color: COLORS.textMuted },
  scopePillLabelSelected: { color: COLORS.text },
  scopeHelper: { color: COLORS.text, fontSize: 13, marginBottom: 8, fontWeight: '600' },
  groupHeader: {
    fontWeight: '600',
    color: COLORS.text,
    fontSize: 13,
    marginTop: 12,
    marginBottom: 4,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  checkLabel: { fontSize: 14, color: COLORS.text },
  modalRoot: { flex: 1, backgroundColor: COLORS.bg },
  modalHeader: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: COLORS.text,
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  modalClose: { fontSize: 14, color: COLORS.text, fontWeight: '600' },
  modalSearch: {
    margin: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 15,
    color: COLORS.text,
  },
  modalRow: { paddingHorizontal: 16, paddingVertical: 14 },
  modalSep: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.border },
  modalRowText: { fontSize: 15, color: COLORS.text },
  modalEmpty: { padding: 16, color: COLORS.textMuted },
});
