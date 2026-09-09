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
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Screen } from '@/src/core/ui/Screen';
import { Card } from '@/src/core/ui/Card';
import { Button } from '@/src/core/ui/Button';
import { Dropdown } from '@/src/core/ui/Dropdown';
import { LabeledInput } from '@/src/core/ui/LabeledInput';
import { ScanField, type ScanFieldHandle } from '@/src/core/scanning/ScanField';
import { useToast } from '@/src/core/ui/Toast';
import { COLORS } from '@/src/core/theme';
import {
  useKarenColdroomQcStore,
  type ColdroomRejectionRow,
} from '@/src/tenants/karen/state/karen-coldroom-qc-store';

export function ColdroomQcScreen() {
  const { showSuccess, showError } = useToast();
  const scanRef = useRef<ScanFieldHandle>(null);
  const [addReasonOpen, setAddReasonOpen] = useState(false);

  const loading = useKarenColdroomQcStore((s) => s.loading);
  const loadError = useKarenColdroomQcStore((s) => s.loadError);
  const loadInitialData = useKarenColdroomQcStore((s) => s.loadInitialData);
  const controlPoints = useKarenColdroomQcStore((s) => s.controlPoints);
  const reasons = useKarenColdroomQcStore((s) => s.reasons);
  const inchargeOptions = useKarenColdroomQcStore((s) => s.inchargeOptions);
  const selectedControlPoint = useKarenColdroomQcStore((s) => s.selectedControlPoint);
  const controlArea = useKarenColdroomQcStore((s) => s.controlArea);
  const setControlPoint = useKarenColdroomQcStore((s) => s.setControlPoint);
  const scanning = useKarenColdroomQcStore((s) => s.scanning);
  const bucket = useKarenColdroomQcStore((s) => s.bucket);
  const scanBucket = useKarenColdroomQcStore((s) => s.scanBucket);
  const selectedVariety = useKarenColdroomQcStore((s) => s.selectedVariety);
  const setSelectedVariety = useKarenColdroomQcStore((s) => s.setSelectedVariety);
  const rejections = useKarenColdroomQcStore((s) => s.rejections);
  const addReason = useKarenColdroomQcStore((s) => s.addReason);
  const updateRejectionStems = useKarenColdroomQcStore((s) => s.updateRejectionStems);
  const removeRejection = useKarenColdroomQcStore((s) => s.removeRejection);
  const qcIncharge = useKarenColdroomQcStore((s) => s.qcIncharge);
  const setQcIncharge = useKarenColdroomQcStore((s) => s.setQcIncharge);
  const remarks = useKarenColdroomQcStore((s) => s.remarks);
  const setRemarks = useKarenColdroomQcStore((s) => s.setRemarks);
  const submitting = useKarenColdroomQcStore((s) => s.submitting);
  const canSubmit = useKarenColdroomQcStore((s) => s.canSubmit);
  const submit = useKarenColdroomQcStore((s) => s.submit);
  const reset = useKarenColdroomQcStore((s) => s.reset);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const onScan = async (raw: string) => {
    const r = await scanBucket(raw);
    if (!r.ok) showError(r.message ?? 'Could not load bucket.');
  };

  const onSubmit = async () => {
    const outcome = await submit();
    if (outcome.kind === 'ok') {
      showSuccess(outcome.message);
      reset();
      scanRef.current?.clear();
    } else {
      showError(outcome.message);
    }
  };

  const cpOptions = controlPoints.map((c) => ({ label: c.controlPoint, value: c.name }));
  const inchargeOpts = inchargeOptions.map((u) => ({ label: u.fullName, value: u.name }));

  const varieties = bucket?.varieties ?? [];
  const activeVariety = selectedVariety ?? varieties[0]?.variety ?? null;
  const varietyRejections = rejections.filter((r) => r.variety === activeVariety);
  const usedReasons = new Set(varietyRejections.map((r) => r.reason));
  const availableReasons = reasons.filter((r) => !usedReasons.has(r.name));

  return (
    <Screen
      title="Coldroom QC"
      loading={loading && controlPoints.length === 0}
      error={loadError ?? undefined}
      onRetry={loadInitialData}
      scroll={false}
    >
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {/* CONTROL POINT */}
        <Card>
          <Text style={s.section}>CONTROL POINT</Text>
          <View style={{ height: 12 }} />
          <Dropdown
            label="Cold room"
            iconName="snowflake"
            value={selectedControlPoint}
            options={cpOptions}
            placeholder="Pick cold room"
            onChange={setControlPoint}
          />
          {controlArea ? <Text style={s.hint}>Control area · {controlArea}</Text> : null}
        </Card>

        {/* SCAN BUCKET */}
        {selectedControlPoint ? (
          <Card>
            <Text style={s.section}>SCAN BUCKET</Text>
            <Text style={s.hint}>Scan the bucket to load its varieties &amp; stock age.</Text>
            <View style={{ height: 12 }} />
            <ScanField ref={scanRef} onScan={onScan} placeholder="Scan or type bucket" editable={!scanning} />
            {scanning ? <Text style={s.loadingText}>Loading bucket…</Text> : null}
          </Card>
        ) : null}

        {bucket ? (
          <>
            {/* BUCKET DETAILS */}
            <Card>
              <Text style={s.section}>BUCKET · {bucket.bucketId}</Text>
              <View style={{ height: 10 }} />
              <View style={s.metaGrid}>
                <Meta label="Farm" value={bucket.farm || '—'} />
                <Meta label="Greenhouse" value={bucket.greenhouse || '—'} />
                <Meta label="Pack House" value={bucket.packhouse || '—'} />
                <Meta label="Days in Stock" value={String(bucket.daysInStock)} />
              </View>
            </Card>

            {/* VARIETY */}
            <Card>
              <Text style={s.section}>VARIETY</Text>
              <Text style={s.hint}>Pick the variety you&apos;re rejecting. Reasons below apply to it.</Text>
              <View style={{ height: 12 }} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.pillRow}>
                {varieties.map((v) => {
                  const isActive = v.variety === activeVariety;
                  const count = rejections.filter((r) => r.variety === v.variety).length;
                  return (
                    <Pressable
                      key={v.variety}
                      onPress={() => setSelectedVariety(v.variety)}
                      style={[s.varietyPill, isActive && s.varietyPillActive]}
                    >
                      <Text
                        style={[s.varietyPillLabel, isActive && s.varietyPillLabelActive]}
                        numberOfLines={1}
                      >
                        {v.variety}
                      </Text>
                      <Text style={[s.varietyPillMeta, isActive && s.varietyPillMetaActive]}>
                        {v.stems} stems{count > 0 ? ` · ${count} reason${count === 1 ? '' : 's'}` : ''}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </Card>

            {/* REJECTIONS (scoped to active variety) */}
            {activeVariety ? (
              <Card>
                <Text style={s.section}>REJECTIONS · {activeVariety}</Text>
                <Text style={s.hint}>Optional — add any rejected stems for this variety.</Text>
                <View style={{ height: 12 }} />
                <Pressable
                  onPress={() => setAddReasonOpen(true)}
                  style={s.addRow}
                  disabled={availableReasons.length === 0}
                >
                  <MaterialCommunityIcons name="plus-circle-outline" size={20} color={COLORS.text} />
                  <Text style={s.addLabel}>
                    {availableReasons.length === 0 ? 'All reasons added for this variety' : 'Add Rejection Reason'}
                  </Text>
                </Pressable>
                <View style={{ height: 12 }} />
                {varietyRejections.length === 0 ? (
                  <Text style={s.empty}>No reasons added for {activeVariety} yet</Text>
                ) : (
                  varietyRejections.map((r) => (
                    <RejectionRow
                      key={r.id}
                      row={r}
                      onChangeStems={(t) => updateRejectionStems(r.id, t)}
                      onRemove={() => removeRejection(r.id)}
                    />
                  ))
                )}
              </Card>
            ) : null}

            {/* SIGN-OFF */}
            <Card>
              <Text style={s.section}>SIGN-OFF</Text>
              <View style={{ height: 12 }} />
              <Dropdown
                label="QC Incharge"
                iconName="account-check-outline"
                value={qcIncharge || null}
                options={inchargeOpts}
                placeholder="Pick QC incharge"
                onChange={setQcIncharge}
              />
              <View style={{ height: 12 }} />
              <LabeledInput
                label="Remarks"
                iconName="note-text-outline"
                value={remarks}
                onChangeText={setRemarks}
                placeholder="Optional"
                multiline
              />
            </Card>

            <Button
              label={submitting ? 'Submitting…' : 'SUBMIT'}
              onPress={onSubmit}
              loading={submitting}
              disabled={!canSubmit()}
              style={{ height: 56 }}
            />
          </>
        ) : null}
      </ScrollView>

      <AddReasonModal
        open={addReasonOpen}
        onClose={() => setAddReasonOpen(false)}
        options={availableReasons.map((r) => ({ label: r.parameter, value: r.name }))}
        onPick={(name) => {
          addReason(name);
          setAddReasonOpen(false);
        }}
      />
    </Screen>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.metaCell}>
      <Text style={s.metaLabel}>{label}</Text>
      <Text style={s.metaValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function RejectionRow({
  row,
  onChangeStems,
  onRemove,
}: {
  row: ColdroomRejectionRow;
  onChangeStems: (t: string) => void;
  onRemove: () => void;
}) {
  return (
    <View style={s.rejCard}>
      <View style={s.rejHead}>
        <Text style={s.rejTitle}>{row.reasonLabel}</Text>
        <Pressable onPress={onRemove} hitSlop={8}>
          <MaterialCommunityIcons name="close" size={18} color={COLORS.textMuted} />
        </Pressable>
      </View>
      <View style={{ height: 12 }} />
      <View style={s.rejRow}>
        <Text style={s.rejLabel}>Rejected stems:</Text>
        <TextInput
          value={row.stems}
          onChangeText={onChangeStems}
          keyboardType="number-pad"
          textAlign="center"
          placeholder="0"
          placeholderTextColor={COLORS.textMuted}
          style={s.rejInput}
        />
        {row.length ? <Text style={s.rejLen}>· {row.length}</Text> : null}
      </View>
    </View>
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
          <Text style={s.modalTitle}>Add Rejection Reason</Text>
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
  loadingText: { fontSize: 12, color: COLORS.textMuted, marginTop: 8 },

  metaGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  metaCell: { width: '50%', paddingVertical: 6 },
  metaLabel: { fontSize: 11, color: COLORS.textMuted, letterSpacing: 0.3 },
  metaValue: { fontSize: 14, fontWeight: '600', color: COLORS.text, marginTop: 2 },

  pillRow: { flexDirection: 'row', gap: 8, paddingRight: 8 },
  varietyPill: {
    minWidth: 130,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bgMuted,
  },
  varietyPillActive: { borderColor: COLORS.text, backgroundColor: COLORS.bg },
  varietyPillLabel: { fontSize: 13, fontWeight: '600', color: COLORS.textMuted },
  varietyPillLabelActive: { color: COLORS.text },
  varietyPillMeta: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  varietyPillMetaActive: { color: COLORS.text },

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
  empty: { color: COLORS.textMuted, textAlign: 'center', paddingVertical: 16, fontSize: 13 },

  rejCard: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    backgroundColor: COLORS.bg,
  },
  rejHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rejTitle: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  rejRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rejLabel: { color: COLORS.textMuted, fontSize: 13 },
  rejInput: {
    width: 80,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingVertical: 6,
    fontSize: 14,
    color: COLORS.text,
    backgroundColor: COLORS.bg,
  },
  rejLen: { fontSize: 12, color: COLORS.textMuted },

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
