import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/src/core/ui/Screen';
import { Card } from '@/src/core/ui/Card';
import { Button } from '@/src/core/ui/Button';
import { Dropdown } from '@/src/core/ui/Dropdown';
import { LabeledInput } from '@/src/core/ui/LabeledInput';
import { Spinner } from '@/src/core/ui/Spinner';
import { useToast } from '@/src/core/ui/Toast';
import { setCaptureResultCallback } from '@/src/core/scanning/CameraCaptureScreen';
import { storage, StorageKeys } from '@/src/core/storage';
import {
  borderRadius,
  COLORS,
  fontFamily,
  fontSize,
  spacing,
} from '@/src/core/theme';
import {
  useKarenSolutionMixingStore,
  type ChemicalRow,
} from '@/src/tenants/karen/state/karen-solution-mixing-store';

export function KarenSolutionMixingScreen({
  userFarm,
}: {
  userFarm: string;
}) {
  const { showSuccess, showError } = useToast();
  const {
    farms, farmsLoading,
    tanks, tanksLoading,
    chemicals, chemicalsLoading,
    farm, tank, tankCapacityL,
    mixingDate, mixingTime,
    ph, ppm, notes, rows,
    submitting,
    loadFarms, loadTanks, loadChemicals,
    setFarm, setTank, setMixingDate, setMixingTime,
    setPh, setPpm, setNotes,
    addRow, removeRow, updateRow, uploadPhotoForRow,
    submit, reset,
  } = useKarenSolutionMixingStore();

  // ── Initial load ──────────────────────────────────────────────────────
  useEffect(() => {
    if (userFarm && !farm) setFarm(userFarm);
    loadFarms();
    loadChemicals();
    loadTanks(userFarm);
    return () => reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userFarm]);

  // ── Re-fetch tanks whenever the farm picker changes ───────────────────
  useEffect(() => {
    if (farm) loadTanks(farm);
  }, [farm, loadTanks]);

  const tankOptions = useMemo(
    () =>
      tanks.map((t) => ({
        label: `${t.tankName}${t.capacityL ? ' · ' + Math.round(t.capacityL) + ' L' : ''}`,
        value: t.name,
        sublabel: t.location || undefined,
      })),
    [tanks],
  );

  const chemicalOptions = useMemo(
    () => chemicals.map((c) => ({ label: c.label, value: c.value })),
    [chemicals],
  );

  // ── Photo capture ─────────────────────────────────────────────────────
  const openCamera = useCallback(
    (rowId: number) => {
      setCaptureResultCallback((uri) => {
        // Fire-and-forget — the store handles its own loading state.
        void uploadPhotoForRow(rowId, uri);
      });
      router.push('/camera-capture' as never);
    },
    [uploadPhotoForRow],
  );

  // ── Image URL resolver (turns /files/... into a full URL for <Image />) ─
  const [imageBaseUrl, setImageBaseUrl] = useState<string>('');
  useEffect(() => {
    let alive = true;
    storage.get(StorageKeys.instanceUrl).then((url) => {
      if (alive) setImageBaseUrl(url ?? '');
    });
    return () => {
      alive = false;
    };
  }, []);

  // ── Submit handler ────────────────────────────────────────────────────
  const onSubmit = async () => {
    const outcome = await submit();
    if (outcome.kind === 'ok') {
      showSuccess(`Saved ${outcome.name || 'mix'}.`);
      reset();
      setFarm(userFarm);
      loadTanks(userFarm);
    } else {
      showError(outcome.message);
    }
  };

  return (
    <Screen title="Solution Mixing">
      <ScrollView
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* TANK & TIME ─────────────────────────────────── */}
        <Card>
          <Text style={s.section}>TANK</Text>
          <View style={{ height: 8 }} />
          <Dropdown
            label="Farm"
            iconName="home-outline"
            value={farm}
            options={
              // All Karen Roses farms — fall back to {station farm + whatever
              // appears in the tank list} if the farms endpoint hasn't returned yet.
              (farms.length > 0
                ? farms
                : Array.from(new Set([userFarm, ...tanks.map((t) => t.farm)])).filter(Boolean)
              ).map((f) => ({ label: f, value: f }))
            }
            placeholder={farmsLoading ? 'Loading farms…' : 'Pick farm'}
            disabled={farmsLoading && farms.length === 0}
            onChange={(v) => setFarm(v)}
          />
          <View style={{ height: 12 }} />
          <Dropdown
            label="Tank"
            iconName="cube-outline"
            value={tank}
            options={tankOptions}
            placeholder={
              tanksLoading
                ? 'Loading tanks…'
                : tanks.length === 0
                  ? 'No tanks for this farm'
                  : 'Pick tank'
            }
            disabled={tanksLoading || tanks.length === 0}
            onChange={(v) => setTank(v)}
          />
          {tankCapacityL > 0 ? (
            <Text style={s.muted}>Capacity: {Math.round(tankCapacityL)} L</Text>
          ) : null}
          <View style={{ height: 12 }} />
          <View style={s.dateTimeRow}>
            <View style={{ flex: 1 }}>
              <LabeledInput
                label="Date"
                iconName="calendar-outline"
                value={mixingDate}
                onChangeText={setMixingDate}
                placeholder="YYYY-MM-DD"
                autoCapitalize="none"
              />
            </View>
            <View style={{ flex: 1 }}>
              <LabeledInput
                label="Time"
                iconName="clock-outline"
                value={mixingTime}
                onChangeText={setMixingTime}
                placeholder="HH:MM"
                autoCapitalize="none"
              />
            </View>
          </View>
        </Card>

        {/* READINGS (matches Intake QC's slider treatment) ───────────────── */}
        <Card>
          <Text style={s.section}>READINGS</Text>
          <View style={{ height: 12 }} />
          <Text style={s.sliderLabel}>pH: {ph.toFixed(1)}</Text>
          <Slider
            minimumValue={3.0}
            maximumValue={6.5}
            step={0.5}
            value={ph}
            onValueChange={setPh}
            minimumTrackTintColor={COLORS.text}
            maximumTrackTintColor={COLORS.border}
            thumbTintColor={COLORS.text}
          />
          <View style={{ height: 12 }} />
          <Text style={s.sliderLabel}>PPM: {Math.round(ppm)} ppm</Text>
          <Slider
            minimumValue={0}
            maximumValue={200}
            step={10}
            value={ppm}
            onValueChange={setPpm}
            minimumTrackTintColor={COLORS.text}
            maximumTrackTintColor={COLORS.border}
            thumbTintColor={COLORS.text}
          />
        </Card>

        {/* CHEMICALS ─────────────────────────────────────────────────── */}
        <Card>
          <Text style={s.section}>CHEMICALS</Text>
          <Text style={s.helperText}>
            Add each chemical poured into the tank. Capture a photo of the
            container with the weight visible.
          </Text>
          <View style={{ height: 12 }} />
          {chemicalsLoading && chemicals.length === 0 ? (
            <Spinner inline label="Loading chemicals…" />
          ) : null}

          {rows.length === 0 ? (
            <Text style={s.empty}>No chemicals added yet.</Text>
          ) : (
            rows.map((r) => (
              <ChemicalRowCard
                key={r.id}
                row={r}
                chemicalOptions={chemicalOptions}
                imageBaseUrl={imageBaseUrl}
                onChange={(patch) => updateRow(r.id, patch)}
                onRemove={() => removeRow(r.id)}
                onPickPhoto={() => openCamera(r.id)}
              />
            ))
          )}

          <View style={{ height: 8 }} />
          <Pressable
            onPress={addRow}
            style={s.addRow}
            disabled={chemicalsLoading && chemicals.length === 0}
          >
            <Ionicons name="add-circle-outline" size={20} color={COLORS.text} />
            <Text style={s.addLabel}>Add chemical</Text>
          </Pressable>
        </Card>

        {/* NOTES ─────────────────────────────────────────────────────── */}
        <Card>
          <Text style={s.section}>NOTES</Text>
          <View style={{ height: 8 }} />
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Anything worth flagging for QC…"
            placeholderTextColor={COLORS.textMuted}
            multiline
            style={s.notesInput}
          />
        </Card>

        <Button
          label={submitting ? 'Submitting…' : 'Submit mix'}
          onPress={onSubmit}
          loading={submitting}
          disabled={submitting}
        />
      </ScrollView>
    </Screen>
  );
}

