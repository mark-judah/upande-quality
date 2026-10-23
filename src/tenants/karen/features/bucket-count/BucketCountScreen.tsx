import { useEffect, useRef } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Screen } from '@/src/core/ui/Screen';
import { Card, Alert } from '@/src/core/ui/Card';
import { Dropdown } from '@/src/core/ui/Dropdown';
import { Button } from '@/src/core/ui/Button';
import { ScanField, type ScanFieldHandle } from '@/src/core/scanning/ScanField';
import { focusWhenReady } from '@/src/core/scanning/focus';
import { useToast } from '@/src/core/ui/Toast';
import { useKarenBucketCountStore } from '@/src/tenants/karen/state/karen-bucket-count-store';
import type { BucketCountScanRow } from '@/src/tenants/karen/offline/karen-bucket-count-db';
import { COLORS, fontFamily, scaleFont } from '@/src/core/theme';

/** Count empty buckets per farm and location (Packhouse, Washing Area,
 *  Greenhouse, Coldroom, ...) — modeled on Shelf Operations' Stock Take tab,
 *  but its own screen: a materially different workflow (no shelf involved),
 *  farm from the device's own station config, not a per-screen picker. */
export function KarenBucketCountScreen({ userFarm }: { userFarm: string }) {
  const bucketRef = useRef<ScanFieldHandle>(null);
  const {
    locations,
    locationsLoading,
    location,
    scans,
    pending,
    syncing,
    syncProgress,
    syncError,
    init,
    loadLocations,
    setLocation,
    scanBucket,
    refreshScans,
    syncBucketCount,
    reset,
  } = useKarenBucketCountStore();
  const { showError, showSuccess } = useToast();

  useEffect(() => {
    init();
    loadLocations();
    return () => reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (location) refreshScans(userFarm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, userFarm]);

  useEffect(() => {
    if (location) focusWhenReady(bucketRef);
  }, [location]);

  // No success toast per scan, deliberately — mirrors Stock Take: this needs
  // to stay fast through many scans, and the running list below is already
  // the per-scan feedback. Only a bad scan interrupts with a toast.
  const onBucketScan = async (raw: string) => {
    const result = await scanBucket(userFarm, raw);
    if (!result.ok) {
      showError(result.message ?? 'Invalid bucket QR.');
    }
    bucketRef.current?.clear();
    focusWhenReady(bucketRef);
  };

  const onSync = async () => {
    await syncBucketCount(userFarm);
    const err = useKarenBucketCountStore.getState().syncError;
    if (err) showError(err);
    else showSuccess('Synced.');
  };

  return (
    <Screen title="Bucket Count" scroll={false}>
      <View style={s.farmBanner}>
        <View style={s.farmBannerFarm}>
          <MaterialCommunityIcons name="map-marker" size={18} color={COLORS.textMuted} />
          <Text style={s.farmBannerValue} numberOfLines={1}>
            {userFarm || 'All farms'}
          </Text>
        </View>
      </View>

      <View style={s.flexCol}>
        {/* Outside the FlatList, not in ListHeaderComponent — same reason as
         *  Stock Take's Cold Store/Bucket cards: removeClippedSubviews below
         *  can detach and recreate the native TextInput as the list
         *  scrolls/re-renders, and a hardware (Honeywell-style HID) scanner's
         *  keystrokes land on whatever native view currently holds focus. */}
        <Card title="Location">
          <Dropdown
            label="Location"
            iconName="map-marker-outline"
            value={location ?? ''}
            options={locations.map((l) => ({ label: l, value: l }))}
            placeholder={locationsLoading ? 'Loading…' : 'Pick location'}
            disabled={locationsLoading}
            onChange={setLocation}
          />
        </Card>

        <Card title="Bucket">
          <ScanField
            ref={bucketRef}
            onScan={onBucketScan}
            autoFocus={!!location}
            placeholder={location ? 'Scan bucket QR' : 'Pick the location first'}
            editable={!!location}
          />
        </Card>

        {location ? (
          <Card title="Sync">
            <View style={s.syncRow}>
              <Text style={s.syncCount}>
                {pending} bucket{pending === 1 ? '' : 's'} not yet synced
              </Text>
              <Button
                label={syncing ? 'Syncing…' : syncError ? 'Retry sync' : 'Sync'}
                onPress={onSync}
                loading={syncing}
                disabled={syncing || pending === 0}
              />
            </View>
            {syncProgress ? (
              <Text style={s.muted}>
                Syncing {syncProgress.done} of {syncProgress.total}…
              </Text>
            ) : null}
            {syncError ? <Alert tone="danger">{syncError}</Alert> : null}
          </Card>
        ) : null}

        <FlatList<BucketCountScanRow>
          style={s.flex}
          data={scans}
          keyExtractor={(row) => String(row.id)}
          renderItem={({ item }) => <BucketCountScanRowView row={item} />}
          initialNumToRender={20}
          windowSize={7}
          removeClippedSubviews
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            scans.length ? <Text style={s.logHeader}>Counted ({scans.length})</Text> : null
          }
        />
      </View>
    </Screen>
  );
}

function BucketCountScanRowView({ row }: { row: BucketCountScanRow }) {
  if (!row.synced) {
    return (
      <View style={s.scanRow}>
        <Text style={s.bucketId}>{row.bucketId}</Text>
        <Text style={[s.status, { color: COLORS.textMuted }]}>{row.location} — pending sync</Text>
      </View>
    );
  }
  if (row.syncError) {
    return (
      <View style={s.scanRow}>
        <Text style={s.bucketId}>{row.bucketId}</Text>
        <Text style={[s.status, { color: COLORS.danger }]}>{row.syncError}</Text>
      </View>
    );
  }
  return (
    <View style={s.scanRow}>
      <View style={s.headerRow}>
        <Text style={s.bucketId}>{row.bucketId}</Text>
        <Text style={[s.status, { color: COLORS.success }]}>{row.serverLocation}</Text>
      </View>
      {row.warning === 'already_in_use' ? (
        <Text style={s.warningDetail}>Not actually empty — this bucket is currently In Use.</Text>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  flexCol: { flex: 1, flexDirection: 'column' },
  farmBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  farmBannerFarm: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  farmBannerValue: { fontFamily: fontFamily.bold, fontSize: scaleFont(15), color: COLORS.text, flexShrink: 1 },
  syncRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  syncCount: { fontFamily: fontFamily.regular, fontSize: scaleFont(13), color: COLORS.text, flexShrink: 1 },
  muted: { fontFamily: fontFamily.regular, fontSize: scaleFont(12), color: COLORS.textMuted, marginTop: 8 },
  logHeader: {
    fontFamily: fontFamily.bold,
    fontSize: scaleFont(12),
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  scanRow: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  bucketId: { fontFamily: fontFamily.bold, fontSize: scaleFont(14), color: COLORS.text },
  status: { fontFamily: fontFamily.semiBold, fontSize: scaleFont(13), flexShrink: 1, textAlign: 'right' },
  warningDetail: { fontFamily: fontFamily.regular, fontSize: scaleFont(12), color: COLORS.warn, marginTop: 2 },
});
