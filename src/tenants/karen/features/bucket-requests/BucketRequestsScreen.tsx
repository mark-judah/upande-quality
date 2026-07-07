import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert as RNAlert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/src/core/ui/Screen';
import { Card, Alert } from '@/src/core/ui/Card';
import { Button } from '@/src/core/ui/Button';
import { Segmented } from '@/src/core/ui/Segmented';
import { ScanField, type ScanFieldHandle } from '@/src/core/scanning/ScanField';
import { focusWhenReady } from '@/src/core/scanning/focus';
import { useToast } from '@/src/core/ui/Toast';
import { borderRadius, COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';
import {
  useKarenBucketRequestsStore,
  type OrderGroup,
  type TrolleyOpl,
} from '@/src/tenants/karen/state/karen-bucket-requests-store';
import type { ReqOpl, ReqBucket } from '@/src/tenants/karen/offline/bucket-requests-db';

type Tab = 'requests' | 'trolley';

export function KarenBucketRequestsScreen({ userFarm }: { userFarm: string }) {
  const trolleyRef = useRef<ScanFieldHandle>(null);
  const bucketRef = useRef<ScanFieldHandle>(null);
  const { showSuccess, showError } = useToast();
  const [tab, setTab] = useState<Tab>('requests');
  const [refreshing, setRefreshing] = useState(false);

  const {
    ready,
    error,
    requests,
    trolley,
    reqCount,
    trolleyCount,
    activeTrolleyId,
    online,
    downloading,
    init,
    refresh,
    download,
    setTrolleyFromScan,
    clearActiveTrolley,
    scanBucketFromScan,
    clearAll,
  } = useKarenBucketRequestsStore();

  useEffect(() => {
    init();
  }, [init]);

  useFocusEffect(
    useCallback(() => {
      focusWhenReady(activeTrolleyId ? bucketRef : trolleyRef);
    }, [activeTrolleyId]),
  );
  useEffect(() => {
    focusWhenReady(activeTrolleyId ? bucketRef : trolleyRef);
  }, [activeTrolleyId]);

  const onTrolleyScan = (raw: string) => {
    const r = setTrolleyFromScan(raw);
    if (!r.ok) {
      showError(r.message ?? 'Invalid trolley QR.');
      trolleyRef.current?.clear();
      focusWhenReady(trolleyRef);
    } else {
      showSuccess(`Trolley ${r.trolleyId}`);
      trolleyRef.current?.clear();
    }
  };

  const onBucketScan = async (raw: string) => {
    const r = await scanBucketFromScan(raw);
    if (r.ok) showSuccess(r.message);
    else showError(r.message);
    bucketRef.current?.clear();
    focusWhenReady(bucketRef);
  };

  const onDownload = async () => {
    const r = await download(userFarm);
    if (r.ok) showSuccess(r.message);
    else showError(r.message);
  };

  const onClear = () => {
    RNAlert.alert(
      'Clear downloaded data?',
      'This removes all downloaded picklists, scans and trolleys from this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            await clearAll();
            showSuccess('Cleared.');
          },
        },
      ],
    );
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  if (!ready && error) {
    return (
      <Screen title="Bucket Requests" scroll={false}>
        <Alert tone="danger">{error}</Alert>
        <Card>
          <Button label="Retry" iconLeft="refresh" onPress={() => init()} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen title="Bucket Requests" scroll={false}>
      <ScrollView
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.text} />
        }
      >
        <View style={s.topRow}>
          <View style={{ flex: 1 }}>
            <Button
              label={downloading ? 'Downloading…' : 'Download picklists'}
              iconLeft="cloud-download-outline"
              onPress={onDownload}
              loading={downloading}
              disabled={downloading}
            />
          </View>
          <Pressable style={s.clearBtn} hitSlop={8} onPress={onClear}>
            <Ionicons name="trash-outline" size={16} color={COLORS.danger ?? '#EF4444'} />
          </Pressable>
        </View>
        {!online ? (
          <Text style={s.offline}>Offline — you can still scan; downloads need internet.</Text>
        ) : null}

        <Card>
          <View style={s.scanRow}>
            <View style={s.scanField}>
              <Text style={s.scanLabel}>1 · Trolley</Text>
              <ScanField
                ref={trolleyRef}
                onScan={onTrolleyScan}
                autoFocus={!activeTrolleyId}
                placeholder="Scan trolley QR"
                value={activeTrolleyId ?? undefined}
                editable={!activeTrolleyId}
              />
              {activeTrolleyId ? (
                <Pressable
                  onPress={() => {
                    clearActiveTrolley();
                    focusWhenReady(trolleyRef);
                  }}
                  hitSlop={8}
                  style={s.changeRow}
                >
                  <Ionicons name="swap-horizontal" size={14} color={COLORS.text} />
                  <Text style={s.changeLink}>Change trolley</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={s.scanField}>
              <Text style={s.scanLabel}>2 · Bucket</Text>
              <ScanField
                ref={bucketRef}
                onScan={onBucketScan}
                autoFocus={!!activeTrolleyId}
                placeholder={activeTrolleyId ? 'Scan bucket QR' : 'Scan trolley first'}
                editable={!!activeTrolleyId}
              />
            </View>
          </View>
        </Card>

        <Segmented
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          options={[
            { value: 'requests', label: `Requests (${reqCount})` },
            { value: 'trolley', label: `Trolley (${trolleyCount})` },
          ]}
        />

        {tab === 'requests' ? (
          <RequestsTab groups={requests} />
        ) : (
          <TrolleyTab items={trolley} />
        )}
      </ScrollView>
    </Screen>
  );
}

