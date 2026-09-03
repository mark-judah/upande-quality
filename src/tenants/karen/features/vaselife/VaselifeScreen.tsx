import { ScanField, type ScanFieldHandle } from '@/src/core/scanning/ScanField';
import { COLORS } from '@/src/core/theme';
import { Button } from '@/src/core/ui/Button';
import { Card } from '@/src/core/ui/Card';
import { Dropdown } from '@/src/core/ui/Dropdown';
import { LabeledInput } from '@/src/core/ui/LabeledInput';
import { Screen } from '@/src/core/ui/Screen';
import { useToast } from '@/src/core/ui/Toast';
import { useKarenVaselifeStore } from '@/src/tenants/karen/state/karen-vaselife-store';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
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

type Section = 'sample' | 'observation';

// Fixed commercial-status options (not backend-driven).
const COMMERCIAL_STATUS_OPTS = [
  { label: 'Trials', value: 'Trials' },
  { label: 'Semi Commercial', value: 'Semi Commercial' },
  { label: 'Commercial', value: 'Commercial' },
];

export function VaselifeScreen() {
  const { showSuccess, showError } = useToast();
  const [section, setSection] = useState<Section>('sample');
  const [addReasonOpen, setAddReasonOpen] = useState(false);
  const scanRef = useRef<ScanFieldHandle>(null);

  const loading = useKarenVaselifeStore((s) => s.loading);
  const loadError = useKarenVaselifeStore((s) => s.loadError);
  const loadInitialData = useKarenVaselifeStore((s) => s.loadInitialData);
  const breeders = useKarenVaselifeStore((s) => s.breeders);
  const varieties = useKarenVaselifeStore((s) => s.varieties);
  const crops = useKarenVaselifeStore((s) => s.crops);
  const cutStages = useKarenVaselifeStore((s) => s.cutStages);
  const failureReasons = useKarenVaselifeStore((s) => s.failureReasons);
  const samples = useKarenVaselifeStore((s) => s.samples);
  // Commercial status is a fixed three-option list, not a backend lookup.

  const scanning = useKarenVaselifeStore((s) => s.scanning);
  const scanError = useKarenVaselifeStore((s) => s.scanError);
  const scannedBucketId = useKarenVaselifeStore((s) => s.scannedBucketId);
  const scanBucket = useKarenVaselifeStore((s) => s.scanBucket);

  // Sample form
  const samplingDate = useKarenVaselifeStore((s) => s.samplingDate);
  const consignment = useKarenVaselifeStore((s) => s.consignment);
  const supermarketDate = useKarenVaselifeStore((s) => s.supermarketDate);
  const dueDate = useKarenVaselifeStore((s) => s.dueDate);
  const vaseDate = useKarenVaselifeStore((s) => s.vaseDate);
  const breeder = useKarenVaselifeStore((s) => s.breeder);
  const variety = useKarenVaselifeStore((s) => s.variety);
  const commercialStatus = useKarenVaselifeStore((s) => s.commercialStatus);
  const crop = useKarenVaselifeStore((s) => s.crop);
  const harvestDate = useKarenVaselifeStore((s) => s.harvestDate);
  const harvestTime = useKarenVaselifeStore((s) => s.harvestTime);
  const lineCode = useKarenVaselifeStore((s) => s.lineCode);
  const farm = useKarenVaselifeStore((s) => s.farm);
  const gh = useKarenVaselifeStore((s) => s.gh);
  const length = useKarenVaselifeStore((s) => s.length);
  const noOfStems = useKarenVaselifeStore((s) => s.noOfStems);
  const budHeight = useKarenVaselifeStore((s) => s.budHeight);
  const budWidth = useKarenVaselifeStore((s) => s.budWidth);
  const initialCutStage = useKarenVaselifeStore((s) => s.initialCutStage);
  const sampleSubmitting = useKarenVaselifeStore((s) => s.sampleSubmitting);
  const lastSampleCode = useKarenVaselifeStore((s) => s.lastSampleCode);
  const canSubmitSample = useKarenVaselifeStore((s) => s.canSubmitSample);
  const submitSample = useKarenVaselifeStore((s) => s.submitSample);
  const resetSample = useKarenVaselifeStore((s) => s.resetSample);
  const setSamplingDate = useKarenVaselifeStore((s) => s.setSamplingDate);
  const setConsignment = useKarenVaselifeStore((s) => s.setConsignment);
  const setSupermarketDate = useKarenVaselifeStore((s) => s.setSupermarketDate);
  const setDueDate = useKarenVaselifeStore((s) => s.setDueDate);
  const setVaseDate = useKarenVaselifeStore((s) => s.setVaseDate);
  const setBreeder = useKarenVaselifeStore((s) => s.setBreeder);
  const setVariety = useKarenVaselifeStore((s) => s.setVariety);
  const setCommercialStatus = useKarenVaselifeStore((s) => s.setCommercialStatus);
  const setCrop = useKarenVaselifeStore((s) => s.setCrop);
  const setHarvestDate = useKarenVaselifeStore((s) => s.setHarvestDate);
  const setHarvestTime = useKarenVaselifeStore((s) => s.setHarvestTime);
  const setLineCode = useKarenVaselifeStore((s) => s.setLineCode);
  const setFarm = useKarenVaselifeStore((s) => s.setFarm);
  const setGh = useKarenVaselifeStore((s) => s.setGh);
  const setLength = useKarenVaselifeStore((s) => s.setLength);
  const setNoOfStems = useKarenVaselifeStore((s) => s.setNoOfStems);
  const setBudHeight = useKarenVaselifeStore((s) => s.setBudHeight);
  const setBudWidth = useKarenVaselifeStore((s) => s.setBudWidth);
  const setInitialCutStage = useKarenVaselifeStore((s) => s.setInitialCutStage);

  // Observation form
  const obsDate = useKarenVaselifeStore((s) => s.obsDate);
  const obsSampleCode = useKarenVaselifeStore((s) => s.obsSampleCode);
  const obsStemsFailed = useKarenVaselifeStore((s) => s.obsStemsFailed);
  const obsReasons = useKarenVaselifeStore((s) => s.obsReasons);
  const obsNotes = useKarenVaselifeStore((s) => s.obsNotes);
  const obsSubmitting = useKarenVaselifeStore((s) => s.obsSubmitting);
  const setObsSampleCode = useKarenVaselifeStore((s) => s.setObsSampleCode);
  const setObsStemsFailed = useKarenVaselifeStore((s) => s.setObsStemsFailed);
  const setObsNotes = useKarenVaselifeStore((s) => s.setObsNotes);
  const toggleObsReason = useKarenVaselifeStore((s) => s.toggleObsReason);
  const canSubmitObservation = useKarenVaselifeStore((s) => s.canSubmitObservation);
  const submitObservation = useKarenVaselifeStore((s) => s.submitObservation);
  const resetObservation = useKarenVaselifeStore((s) => s.resetObservation);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const onScan = async (raw: string) => {
    const r = await scanBucket(raw);
    if (!r.ok) showError(r.message ?? 'Could not load bucket.');
  };

  const onSubmitSample = async () => {
    const outcome = await submitSample();
    if (outcome.kind === 'ok') {
      showSuccess(outcome.message);
      resetSample();
      scanRef.current?.clear();
    } else {
      showError(outcome.message);
    }
  };

  const onSubmitObservation = async () => {
    const outcome = await submitObservation();
    if (outcome.kind === 'ok') {
      showSuccess(outcome.message);
      resetObservation();
    } else {
      showError(outcome.message);
    }
  };

  const breederOpts = breeders.map((b) => ({ label: b.name, value: b.name }));
  const varietyOpts = varieties.map((v) => ({ label: v.variety, value: v.name }));
  const cropOpts = crops.map((c) => ({ label: c.name, value: c.name }));
  const cutStageOpts = cutStages.map((s) => ({ label: s.name, value: s.name }));
  const selectedReasonSet = new Set(obsReasons);
  const availableReasons = failureReasons.filter((r) => !selectedReasonSet.has(r.name));

  // Sample dropdown options
  const sampleOptions = samples.map((sample) => ({
    label: `${sample.code}${sample.variety ? ` - ${sample.variety}` : ''}${sample.samplingDate ? ` (${sample.samplingDate})` : ''}`,
    value: sample.code
  }));

  return (
    <Screen
      title="Vaselife"
      loading={loading && breeders.length === 0 && varieties.length === 0}
      error={loadError ?? undefined}
      onRetry={loadInitialData}
      scroll={false}
    >
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">

        {/* SECTION TOGGLE */}
        <View style={s.toggleRow}>
          <Pressable
            onPress={() => setSection('sample')}
            style={[s.toggleBtn, section === 'sample' && s.toggleBtnActive]}
          >
            <Text style={[s.toggleLabel, section === 'sample' && s.toggleLabelActive]}>
              NEW SAMPLE
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setSection('observation')}
            style={[s.toggleBtn, section === 'observation' && s.toggleBtnActive]}
          >
            <Text style={[s.toggleLabel, section === 'observation' && s.toggleLabelActive]}>
              OBSERVATION
            </Text>
          </Pressable>
        </View>

        {section === 'sample' ? (
          <>
            {lastSampleCode ? (
              <Card>
                <View style={s.bannerRow}>
                  <MaterialCommunityIcons name="check-circle-outline" size={20} color={COLORS.text} />
                  <View style={{ marginLeft: 10, flex: 1 }}>
                    <Text style={s.bannerLabel}>LAST SAVED SAMPLE CODE</Text>
                    <Text style={s.bannerCode}>{lastSampleCode}</Text>
                    <Text style={s.hint}>Note this code to record observations.</Text>
                  </View>
                </View>
              </Card>
            ) : null}

            {/* SAMPLE INFO */}
            <Card>
              <Text style={s.section}>SAMPLE INFO</Text>
              <View style={{ height: 12 }} />
              <LabeledInput
                label="Sampling Date"
                iconName="calendar-today"
                value={samplingDate}
                onChangeText={setSamplingDate}
                placeholder="YYYY-MM-DD"
                keyboardType="numeric"
              />
              <LabeledInput
                label="Consignment"
                iconName="package-variant-closed"
                value={consignment}
                onChangeText={setConsignment}
                placeholder="Consignment ID or reference"
              />
            </Card>

            {/* DATES */}
            <Card>
              <Text style={s.section}>DATES</Text>
              <View style={{ height: 12 }} />
              <LabeledInput
                label="Supermarket Date"
                iconName="storefront-outline"
                value={supermarketDate}
                onChangeText={setSupermarketDate}
                placeholder="YYYY-MM-DD"
                keyboardType="numeric"
              />
              <LabeledInput
                label="Due Date"
                iconName="calendar-clock"
                value={dueDate}
                onChangeText={setDueDate}
                placeholder="YYYY-MM-DD"
                keyboardType="numeric"
              />
              <LabeledInput
                label="Vase Date"
                iconName="flower-outline"
                value={vaseDate}
                onChangeText={setVaseDate}
                placeholder="YYYY-MM-DD"
                keyboardType="numeric"
              />
            </Card>

            {/* FLOWER DETAILS */}
            <Card>
              <Text style={s.section}>FLOWER DETAILS</Text>
              <View style={{ height: 12 }} />
              <Dropdown
                label="Variety"
                iconName="flower-outline"
                value={variety}
                options={varietyOpts}
                placeholder="Select variety"
                onChange={setVariety}
              />
              <View style={{ height: 12 }} />
              <Dropdown
                label="Breeder"
                iconName="account-tie-outline"
                value={breeder}
                options={breederOpts}
                placeholder="Select breeder"
                onChange={setBreeder}
              />
              <View style={{ height: 12 }} />
              <Dropdown
                label="Commercial Status"
                iconName="tag-outline"
                value={commercialStatus}
                options={COMMERCIAL_STATUS_OPTS}
                placeholder="Select status"
                onChange={setCommercialStatus}
              />
              <View style={{ height: 12 }} />
              <Dropdown
                label="Crop"
                iconName="sprout-outline"
                value={crop}
                options={cropOpts}
                placeholder="Select crop"
                onChange={setCrop}
              />
            </Card>

            {/* HARVEST */}
            <Card>
              <Text style={s.section}>HARVEST</Text>
              <Text style={s.hint}>Scan the bucket to auto-fill harvest details.</Text>
              <View style={{ height: 12 }} />
              <ScanField
                ref={scanRef}
                onScan={onScan}
                placeholder="Scan or type bucket ID"
                editable={!scanning}
              />
              {scanning ? <Text style={s.hint}>Loading bucket…</Text> : null}
              {scanError ? <Text style={s.errorText}>{scanError}</Text> : null}
              {scannedBucketId ? (
                <Text style={s.scannedBadge}>Bucket · {scannedBucketId}</Text>
              ) : null}
              <View style={{ height: 12 }} />
              <LabeledInput
                label="Harvest Date"
                iconName="calendar-outline"
                value={harvestDate}
                onChangeText={setHarvestDate}
                placeholder="YYYY-MM-DD"
                keyboardType="numeric"
              />
              <LabeledInput
                label="Harvest Time"
                iconName="clock-outline"
                value={harvestTime}
                onChangeText={setHarvestTime}
                placeholder="HH:MM"
              />
              <LabeledInput
                label="Farm"
                iconName="domain"
                value={farm}
                onChangeText={setFarm}
                placeholder="Farm name"
              />
              <LabeledInput
                label="GH (Greenhouse)"
                iconName="home-outline"
                value={gh}
                onChangeText={setGh}
                placeholder="Greenhouse code"
              />
              <LabeledInput
                label="Line Code"
                iconName="barcode"
                value={lineCode}
                onChangeText={setLineCode}
                placeholder="Line code"
              />
            </Card>

            {/* MEASUREMENTS */}
            <Card>
              <Text style={s.section}>MEASUREMENTS</Text>
              <View style={{ height: 12 }} />
              <View style={s.twoCol}>
                <View style={s.colLeft}>
                  <LabeledInput
                    label="Length (cm)"
                    iconName="ruler"
                    value={length}
                    onChangeText={setLength}
                    placeholder="0"
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={s.colRight}>
                  <LabeledInput
                    label="No. of Stems"
                    iconName="numeric"
                    value={noOfStems}
                    onChangeText={setNoOfStems}
                    placeholder="0"
                    keyboardType="number-pad"
                  />
                </View>
              </View>
              <View style={s.twoCol}>
                <View style={s.colLeft}>
                  <LabeledInput
                    label="Bud Height (mm)"
                    iconName="arrow-expand-vertical"
                    value={budHeight}
                    onChangeText={setBudHeight}
                    placeholder="0"
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={s.colRight}>
                  <LabeledInput
                    label="Bud Width (mm)"
                    iconName="arrow-expand-horizontal"
                    value={budWidth}
                    onChangeText={setBudWidth}
                    placeholder="0"
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>
              <Dropdown
                label="Initial Cut Stage"
                iconName="scissors-cutting"
                value={initialCutStage}
                options={cutStageOpts}
                placeholder="Select cut stage"
                onChange={setInitialCutStage}
              />
            </Card>

            <Button
              label={sampleSubmitting ? 'Saving…' : 'SAVE SAMPLE'}
              onPress={onSubmitSample}
              loading={sampleSubmitting}
              disabled={!canSubmitSample()}
              style={{ height: 56 }}
            />
          </>
        ) : (
          <>
            {/* SAMPLE REFERENCE */}
            <Card>
              <Text style={s.section}>SAMPLE REFERENCE</Text>
              <View style={{ height: 12 }} />
              <Dropdown
                label="Sample Code"
                iconName="identifier"
                value={obsSampleCode}
                options={sampleOptions}
                placeholder="Select a sample"
                onChange={setObsSampleCode}
              />
              <View style={{ height: 12 }} />
              <LabeledInput
                label="Observation Date"
                iconName="calendar-today"
                value={obsDate}
                editable={false}
                placeholder="YYYY-MM-DD"
              />
            </Card>

            {/* OBSERVATION */}
            <Card>
              <Text style={s.section}>OBSERVATION</Text>
              <View style={{ height: 12 }} />
              <LabeledInput
                label="Stems Failed"
                iconName="numeric"
                value={obsStemsFailed}
                onChangeText={setObsStemsFailed}
                placeholder="0"
                keyboardType="number-pad"
              />
              <View style={{ height: 8 }} />
              <Text style={s.fieldLabel}>Reasons for Stem Failure</Text>
              <View style={{ height: 8 }} />
              {obsReasons.length > 0 ? (
                <View style={s.chipWrap}>
                  {obsReasons.map((r) => (
                    <Pressable key={r} onPress={() => toggleObsReason(r)} style={s.chip}>
                      <Text style={s.chipText}>{r}</Text>
                      <MaterialCommunityIcons name="close" size={14} color={COLORS.textMuted} style={{ marginLeft: 4 }} />
                    </Pressable>
                  ))}
                </View>
              ) : (
                <Text style={s.empty}>No failure reasons added yet.</Text>
              )}
              <View style={{ height: 12 }} />
              <Pressable
                onPress={() => setAddReasonOpen(true)}
                style={[s.addRow, availableReasons.length === 0 && { opacity: 0.4 }]}
                disabled={availableReasons.length === 0}
              >
                <MaterialCommunityIcons name="plus-circle-outline" size={20} color={COLORS.text} />
                <Text style={s.addLabel}>
                  {availableReasons.length === 0 ? 'All reasons selected' : 'Add Failure Reason'}
                </Text>
              </Pressable>
              <View style={{ height: 16 }} />
              <Text style={s.fieldLabel}>Notes / Remarks</Text>
              <View style={{ height: 8 }} />
              <TextInput
                value={obsNotes}
                onChangeText={setObsNotes}
                placeholder="Write any additional remarks…"
                placeholderTextColor={COLORS.textMuted}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                style={s.notesInput}
              />
            </Card>

            <Button
              label={obsSubmitting ? 'Saving…' : 'SAVE OBSERVATION'}
              onPress={onSubmitObservation}
              loading={obsSubmitting}
              disabled={!canSubmitObservation()}
              style={{ height: 56 }}
            />
          </>
        )}
      </ScrollView>

      <AddReasonModal
        open={addReasonOpen}
        onClose={() => setAddReasonOpen(false)}
        options={availableReasons.map((r) => ({ label: r.name, value: r.name }))}
        onPick={(name) => {
          toggleObsReason(name);
          setAddReasonOpen(false);
        }}
      />
    </Screen>
  );
}

