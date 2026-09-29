import { ScanField, type ScanFieldHandle } from '@/src/core/scanning/ScanField';
import { COLORS } from '@/src/core/theme';
import { Button } from '@/src/core/ui/Button';
import { Card } from '@/src/core/ui/Card';
import { Screen } from '@/src/core/ui/Screen';
import { useToast } from '@/src/core/ui/Toast';
import { useKarenColdroomQcStore } from '@/src/tenants/karen/state/karen-coldroom-qc-store';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

export function KarenColdroomQcScreen() {
  const loading = useKarenColdroomQcStore((s) => s.loading);
  const loadError = useKarenColdroomQcStore((s) => s.loadError);
  const parameters = useKarenColdroomQcStore((s) => s.parameters);
  const categories = useKarenColdroomQcStore((s) => s.categories);
  const loadInitialData = useKarenColdroomQcStore((s) => s.loadInitialData);

  const scanning = useKarenColdroomQcStore((s) => s.scanning);
  const scanError = useKarenColdroomQcStore((s) => s.scanError);
  const bucket = useKarenColdroomQcStore((s) => s.bucket);
  const scanBucket = useKarenColdroomQcStore((s) => s.scanBucket);

  const rejects = useKarenColdroomQcStore((s) => s.rejects);
  const addReject = useKarenColdroomQcStore((s) => s.addReject);
  const removeReject = useKarenColdroomQcStore((s) => s.removeReject);
  const setRejectStems = useKarenColdroomQcStore((s) => s.setRejectStems);

  const submitting = useKarenColdroomQcStore((s) => s.submitting);
  const canSubmit = useKarenColdroomQcStore((s) => s.canSubmit);
  const submit = useKarenColdroomQcStore((s) => s.submit);

  const { showSuccess, showError } = useToast();
  const scanRef = useRef<ScanFieldHandle>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const onScan = async (raw: string) => {
    const r = await scanBucket(raw);
    if (!r.ok && r.message) showError(r.message);
  };

  const onSubmit = async () => {
    const outcome = await submit();
    if (outcome.kind === 'ok') {
      showSuccess(outcome.message);
      scanRef.current?.focus?.();
    } else {
      showError(outcome.message);
    }
  };

  const total = rejects.reduce((sum, r) => sum + (Number(r.stems) || 0), 0);
  const available = bucket?.availableStems ?? 0;
  const overLimit = !!bucket && total > available;
  const usedReasons = new Set(rejects.map((r) => r.reason));
  const availableReasons = parameters.filter((p) => !usedReasons.has(p.name));

  return (
    <Screen
      title="Coldroom QC"
      loading={loading && parameters.length === 0}
      error={loadError ?? undefined}
      onRetry={loadInitialData}
      scroll={false}
    >
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadInitialData} />}
      >
        {/* SCAN */}
        <Card>
          <Text style={s.section}>SCAN BUCKET</Text>
          <Text style={s.hint}>Scan a bucket in the coldroom to reject stems with issues.</Text>
          <View style={{ height: 12 }} />
          <ScanField
            ref={scanRef}
            onScan={onScan}
            placeholder="Scan or type bucket ID"
            editable={!scanning}
          />
          {scanning ? <Text style={s.hint}>Loading bucket…</Text> : null}
          {scanError ? <Text style={s.errorText}>{scanError}</Text> : null}
        </Card>

        {bucket ? (
          <>
            {/* BUCKET DETAILS */}
            <Card>
              <View style={s.rowBetween}>
                <Text style={s.section}>BUCKET · {bucket.bucketId}</Text>
                {bucket.isShelved ? (
                  <Text style={s.shelvedBadge}>shelved</Text>
                ) : (
                  <Text style={s.coldBadge}>in coldroom</Text>
                )}
              </View>
              <View style={{ height: 10 }} />
              <DetailRow label="Farm" value={bucket.farm} />
              <DetailRow label="Greenhouse" value={bucket.greenhouse} />
              <DetailRow label="Variety" value={bucket.variety} />
              <DetailRow label="Stems received" value={String(bucket.stemsReceived)} />
              <DetailRow label="Available stems" value={String(bucket.availableStems)} strong />
            </Card>

            {/* REJECTIONS */}
            <Card>
              <Text style={s.section}>REJECT STEMS</Text>
              <Text style={s.hint}>Add each issue and the number of stems affected.</Text>
              <View style={{ height: 12 }} />

              {rejects.length > 0 ? (
                <>
                  <View style={s.headerRow}>
                    <Text style={[s.headerText, { flex: 1 }]}>REASON</Text>
                    <Text style={[s.headerText, s.stemsCol]}>STEMS</Text>
                    <View style={s.removeCol} />
                  </View>
                  {rejects.map((r) => (
                    <View key={r.id} style={s.rejectRow}>
                      <Text style={s.reasonText} numberOfLines={2}>
                        {r.reasonLabel}
                      </Text>
                      <TextInput
                        value={r.stems}
                        onChangeText={(v) => setRejectStems(r.id, v)}
                        placeholder="0"
                        placeholderTextColor={COLORS.textMuted}
                        keyboardType="number-pad"
                        style={[s.stemsInput, s.stemsCol]}
                      />
                      <Pressable onPress={() => removeReject(r.id)} hitSlop={8} style={s.removeCol}>
                        <MaterialCommunityIcons name="close-circle" size={22} color={COLORS.textMuted} />
                      </Pressable>
                    </View>
                  ))}
                  <View style={s.totalRow}>
                    <Text style={s.totalLabel}>Total rejected</Text>
                    <Text style={[s.totalValue, overLimit && { color: COLORS.danger }]}>
                      {total} / {available}
                    </Text>
                  </View>
                  {overLimit ? (
                    <Text style={s.errorText}>
                      Cannot reject more than the {available} available stems.
                    </Text>
                  ) : null}
                </>
              ) : (
                <View style={s.emptyBox}>
                  <MaterialCommunityIcons name="flower-tulip-outline" size={24} color={COLORS.textMuted} />
                  <Text style={s.emptyText}>No stems rejected yet.</Text>
                </View>
              )}

              <View style={{ height: 12 }} />
              <Pressable
                style={[s.addRow, availableReasons.length === 0 && { opacity: 0.4 }]}
                disabled={availableReasons.length === 0}
                onPress={() => setAddOpen(true)}
              >
                <MaterialCommunityIcons name="plus-circle-outline" size={20} color={COLORS.primary} />
                <Text style={s.addText}>
                  {availableReasons.length === 0 ? 'All reasons added' : 'Add Reason'}
                </Text>
              </Pressable>
            </Card>

            <Button
              label={submitting ? 'Saving…' : 'SAVE COLDROOM REJECT'}
              onPress={onSubmit}
              loading={submitting}
              disabled={!canSubmit()}
              style={{ height: 56 }}
            />
          </>
        ) : null}
      </ScrollView>

      <AddReasonModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        reasons={availableReasons}
        categoryOrder={categories}
        onPick={(name) => {
          addReject(name);
          setAddOpen(false);
        }}
      />
    </Screen>
  );
}

function DetailRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={s.detailRow}>
      <Text style={s.detailLabel}>{label}</Text>
      <Text style={[s.detailValue, strong && s.detailValueStrong]}>{value || '—'}</Text>
    </View>
  );
}

function AddReasonModal({
  open,
  onClose,
  reasons,
  categoryOrder,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  reasons: { name: string; label: string; category: string }[];
  categoryOrder: string[];
  onPick: (name: string) => void;
}) {
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const filtered = q ? reasons.filter((r) => r.label.toLowerCase().includes(q)) : reasons;

  // Bucket into sections, ordered by the backend's category order (unknown
  // categories are appended alphabetically at the end).
  const byCat = new Map<string, { name: string; label: string }[]>();
  filtered.forEach((r) => {
    const cat = r.category || 'Other';
    const arr = byCat.get(cat) ?? [];
    arr.push({ name: r.name, label: r.label });
    byCat.set(cat, arr);
  });
  const orderedCats = [
    ...categoryOrder.filter((c) => byCat.has(c)),
    ...[...byCat.keys()].filter((c) => !categoryOrder.includes(c)).sort(),
  ];
  const sections = orderedCats.map((c) => ({
    title: c,
    data: (byCat.get(c) ?? []).slice().sort((a, b) => a.label.localeCompare(b.label)),
  }));

  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <View style={s.modalRoot}>
        <View style={s.modalHeader}>
          <Text style={s.modalTitle}>Add Reason</Text>
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
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.name}
          stickySectionHeadersEnabled
          keyboardShouldPersistTaps="handled"
          renderSectionHeader={({ section }) => (
            <Text style={s.modalSectionHeader}>{section.title}</Text>
          )}
          renderItem={({ item }) => (
            <Pressable onPress={() => onPick(item.name)} style={s.modalRow}>
              <Text style={s.modalRowText}>{item.label}</Text>
            </Pressable>
          )}
          ItemSeparatorComponent={() => <View style={s.modalSep} />}
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
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  shelvedBadge: { fontSize: 11, fontWeight: '700', color: COLORS.primary },
  coldBadge: { fontSize: 11, fontWeight: '700', color: COLORS.textMuted },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  detailLabel: { fontSize: 13, color: COLORS.textMuted },
  detailValue: { fontSize: 13, color: COLORS.text, fontWeight: '500' },
  detailValueStrong: { fontWeight: '700', fontSize: 15 },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingBottom: 6 },
  headerText: { fontSize: 11, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 0.3 },
  stemsCol: { width: 70, textAlign: 'center' },
  removeCol: { width: 34, alignItems: 'center' },
  rejectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  reasonText: { flex: 1, fontSize: 14, color: COLORS.text },
  stemsInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontSize: 14,
    color: COLORS.text,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  totalLabel: { fontSize: 13, fontWeight: '600', color: COLORS.text },
  totalValue: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  emptyBox: { alignItems: 'center', paddingVertical: 18, gap: 6 },
  emptyText: { fontSize: 13, color: COLORS.textMuted },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  addText: { fontSize: 14, fontWeight: '600', color: COLORS.primary },
  modalRoot: { flex: 1, backgroundColor: COLORS.surface, paddingTop: 54 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  modalClose: { fontSize: 15, color: COLORS.primary },
  modalSearch: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: COLORS.text,
  },
  modalRow: { paddingHorizontal: 16, paddingVertical: 14 },
  modalSectionHeader: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    color: COLORS.textMuted,
    backgroundColor: '#F5F5F5',
    textTransform: 'uppercase',
  },
  modalSep: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.border },
  modalRowText: { fontSize: 15, color: COLORS.text },
  modalEmpty: { padding: 16, color: COLORS.textMuted },
});
