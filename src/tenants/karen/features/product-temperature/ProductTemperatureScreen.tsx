import { memo, useCallback, useEffect } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/src/core/ui/Screen';
import { Card } from '@/src/core/ui/Card';
import { Button } from '@/src/core/ui/Button';
import { Dropdown } from '@/src/core/ui/Dropdown';
import { LabeledInput } from '@/src/core/ui/LabeledInput';
import { Segmented } from '@/src/core/ui/Segmented';
import { Spinner } from '@/src/core/ui/Spinner';
import { useToast } from '@/src/core/ui/Toast';
import { setCaptureResultCallback } from '@/src/core/scanning/CameraCaptureScreen';
import { borderRadius, COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';
import {
  useKarenProductTemperatureStore,
  type BoxState,
} from '@/src/tenants/karen/state/karen-product-temperature-store';

/** One box: its reading and the photo backing it. Memoised so typing in one
 *  box doesn't re-render (and un-focus) the other fourteen. */
const BoxRow = memo(function BoxRow({
  box,
  index,
  controlPoint,
  onChangeTemp,
  onCapture,
}: {
  box: BoxState;
  index: number;
  controlPoint: string;
  onChangeTemp: (controlPoint: string, index: number, text: string) => void;
  onCapture: (controlPoint: string, index: number) => void;
}) {
  const hasPhoto = !!box.photoUri;
  return (
    <View style={s.boxRow}>
      <Text style={s.boxLabel}>Box {index + 1}</Text>
      <View style={s.tempField}>
        <TextInput
          value={box.temp}
          onChangeText={(t) => onChangeTemp(controlPoint, index, t)}
          keyboardType="numbers-and-punctuation"
          placeholder="—"
          placeholderTextColor={COLORS.textMuted}
          style={s.tempInput}
        />
        <Text style={s.unit}>°C</Text>
      </View>

      <Pressable
        onPress={() => onCapture(controlPoint, index)}
        style={[s.photoBtn, hasPhoto && s.photoBtnFilled]}
        accessibilityLabel={hasPhoto ? `Retake box ${index + 1} photo` : `Capture box ${index + 1} photo`}
      >
        {hasPhoto ? (
          <>
            <Image source={{ uri: box.photoUri as string }} style={s.thumb} />
            {box.uploading ? (
              <View style={s.thumbOverlay}>
                <Spinner inline />
              </View>
            ) : null}
            {box.uploadError ? (
              <View style={[s.thumbOverlay, s.thumbOverlayError]}>
                <Ionicons name="alert" size={16} color="#FFFFFF" />
              </View>
            ) : null}
          </>
        ) : (
          <Ionicons name="camera-outline" size={20} color={COLORS.textMuted} />
        )}
      </Pressable>
    </View>
  );
});

export function KarenProductTemperatureScreen() {
  const { showSuccess, showError } = useToast();
  const st = useKarenProductTemperatureStore();

  useEffect(() => {
    if (st.controlPoints.length === 0 && !st.loading && !st.error) st.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCapture = useCallback(
    (controlPoint: string, index: number) => {
      setCaptureResultCallback((uri) => {
        // Fire-and-forget — the store owns the upload's loading state.
        void useKarenProductTemperatureStore.getState().uploadPhoto(controlPoint, index, uri);
      });
      router.push('/camera-capture' as never);
    },
    [],
  );

  const onSubmit = async () => {
    const outcome = await st.submit();
    if (outcome.kind === 'ok') {
      // The store clears this control point; date and customer carry over so
      // the next control point can be logged straight away. The server says
      // whether this started a log or joined the day's existing one.
      showSuccess(outcome.message);
    } else {
      showError(outcome.message);
    }
  };

  return (
    <Screen
      title="Product Temperature"
      loading={st.loading && st.controlPoints.length === 0}
      error={st.controlPoints.length === 0 ? st.error : null}
      onRetry={st.load}
    >
      <Card>
        <Text style={s.section}>LOG</Text>
        <View style={{ height: 8 }} />
        <LabeledInput
          label="Date"
          iconName="calendar-outline"
          value={st.date}
          onChangeText={st.setDate}
          placeholder="YYYY-MM-DD"
          autoCapitalize="none"
        />
        <View style={{ height: 12 }} />
        <Dropdown
          label="Customer"
          iconName="account-outline"
          value={st.customer}
          options={st.customers}
          placeholder={st.customers.length === 0 ? 'No customers set up' : 'Pick customer'}
          disabled={st.customers.length === 0}
          onChange={st.setCustomer}
        />
      </Card>

      <Card>
        <Text style={s.section}>CONTROL POINT</Text>
        <View style={{ height: 8 }} />
        <Segmented
          value={st.controlPoint}
          options={st.controlPoints.map((cp) => ({
            // A dot marks a control point holding readings you haven't saved.
            label: st.filledCount(cp) > 0 && cp !== st.controlPoint ? `${cp} •` : cp,
            value: cp,
          }))}
          onChange={st.setControlPoint}
        />
        <Text style={s.help}>
          Every temperature needs a photo of the probe. Skip boxes you didn&apos;t read.
        </Text>
        <View style={{ height: 4 }} />
        {(st.readings[st.controlPoint] ?? []).map((box, i) => (
          <BoxRow
            // Keyed per control point so switching tabs remounts the inputs
            // rather than reusing them with another point's values.
            key={`${st.controlPoint}-${i}`}
            box={box}
            index={i}
            controlPoint={st.controlPoint}
            onChangeTemp={st.setTemp}
            onCapture={onCapture}
          />
        ))}
      </Card>

      <Button
        label={st.submitting ? 'Saving…' : `Save ${st.controlPoint || 'log'}`}
        onPress={onSubmit}
        loading={st.submitting}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  section: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  help: { fontSize: 12, color: COLORS.textMuted, marginTop: 4 },
  boxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  boxLabel: {
    width: 52,
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: COLORS.textSecondary,
  },
  tempField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: borderRadius.sm,
    paddingRight: spacing.sm,
  },
  tempInput: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    textAlign: 'center',
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: COLORS.text,
  },
  unit: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: COLORS.textMuted },
  photoBtn: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoBtnFilled: { borderColor: COLORS.primary },
  thumb: { width: 44, height: 44 },
  thumbOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  thumbOverlayError: { backgroundColor: 'rgba(220,38,38,0.85)' },
});
