import { useCallback, useEffect } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/src/core/ui/Screen';
import { Card } from '@/src/core/ui/Card';
import { Button } from '@/src/core/ui/Button';
import { Dropdown } from '@/src/core/ui/Dropdown';
import { LabeledInput } from '@/src/core/ui/LabeledInput';
import { Spinner } from '@/src/core/ui/Spinner';
import { useToast } from '@/src/core/ui/Toast';
import { setCaptureResultCallback } from '@/src/core/scanning/CameraCaptureScreen';
import { borderRadius, COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';
import { useAuthStore } from '@/src/core/auth/store';
import { useKarenFreightDispatchStore } from '@/src/tenants/karen/state/karen-freight-dispatch-store';

/** The drawer hides this feature without the role; this guards direct
 *  navigation, and the endpoints enforce it again server-side. */
const FREIGHT_DISPATCH_RECORDER = 'Freight Dispatch Recorder';

/** Times arrive as HH:MM:SS; the driver only needs HH:MM. */
const hhmm = (t?: string) => (t ? t.slice(0, 5) : '—');

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.fact}>
      <Text style={s.factLabel}>{label}</Text>
      <Text style={s.factValue}>{value}</Text>
    </View>
  );
}

export function KarenFreightDispatchScreen() {
  const { showSuccess, showError } = useToast();
  const canRecord = useAuthStore((s) => s.hasRole(FREIGHT_DISPATCH_RECORDER));
  const st = useKarenFreightDispatchStore();

  useEffect(() => {
    if (!canRecord) return;
    if (st.vehicles.length === 0 && !st.loading && !st.error) st.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRecord]);

  const onCaptureDocket = useCallback(() => {
    setCaptureResultCallback((uri) => {
      void useKarenFreightDispatchStore.getState().uploadDocket(uri);
    });
    router.push('/camera-capture' as never);
  }, []);

  const run = async (action: () => Promise<{ kind: string; message: string }>) => {
    const outcome = await action();
    if (outcome.kind === 'ok') showSuccess(outcome.message);
    else showError(outcome.message);
  };

  const trip = st.trip;
  const remaining = st.deliveryPoints.filter((p) => !st.dropOffPoints.includes(p)).length;

  if (!canRecord) {
    return (
      <Screen title="Freight Dispatch">
        <Card>
          <Text style={s.denied}>
            You need the <Text style={s.deniedRole}>{FREIGHT_DISPATCH_RECORDER}</Text> role to use
            this page.
          </Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen
      title="Freight Dispatch"
      loading={st.loading && st.vehicles.length === 0}
      error={st.vehicles.length === 0 ? st.error : null}
      onRetry={st.load}
      onRefresh={st.load}
    >
      {/* ── No trip: start one ─────────────────────────────────────── */}
      {!trip ? (
        <Card>
          <Text style={s.section}>START TRIP</Text>
          <Text style={s.help}>
            Departure time is stamped when you tap Depart — capture the docket first.
          </Text>
          <View style={{ height: 12 }} />
          <Dropdown
            label="Vehicle"
            iconName="truck-outline"
            value={st.vehicle}
            options={st.vehicles}
            placeholder="Pick vehicle"
            onChange={st.setVehicle}
          />
          <View style={{ height: 12 }} />
          <Dropdown
            label="Drop off points"
            iconName="warehouse"
            // Always blank so the field keeps reading as "add another" rather
            // than showing the last pick as if it were the only one.
            value=""
            options={st.deliveryPoints
              .filter((p) => !st.dropOffPoints.includes(p))
              .map((p) => ({ label: p, value: p }))}
            placeholder={
              remaining === 0 ? 'All points added' : 'Add a drop off point'
            }
            disabled={remaining === 0}
            onChange={st.addDropOffPoint}
          />
          {st.dropOffPoints.length > 0 ? (
            <View style={s.pointList}>
              {st.dropOffPoints.map((p, i) => (
                <View key={p} style={[s.pointRow, i > 0 && s.pointDivider]}>
                  <Text style={s.pointIndex}>{i + 1}</Text>
                  <Text style={s.pointName}>{p}</Text>
                  {i === 0 ? <Text style={s.pointTag}>freight agent</Text> : null}
                  <Pressable onPress={() => st.removeDropOffPoint(p)} hitSlop={8}>
                    <Ionicons name="close" size={16} color={COLORS.textMuted} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : (
            <Text style={s.help}>Add every point this run serves.</Text>
          )}
          <View style={{ height: 12 }} />
          <LabeledInput
            label="Truck temperature (°C)"
            iconName="thermometer"
            value={st.truckTemp}
            onChangeText={st.setTruckTemp}
            keyboardType="numbers-and-punctuation"
            placeholder="0"
          />
          <View style={s.docketRow}>
            <Pressable onPress={onCaptureDocket} style={s.docketBtn}>
              {st.docketUri ? (
                <>
                  <Image source={{ uri: st.docketUri }} style={s.docketThumb} />
                  {st.docketUploading ? (
                    <View style={s.thumbOverlay}>
                      <Spinner inline />
                    </View>
                  ) : null}
                  {st.docketError ? (
                    <View style={[s.thumbOverlay, s.thumbOverlayError]}>
                      <Ionicons name="alert" size={18} color="#FFFFFF" />
                    </View>
                  ) : null}
                </>
              ) : (
                <Ionicons name="camera-outline" size={22} color={COLORS.textMuted} />
              )}
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={s.docketLabel}>Docket photo</Text>
              <Text style={s.docketHint}>
                {st.docketError
                  ? st.docketError
                  : st.docketUrl
                    ? 'Captured — tap to retake.'
                    : 'Required. Tap to capture.'}
              </Text>
            </View>
          </View>

          <Button
            label={st.busy ? 'Departing…' : 'Depart farm'}
            iconLeft="arrow-forward"
            onPress={() => run(st.depart)}
            loading={st.busy}
          />
        </Card>
      ) : null}

      {/* ── Trip in progress ───────────────────────────────────────── */}
      {trip ? (
        <>
          <Card>
            <Text style={s.section}>{trip.name}</Text>
            <Text style={s.statusLine}>{trip.status}</Text>
            <View style={{ height: 8 }} />
            <Fact label="Vehicle" value={trip.vehicle ?? '—'} />
            <Fact
              label="Drop off points"
              value={(trip.drop_off_points ?? []).join(', ') || trip.freight_agent || '—'}
            />
            <Fact label="Truck temp" value={`${trip.truck_temperature ?? 0} °C`} />
            <Fact label="Left farm" value={hhmm(trip.farm_departure_time)} />
            {trip.freight_arrival_time ? (
              <Fact label="Reached agent" value={hhmm(trip.freight_arrival_time)} />
            ) : null}
            {trip.time_taken_from_farm ? (
              <Fact label="Time from farm" value={trip.time_taken_from_farm} />
            ) : null}
          </Card>

          {trip.status === 'In Transit' ? (
            <Card>
              <Text style={s.section}>ON THE ROAD</Text>
              <Text style={s.help}>Tap when you reach {trip.freight_agent ?? 'the agent'}.</Text>
              <View style={{ height: 12 }} />
              <Button
                label={st.busy ? 'Saving…' : 'Arrived at agent'}
                iconLeft="flag"
                onPress={() => run(st.arrive)}
                loading={st.busy}
              />
            </Card>
          ) : null}

          {trip.status === 'At Agent' ? (
            <>
              <Card>
                <Text style={s.section}>OFFLOADS ({trip.offloads?.length ?? 0})</Text>
                {(trip.offloads ?? []).length === 0 ? (
                  <Text style={s.help}>No customers offloaded yet.</Text>
                ) : (
                  (trip.offloads ?? []).map((o, i) => (
                    <View key={i} style={[s.offloadRow, i > 0 && s.offloadDivider]}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.offloadCustomer}>{o.customer}</Text>
                        <Text style={s.offloadMeta}>
                          {o.delivery_point ? `${o.delivery_point} · ` : ''}
                          {hhmm(o.start_offloading)} · {o.boxes_delivered} boxes · max{' '}
                          {o.max_temperature} °C
                        </Text>
                      </View>
                    </View>
                  ))
                )}
              </Card>

              <Card>
                <Text style={s.section}>RECORD OFFLOAD</Text>
                <Text style={s.help}>The time is stamped when you tap Record.</Text>
                <View style={{ height: 12 }} />
                <Dropdown
                  label="Drop off point"
                  iconName="map-marker-outline"
                  value={st.offloadPoint}
                  options={(trip.drop_off_points ?? []).map((p) => ({ label: p, value: p }))}
                  placeholder="Where are you offloading?"
                  searchable={false}
                  onChange={st.setOffloadPoint}
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
                <View style={{ height: 12 }} />
                <View style={s.row}>
                  <View style={{ flex: 1 }}>
                    <LabeledInput
                      label="Boxes"
                      iconName="package-variant-closed"
                      value={st.boxes}
                      onChangeText={st.setBoxes}
                      keyboardType="number-pad"
                      placeholder="0"
                    />
                  </View>
                  <View style={{ width: 12 }} />
                  <View style={{ flex: 1 }}>
                    <LabeledInput
                      label="Max temp (°C)"
                      iconName="thermometer"
                      value={st.maxTemp}
                      onChangeText={st.setMaxTemp}
                      keyboardType="numbers-and-punctuation"
                      placeholder="0"
                    />
                  </View>
                </View>
                <Button
                  label={st.busy ? 'Recording…' : 'Record offload'}
                  iconLeft="add"
                  variant="outline"
                  onPress={() => run(st.offload)}
                  loading={st.busy}
                />
              </Card>

              <Card>
                <Text style={s.section}>FINISH</Text>
                <Text style={s.help}>
                  Tap when the truck leaves the agent. This stamps the departure time and closes the
                  trip.
                </Text>
                <View style={{ height: 12 }} />
                <Button
                  label={st.busy ? 'Saving…' : 'Depart agent'}
                  iconLeft="checkmark-done"
                  onPress={() => run(st.departAgent)}
                  loading={st.busy}
                />
              </Card>
            </>
          ) : null}
        </>
      ) : null}
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
  statusLine: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: COLORS.text, marginTop: 2 },
  help: { fontSize: 12, color: COLORS.textMuted, marginTop: 4 },
  denied: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  deniedRole: { fontFamily: fontFamily.semiBold, color: COLORS.text },
  pointList: {
    marginTop: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.md,
  },
  pointRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  pointDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  pointIndex: {
    width: 16,
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: COLORS.textMuted,
  },
  pointName: { flex: 1, fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: COLORS.text },
  pointTag: {
    fontFamily: fontFamily.regular,
    fontSize: 10,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  row: { flexDirection: 'row', alignItems: 'flex-end' },
  fact: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
  },
  factLabel: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: COLORS.textMuted },
  factValue: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: COLORS.text },
  docketRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  docketBtn: {
    width: 56,
    height: 56,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  docketThumb: { width: 56, height: 56 },
  docketLabel: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.text },
  docketHint: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: COLORS.textMuted, marginTop: 2 },
  thumbOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  thumbOverlayError: { backgroundColor: 'rgba(220,38,38,0.85)' },
  offloadRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  offloadDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  offloadCustomer: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.text },
  offloadMeta: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: COLORS.textMuted, marginTop: 2 },
});
