import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/src/core/ui/Card';
import { Button } from '@/src/core/ui/Button';
import { Dialog, DialogList, DialogRow } from '@/src/core/ui/Dialog';
import { borderRadius, COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';
import type { TrolleyOpl } from '@/src/tenants/karen/offline/bucket-requests-db';
import type { CompletedTrip } from '@/src/tenants/karen/repository/karen-bucket-requests-repository';
import type { LineColor } from './line-colors';

/** "Completed": what this farm has finished — trips the truck has left the farm on,
 *  and picklists that are on a trolley, loaded or on the road. A trip that left before
 *  every planned bucket was loaded can be reopened (with confirmation). */
export function CompletedView({
  farm,
  deliveryDate,
  trips: allTrips,
  loading,
  trolley,
  inTransit,
  oplLine,
  onReopen,
}: {
  farm: string;
  /** Delivery date on screen ('' = every date): trips show only that date's orders. */
  deliveryDate: string;
  trips: CompletedTrip[];
  loading: boolean;
  trolley: TrolleyOpl[];
  inTransit: TrolleyOpl[];
  oplLine: Record<string, LineColor>;
  onReopen: (trip: CompletedTrip) => Promise<void>;
}) {
  // A trip can carry several days' orders: keep the ones for the date on screen and
  // count planned / loaded / left behind from them.
  const trips = allTrips
    .map((t) => {
      const orders = t.orders.filter((o) => !deliveryDate || !o.deliveryDate || o.deliveryDate === deliveryDate);
      const planned = orders.reduce((n, o) => n + o.buckets, 0);
      const loaded = orders.reduce((n, o) => n + o.loaded, 0);
      return deliveryDate ? { ...t, orders, planned, loaded, leftBehind: Math.max(0, planned - loaded) } : t;
    })
    .filter((t) => t.orders.length > 0);
  const onTrolley = trolley.filter((o) => !o.loadedToTruck);
  const loaded = trolley.filter((o) => o.loadedToTruck);
  const onRoad = inTransit.filter((o) => !o.arrived);
  const arrived = inTransit.filter((o) => o.arrived);
  const tiles: { label: string; count: number; icon: keyof typeof Ionicons.glyphMap }[] = [
    { label: 'Trips', count: trips.length, icon: 'bus-outline' },
    { label: 'Requests', count: trolley.length + inTransit.length, icon: 'document-text-outline' },
    { label: 'Trolley', count: trolley.length, icon: 'cart-outline' },
    { label: 'In transit', count: inTransit.length, icon: 'car-outline' },
  ];
  const done = [
    ...onTrolley.map((o) => ({ o, state: 'On trolley' })),
    ...loaded.map((o) => ({ o, state: 'Loaded on truck' })),
    ...onRoad.map((o) => ({ o, state: 'In transit' })),
    ...arrived.map((o) => ({ o, state: 'Arrived' })),
  ];

  return (
    <>
      <View style={s.tiles}>
        {tiles.map((t) => (
          <View key={t.label} style={s.tile}>
            <Ionicons name={t.icon} size={16} color={COLORS.textMuted} />
            <Text style={s.tileCount}>{t.count}</Text>
            <Text style={s.tileLabel}>{t.label}</Text>
          </View>
        ))}
      </View>

      <Text style={s.section}>Trips that left {farm || 'this farm'}</Text>
      {loading && !trips.length ? (
        <ActivityIndicator style={{ marginVertical: spacing.md }} color={COLORS.text} />
      ) : !trips.length ? (
        <Card>
          <Text style={s.empty}>No completed trips in the last few days.</Text>
        </Card>
      ) : (
        trips.map((t) => <TripDone key={t.tripId} trip={t} farm={farm} oplLine={oplLine} onReopen={onReopen} />)
      )}

      <Text style={s.section}>Requests completed</Text>
      {!done.length ? (
        <Card>
          <Text style={s.empty}>No completed picklists on this device.</Text>
        </Card>
      ) : (
        <Card>
          {done.map(({ o, state }) => (
            <View
              key={o.oplName}
              style={s.row}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.rowTitle} numberOfLines={1}>
                  {o.orderName}
                </Text>
                <Text style={s.rowMeta} numberOfLines={1}>
                  {[o.customer, `${o.buckets.length} bkt`, o.trolleys.length ? `trolley ${o.trolleys.join(', ')}` : '']
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              <Text style={s.state}>{state}</Text>
            </View>
          ))}
        </Card>
      )}
    </>
  );
}

function TripDone({
  trip,
  farm,
  oplLine,
  onReopen,
}: {
  trip: CompletedTrip;
  farm: string;
  oplLine: Record<string, LineColor>;
  onReopen: (trip: CompletedTrip) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Left behind per order (as the server counts it): a stop that sent every planned
  // bucket is complete and never offers Reopen.
  const leftBehind = trip.orders.length
    ? trip.orders.reduce((n, o) => n + Math.max(0, o.buckets - o.loaded), 0)
    : trip.leftBehind;
  const short = leftBehind > 0;
  // Reopen while the truck is still on its run, or while no other trip carries the rest yet.
  const canReopen = short && (trip.stopReopenable || !trip.carriedTo.length);

  const confirm = () => setConfirmOpen(true);
  const n = `${leftBehind} bucket${leftBehind === 1 ? '' : 's'}`;
  const doReopen = async () => {
    setBusy(true);
    await onReopen(trip);
    setBusy(false);
    setConfirmOpen(false);
  };

  const where =
    trip.status === 'Received' ? 'received at packhouse' : trip.status === 'Dispatched' ? 'dispatched' : 'left the farm';

  return (
    <Card>
      <View style={s.head}>
        <View style={s.truck}>
          <Ionicons name="car" size={16} color={COLORS.text} />
          <Text style={s.truckText} numberOfLines={1}>
            {trip.vehicle}
            {trip.run ? ` · run ${trip.run}${trip.runs ? ` of ${trip.runs}` : ''}` : ''}
          </Text>
        </View>
        <View style={[s.pill, short ? s.pillShort : s.pillDone]}>
          <Text style={[s.pillText, short ? s.pillTextShort : s.pillTextDone]}>
            {short ? `${leftBehind} left behind` : 'All loaded'}
          </Text>
        </View>
      </View>
      <Text style={s.rowMeta}>
        {trip.tripId} · {where}
        {trip.leftAt ? ` · ${trip.leftAt.slice(0, 16)}` : ''}
      </Text>
      <Text style={s.loadedLine}>
        {trip.loaded}/{trip.planned} buckets loaded from {farm}
      </Text>

      <View style={s.divider} />
      {trip.orders.map((o) => (
        <View
          key={`${trip.tripId}-${o.opl}`}
          style={s.row}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.rowTitle} numberOfLines={1}>
              {o.orderName}
            </Text>
            <Text style={s.rowMeta} numberOfLines={1}>
              {[o.customer, o.varieties].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <Text style={[s.state, o.loaded < o.buckets ? s.stateShort : null]}>
            {o.loaded}/{o.buckets}
          </Text>
        </View>
      ))}

      {short && trip.carriedTo.length ? (
        <Text style={s.carried}>Left-behind buckets are on {trip.carriedTo.join(', ')}.</Text>
      ) : null}
      {canReopen ? (
        <Pressable onPress={confirm} disabled={busy} style={s.reopen}>
          {busy ? (
            <ActivityIndicator size="small" color={COLORS.text} />
          ) : (
            <>
              <Ionicons name="refresh" size={15} color={COLORS.text} />
              <Text style={s.reopenText}>Reopen</Text>
            </>
          )}
        </Pressable>
      ) : null}
      <Dialog
        visible={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        busy={busy}
        icon={{ name: 'refresh', tone: 'warn' }}
        title={trip.stopReopenable ? 'Reopen this stop?' : 'Move to the next trip?'}
        subtitle={
          trip.stopReopenable
            ? `${trip.vehicle} left ${farm} with ${n} not loaded. Reopen the stop so the truck can collect them on this trip.`
            : `${trip.vehicle} has gone to the packhouse without ${n}. Move them to the truck's next trip so they can be picked and loaded.`
        }
        actions={
          <>
            <Button label="Cancel" variant="outline" onPress={() => setConfirmOpen(false)} disabled={busy} style={{ flex: 1 }} />
            <Button
              label={trip.stopReopenable ? 'Reopen stop' : 'Move to next trip'}
              iconLeft="refresh"
              onPress={doReopen}
              loading={busy}
              style={{ flex: 1 }}
            />
          </>
        }
      >
        <DialogList>
          <DialogRow label="Truck" value={trip.vehicle} />
          <DialogRow label="Trip" value={trip.tripId} />
          <DialogRow label="Not loaded" value={n} />
        </DialogList>
      </Dialog>
    </Card>
  );
}

const s = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  tile: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: COLORS.surfaceAlt,
  },
  tileCount: { fontFamily: fontFamily.bold, fontSize: fontSize.lg, color: COLORS.text },
  tileLabel: { fontFamily: fontFamily.medium, fontSize: 11, color: COLORS.textMuted },
  section: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: COLORS.textMuted,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  empty: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: COLORS.textMuted },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  truck: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  truckText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: COLORS.text },
  pill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: borderRadius.full },
  pillDone: { backgroundColor: COLORS.surfaceAlt },
  pillShort: { backgroundColor: '#FEF3F2' },
  pillText: { fontFamily: fontFamily.semiBold, fontSize: 11 },
  pillTextDone: { color: COLORS.text },
  pillTextShort: { color: COLORS.danger },
  loadedLine: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.text, marginTop: 4 },
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 5, paddingLeft: 8 },
  rowTitle: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.text },
  rowMeta: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: COLORS.textMuted },
  state: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: COLORS.text },
  stateShort: { color: COLORS.danger },
  carried: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: COLORS.textMuted, marginTop: spacing.xs },
  reopen: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.sm,
    paddingVertical: 8,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  reopenText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.text },
});