function ChemicalRowCard({
  row,
  chemicalOptions,
  imageBaseUrl,
  onChange,
  onRemove,
  onPickPhoto,
}: {
  row: ChemicalRow;
  chemicalOptions: { label: string; value: string }[];
  imageBaseUrl: string;
  onChange: (patch: Partial<ChemicalRow>) => void;
  onRemove: () => void;
  onPickPhoto: () => void;
}) {
  const fullPhotoUrl =
    row.photoUrl && row.photoUrl.startsWith('/') ? imageBaseUrl + row.photoUrl : row.photoUrl;
  return (
    <View style={s.chemCard}>
      <View style={s.chemHead}>
        <Text style={s.chemTitle}>
          {chemicalOptions.find((c) => c.value === row.chemical)?.label ?? 'New chemical'}
        </Text>
        <Pressable onPress={onRemove} hitSlop={8}>
          <Ionicons name="close" size={18} color={COLORS.textMuted} />
        </Pressable>
      </View>
      <View style={{ height: 10 }} />
      <Dropdown
        label="Chemical"
        iconName="flask-outline"
        value={row.chemical}
        options={chemicalOptions}
        placeholder="Pick chemical"
        onChange={(v) => onChange({ chemical: v })}
      />
      <View style={{ height: 8 }} />
      <View style={s.amountRow}>
        <View style={{ flex: 2 }}>
          <LabeledInput
            label="Amount"
            iconName="scale-balance"
            value={row.amount}
            onChangeText={(v) => onChange({ amount: v })}
            keyboardType="decimal-pad"
            placeholder="0"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.unitLabel}>Unit</Text>
          <View style={s.unitToggle}>
            {(['g', 'ml'] as const).map((u) => {
              const active = row.unit === u;
              return (
                <Pressable
                  key={u}
                  onPress={() => onChange({ unit: u })}
                  style={[s.unitChip, active && s.unitChipActive]}
                >
                  <Text
                    style={[s.unitChipLabel, active && s.unitChipLabelActive]}
                  >
                    {u}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>

      <View style={{ height: 12 }} />
      <View style={s.photoRow}>
        {row.photoUri || row.photoUrl ? (
          <View style={s.thumbWrap}>
            <Image
              source={{ uri: fullPhotoUrl || row.photoUri || '' }}
              style={s.thumb}
            />
            {row.uploading ? (
              <View style={s.thumbOverlay}>
                <Spinner inline />
              </View>
            ) : null}
            {row.uploadError ? (
              <View style={[s.thumbOverlay, { backgroundColor: 'rgba(220,38,38,0.85)' }]}>
                <Text style={s.thumbErrorText}>{row.uploadError}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <Button
            label={row.photoUri ? 'Retake photo' : 'Add photo'}
            iconLeft="camera-outline"
            variant="outline"
            onPress={onPickPhoto}
          />
          {row.uploadError ? (
            <Text style={s.errText}>{row.uploadError}</Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

// ── styles ────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  scroll: { paddingBottom: spacing.xxl + 60 },
  section: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  muted: { fontSize: 12, color: COLORS.textMuted, marginTop: 6 },
  helperText: { fontSize: 12, color: COLORS.textMuted, marginTop: 4 },
  empty: {
    color: COLORS.textMuted,
    textAlign: 'center',
    paddingVertical: 12,
    fontSize: 13,
  },
  dateTimeRow: { flexDirection: 'row', gap: spacing.sm },
  sliderLabel: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: COLORS.text,
  },

  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: borderRadius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  addLabel: {
    color: COLORS.text,
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
  },

  notesInput: {
    minHeight: 80,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    borderRadius: borderRadius.sm,
    padding: spacing.md,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: COLORS.text,
    backgroundColor: COLORS.bg,
    textAlignVertical: 'top',
  },

  chemCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: COLORS.bg,
  },
  chemHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chemTitle: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: COLORS.text,
    flex: 1,
    marginRight: spacing.sm,
  },

  amountRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' },
  unitLabel: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: COLORS.text,
    marginBottom: spacing.sm,
  },
  unitToggle: {
    flexDirection: 'row',
    backgroundColor: COLORS.bg,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  unitChip: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  unitChipActive: { backgroundColor: COLORS.text },
  unitChipLabel: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: COLORS.textMuted,
  },
  unitChipLabelActive: { color: '#FFFFFF' },

  photoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  thumbWrap: {
    width: 64, height: 64,
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
    backgroundColor: COLORS.surfaceAlt,
    position: 'relative',
  },
  thumb: { width: 64, height: 64 },
  thumbOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
    padding: 4,
  },
  thumbErrorText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontFamily: fontFamily.semiBold,
    textAlign: 'center',
  },
  errText: { color: COLORS.danger ?? '#EF4444', fontSize: 11, marginTop: 4 },
});