function AddReasonModal({
  open,
  onClose,
  options,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  options: { label: string; value: string }[];
  onPick: (name: string) => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = search
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <View style={s.modalRoot}>
        <View style={s.modalHeader}>
          <Text style={s.modalTitle}>Add Failure Reason</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={s.modalClose}>Cancel</Text>
          </Pressable>
        </View>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search reason…"
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
  section: { fontWeight: '700', color: COLORS.textMuted, fontSize: 12, letterSpacing: 0.4 },
  hint: { fontSize: 12, color: COLORS.textMuted, marginTop: 4 },
  errorText: { fontSize: 12, color: 'red', marginTop: 6 },
  scannedBadge: { fontSize: 12, fontWeight: '600', color: COLORS.text, marginTop: 6 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: COLORS.text },
  empty: { color: COLORS.textMuted, fontSize: 13, paddingVertical: 4 },

  toggleRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: COLORS.bgMuted,
  },
  toggleBtnActive: { backgroundColor: COLORS.text },
  toggleLabel: { fontSize: 12, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 0.4 },
  toggleLabelActive: { color: COLORS.bg },

  bannerRow: { flexDirection: 'row', alignItems: 'flex-start' },
  bannerLabel: { fontSize: 11, color: COLORS.textMuted, letterSpacing: 0.3 },
  bannerCode: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginTop: 2 },

  twoCol: { flexDirection: 'row', gap: 12 },
  colLeft: { flex: 1 },
  colRight: { flex: 1 },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bgMuted,
  },
  chipText: { fontSize: 13, color: COLORS.text },

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

  notesInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: COLORS.text,
    minHeight: 96,
    backgroundColor: COLORS.bg,
  },

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