function RequestsTab({ groups }: { groups: OrderGroup[] }) {
  if (!groups.length) {
    return (
      <Card>
        <View style={s.empty}>
          <Ionicons name="download-outline" size={26} color={COLORS.textMuted} />
          <Text style={s.emptyTitle}>No picklists</Text>
          <Text style={s.emptyHint}>Tap “Download picklists” while online to load your orders.</Text>
        </View>
      </Card>
    );
  }
  return (
    <>
      {groups.map((g) => (
        <View key={g.orderName}>
          <Text style={s.groupHdr}>{g.orderName}</Text>
          {g.opls.map((o) => (
            <OplCard key={o.oplName} opl={o} />
          ))}
        </View>
      ))}
    </>
  );
}

function OplCard({ opl }: { opl: ReqOpl }) {
  const pct = opl.total > 0 ? Math.round((opl.scanned / opl.total) * 100) : 0;
  return (
    <Card>
      <View style={s.oplHead}>
        <View style={{ flex: 1 }}>
          <Text style={s.oplDate}>{opl.createdOn || '—'}</Text>
          <Text style={s.oplMeta}>
            {opl.scanned}/{opl.total} scanned
          </Text>
        </View>
        <Text style={s.pct}>{pct}%</Text>
      </View>
      <View style={s.track}>
        <View style={[s.fill, { width: `${pct}%` }]} />
      </View>
      <View style={s.divider} />
      {opl.buckets.map((b) => (
        <View key={b.id} style={s.bRow}>
          <Ionicons
            name={b.scanned ? 'checkmark-circle' : 'ellipse-outline'}
            size={18}
            color={b.scanned ? (COLORS.success ?? '#12B76A') : COLORS.textMuted}
          />
          <View style={{ flex: 1 }}>
            <Text style={s.bId}>{b.bucketId}</Text>
            <Text style={s.bMeta} numberOfLines={1}>
              {b.variety}
              {b.shelf ? ` · ${b.shelf}` : ''}
            </Text>
          </View>
          <Text style={s.bQty}>
            {Math.round(b.qty)} {b.uom}
          </Text>
        </View>
      ))}
    </Card>
  );
}

function TrolleyTab({ items }: { items: TrolleyOpl[] }) {
  if (!items.length) {
    return (
      <Card>
        <View style={s.empty}>
          <Ionicons name="cart-outline" size={26} color={COLORS.textMuted} />
          <Text style={s.emptyTitle}>No completed orders</Text>
          <Text style={s.emptyHint}>Fully-scanned orders appear here with their trolley.</Text>
        </View>
      </Card>
    );
  }
  return (
    <>
      {items.map((o) => (
        <Card key={o.oplName}>
          <View style={s.oplHead}>
            <View style={{ flex: 1 }}>
              <Text style={s.bId}>{o.orderName}</Text>
              <Text style={s.oplMeta}>
                {o.createdOn} · trolley {o.trolleys.join(', ') || '—'}
              </Text>
            </View>
            <View style={s.badge}>
              <Text style={s.badgeTxt}>{o.buckets.length}</Text>
            </View>
          </View>
          <View style={s.divider} />
          {o.buckets.map((b: ReqBucket) => (
            <View key={b.id} style={s.bRow}>
              <Ionicons name="checkmark-circle" size={16} color={COLORS.success ?? '#12B76A'} />
              <View style={{ flex: 1 }}>
                <Text style={s.bId}>{b.bucketId}</Text>
                <Text style={s.bMeta} numberOfLines={1}>
                  {b.variety}
                  {b.shelf ? ` · ${b.shelf}` : ''}
                </Text>
              </View>
              <Text style={s.bQty}>{b.trolleyId || ''}</Text>
            </View>
          ))}
        </Card>
      ))}
    </>
  );
}

const s = StyleSheet.create({
  scroll: { paddingBottom: 40 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  clearBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceAlt,
  },
  offline: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: COLORS.textMuted,
    marginBottom: spacing.sm,
  },
  scanRow: { flexDirection: 'row', gap: spacing.sm },
  scanField: { flex: 1 },
  scanLabel: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: spacing.xs,
  },
  changeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.xs,
    alignSelf: 'flex-end',
  },
  changeLink: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: COLORS.text },
  groupHdr: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.sm,
    color: COLORS.text,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    marginLeft: spacing.xs,
  },
  oplHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  oplDate: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.text },
  oplMeta: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: COLORS.textMuted },
  pct: { fontFamily: fontFamily.bold, fontSize: fontSize.md, color: COLORS.text },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.surfaceAlt,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  fill: { height: 6, backgroundColor: COLORS.text },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginVertical: spacing.sm,
  },
  bRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  bId: { fontFamily: 'monospace', fontSize: fontSize.sm, color: COLORS.text, fontWeight: '700' },
  bMeta: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: COLORS.textSecondary },
  bQty: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: COLORS.textSecondary },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    backgroundColor: COLORS.text,
  },
  badgeTxt: { fontFamily: fontFamily.bold, fontSize: 11, color: COLORS.textOnPrimary ?? '#fff' },
  empty: { alignItems: 'center', paddingVertical: spacing.lg, gap: spacing.xs },
  emptyTitle: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: COLORS.text },
  emptyHint: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
});
