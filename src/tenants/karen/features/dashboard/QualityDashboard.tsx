import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { addDays, format, parseISO } from 'date-fns';
import { borderRadius, COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';
import { useNetworkStore } from '@/src/core/network/store';
import { Dropdown } from '@/src/core/ui/Dropdown';
import {
  todayISO,
  useKarenDashboardStore,
  type DashboardBar,
  type DashboardFarm,
} from '@/src/tenants/karen/state/karen-dashboard-store';

/**
 * Quality home dashboard — same hero/tile/variance-card/list-row layout and
 * colour language as the Packhouse app's PackhouseDashboard, showing the desk
 * Quality Dashboard's Intake FTR Overview figures for one day.
 */

const HERO_BG = '#052E16';
const HERO_ACCENT = '#0A4A22';
const DARK_A = '#171717';
const DARK_B = '#1C1917';
const DARK_ISSUE_ACTIVE = '#3B0A0A';

function pctText(v: number | null): string {
  return v === null ? '–' : `${v.toFixed(2)}%`;
}

function CollapsibleSection({
  label,
  count,
  defaultOpen,
  children,
}: {
  label: string;
  count?: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={s.collapsible}>
      <Pressable style={s.collapsibleHeader} onPress={() => setOpen((v) => !v)}>
        <Text style={s.sectionLabel}>{label}</Text>
        <View style={s.collapsibleHeaderRight}>
          {count ? <Text style={s.sectionCount}>{count}</Text> : null}
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.textMuted} />
        </View>
      </Pressable>
      {open ? children : null}
    </View>
  );
}

function DayStepper({ value, onChange }: { value: string; onChange: (date: string) => void }) {
  const today = todayISO();
  const isToday = value >= today;
  const step = (days: number) => onChange(format(addDays(parseISO(value), days), 'yyyy-MM-dd'));
  return (
    <View style={s.stepper}>
      <Pressable hitSlop={8} style={s.stepperBtn} onPress={() => step(-1)}>
        <Ionicons name="chevron-back" size={18} color={COLORS.text} />
      </Pressable>
      <Pressable hitSlop={8} onPress={() => !isToday && onChange(today)}>
        <Text style={s.stepperLabel}>{isToday ? 'Today' : format(parseISO(value), 'EEE d MMM yyyy')}</Text>
      </Pressable>
      <Pressable hitSlop={8} style={s.stepperBtn} disabled={isToday} onPress={() => step(1)}>
        <Ionicons name="chevron-forward" size={18} color={isToday ? COLORS.border : COLORS.text} />
      </Pressable>
    </View>
  );
}

function KpiTile({
  chip,
  value,
  unit,
  bg,
  route,
}: {
  chip: string;
  value: string;
  unit: string;
  bg: string;
  route: string;
}) {
  const router = useRouter();
  return (
    <Pressable
      style={({ pressed }) => [s.tile, { backgroundColor: bg }, pressed && { opacity: 0.85 }]}
      onPress={() => router.push(`/${route}` as never)}
    >
      <Text style={s.tileChip}>{chip}</Text>
      <Text style={s.tileNumber} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
        {value}
      </Text>
      <Text style={s.tileUnit} numberOfLines={1}>{unit}</Text>
    </Pressable>
  );
}

export function QualityDashboard() {
  const router = useRouter();
  const data = useKarenDashboardStore((st) => st.data);
  const loading = useKarenDashboardStore((st) => st.loading);
  const error = useKarenDashboardStore((st) => st.error);
  const selectedDate = useKarenDashboardStore((st) => st.selectedDate);
  const setDate = useKarenDashboardStore((st) => st.setDate);
  const selectedFarm = useKarenDashboardStore((st) => st.selectedFarm);
  const setFarm = useKarenDashboardStore((st) => st.setFarm);
  const online = useNetworkStore((st) => st.online);

  const kpi = data?.kpi;
  const quarantined = kpi?.quarantined ?? 0;
  const hasQuarantine = quarantined > 0;
  const attention = (kpi?.pendingReshelving ?? 0) + (kpi?.openReplacements ?? 0);
  const hasAttention = attention > 0;
  const notReceived = kpi?.notReceivedBuckets ?? 0;
  const hasNotReceived = notReceived > 0;

  // All-farm users get "All farms" plus every farm; others only their farms,
  // and no picker when that is a single farm.
  const farmOptions = data
    ? [
        ...(data.allFarms ? [{ label: 'All farms', value: '' }] : []),
        ...data.allowedFarms.map((f) => ({ label: f, value: f })),
      ]
    : [];
  const showFarmPicker = farmOptions.length > 1;

  return (
    <View>
      <View style={s.topRow}>
        {showFarmPicker ? (
          <View style={s.farmPicker}>
            <Dropdown
              compact
              plain
              label="Farm"
              value={selectedFarm ?? data?.farm ?? ''}
              options={farmOptions}
              searchable={farmOptions.length > 8}
              onChange={setFarm}
            />
          </View>
        ) : null}
        <View style={[s.statusPill, online ? s.pillLive : s.pillOffline]}>
          <View style={[s.statusDot, online ? s.dotLive : s.dotOffline]} />
          <Text style={[s.statusText, online ? s.statusTextLive : s.statusTextOffline]}>
            {online ? 'Live' : 'Offline'}
          </Text>
        </View>
      </View>

      <DayStepper value={selectedDate} onChange={setDate} />

      {error ? (
        <View style={s.errorBanner}>
          <Ionicons name="alert-circle-outline" size={16} color="#991B1B" />
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : null}

      {loading && !data ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator color={COLORS.text} />
        </View>
      ) : (
        <>
          <Pressable style={s.hero} onPress={() => router.push('/intake-qc' as never)}>
            <View style={s.heroBubble} />
            <Text style={s.heroChip}>OVERALL FTR</Text>
            <Text style={s.heroNumber} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
              {pctText(kpi?.ftr ?? null)}
            </Text>
            <Text style={s.heroUnit}>{(kpi?.stemsReceived ?? 0).toLocaleString()} stems received</Text>
            <Ionicons name="checkmark-done" size={72} color="rgba(255,255,255,0.06)" style={s.heroIcon} />
          </Pressable>

          <View style={s.row}>
            <KpiTile
              chip="TOTAL REPORTS"
              value={(kpi?.totalReports ?? 0).toLocaleString()}
              unit="reports"
              bg={DARK_A}
              route="intake-qc"
            />
            <KpiTile
              chip="SAMPLED"
              value={pctText(kpi?.sampled ?? null)}
              unit={`${(kpi?.stemsChecked ?? 0).toLocaleString()} stems checked`}
              bg={DARK_B}
              route="intake-qc"
            />
          </View>

          <Pressable
            style={[s.issueTile, hasNotReceived && s.issueTileActive]}
            onPress={() => router.push('/receiving' as never)}
          >
            <View style={s.issueTileLeft}>
              <Text style={[s.tileChip, hasNotReceived && { color: '#FECACA' }]}>NOT RECEIVED</Text>
              <Text
                style={[s.issueNumber, hasNotReceived ? { color: '#FCA5A5' } : { color: COLORS.textMuted }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.5}
              >
                {notReceived.toLocaleString()}
              </Text>
              <Text style={[s.tileUnit, hasNotReceived && { color: '#FCA5A5' }]}>
                buckets · {(kpi?.notReceivedStems ?? 0).toLocaleString()} stems
              </Text>
            </View>
          </Pressable>

          <View style={s.varianceCard}>
            <Text style={s.varianceLabel}>STEMS</Text>
            <View style={s.varianceBody}>
              <Stat label="Received" value={kpi?.stemsReceived ?? 0} />
              <View style={s.varianceDivider} />
              <Stat label="Checked" value={kpi?.stemsChecked ?? 0} />
              <View style={s.varianceDivider} />
              <Stat label="Quarantined" value={quarantined} tone={hasQuarantine ? s.deltaNeg : undefined} />
            </View>
          </View>

          {/* Quarantined — dark, turns dark red only when there's something in it */}
          <View style={[s.issueTile, hasQuarantine && s.issueTileActive]}>
            <View style={s.issueTileLeft}>
              <Text style={[s.tileChip, hasQuarantine && { color: '#FECACA' }]}>QUARANTINED</Text>
              <Text
                style={[s.issueNumber, hasQuarantine ? { color: '#FCA5A5' } : { color: COLORS.textMuted }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.5}
              >
                {quarantined.toLocaleString()}
              </Text>
              <Text style={[s.tileUnit, hasQuarantine && { color: '#FCA5A5' }]}>stems</Text>
            </View>
            {data && data.issues.length > 0 ? (
              <View style={s.issueBreakdown}>
                {data.issues.slice(0, 3).map((i) => (
                  <View key={i.label} style={s.issueBreakdownRow}>
                    <Text style={s.issueBreakdownLabel} numberOfLines={1}>{i.label}</Text>
                    <Text style={s.issueBreakdownValue}>{i.stems.toLocaleString()}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          {hasAttention ? (
            <View style={[s.issueTile, s.issueTileActive]}>
              <View style={s.issueTileLeft}>
                <Text style={[s.tileChip, { color: '#FECACA' }]}>NEEDS ATTENTION</Text>
                <Text style={[s.issueNumber, { color: '#FCA5A5' }]} numberOfLines={1}>
                  {attention.toLocaleString()}
                </Text>
              </View>
              <View style={s.issueBreakdown}>
                <Pressable style={s.issueBreakdownRow} onPress={() => router.push('/pending-reshelving' as never)}>
                  <Text style={s.issueBreakdownLabel}>Pending reshelving</Text>
                  <Text style={s.issueBreakdownValue}>{(kpi?.pendingReshelving ?? 0).toLocaleString()}</Text>
                </Pressable>
                <Pressable style={s.issueBreakdownRow} onPress={() => router.push('/replacement' as never)}>
                  <Text style={s.issueBreakdownLabel}>Open replacements</Text>
                  <Text style={s.issueBreakdownValue}>{(kpi?.openReplacements ?? 0).toLocaleString()}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {(data?.farms.length ?? 0) > 0 ? (
            <CollapsibleSection
              label="FTR PER FARM"
              count={`${data!.farms.length} ${data!.farms.length === 1 ? 'farm' : 'farms'}`}
              defaultOpen
            >
              {data!.farms.map((f) => (
                <FarmRow key={f.farm} f={f} />
              ))}
            </CollapsibleSection>
          ) : null}

          {(data?.issues.length ?? 0) > 0 ? (
            <CollapsibleSection label="QUARANTINED BY ISSUE" defaultOpen={false}>
              <Chips rows={data!.issues} />
            </CollapsibleSection>
          ) : null}

          {(data?.varieties.length ?? 0) > 0 ? (
            <CollapsibleSection label="QUARANTINED BY VARIETY" defaultOpen={false}>
              <Chips rows={data!.varieties} />
            </CollapsibleSection>
          ) : null}
        </>
      )}
    </View>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: { color: string } }) {
  return (
    <View style={s.varianceStat}>
      <Text style={s.varianceStatLabel}>{label}</Text>
      <Text style={[s.varianceStatNum, tone]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
        {value.toLocaleString()}
      </Text>
    </View>
  );
}

function Chips({ rows }: { rows: DashboardBar[] }) {
  return (
    <View style={s.varietyRow}>
      {rows.map((r) => (
        <View key={r.label} style={s.varietyChip}>
          <Text style={s.varietyChipStems}>{r.stems.toLocaleString()}</Text>
          <Text style={s.varietyChipName} numberOfLines={1}>{r.label}</Text>
        </View>
      ))}
    </View>
  );
}

function FarmRow({ f }: { f: DashboardFarm }) {
  const width = Math.max(0, Math.min(100, f.ftr ?? 0));
  const tone = f.ftr === null ? undefined : f.ftr >= 80 ? s.ftrHigh : f.ftr >= 60 ? s.ftrMid : s.ftrLow;
  return (
    <View style={s.rowCard}>
      <View style={s.rowCardMain}>
        <View style={s.rowCardLeft}>
          <Text style={s.rowCardName} numberOfLines={1}>{f.farm || '—'}</Text>
          <Text style={s.rowCardMeta} numberOfLines={1}>
            {f.stemsReceived.toLocaleString()} received · {f.quarantined.toLocaleString()} quarantined
          </Text>
        </View>
        <Text style={[s.rowCardNum, tone]}>{pctText(f.ftr)}</Text>
      </View>
      <View style={s.rowCardBarTrack}>
        <View style={[s.rowCardBarFill, tone && { backgroundColor: tone.color }, { width: `${width}%` }]} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  loadingWrap: { paddingVertical: spacing.xxl, alignItems: 'center' },

  topRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  farmPicker: { flex: 1 },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: borderRadius.full, borderWidth: 1,
  },
  pillLive: { backgroundColor: '#DCFCE7', borderColor: '#86EFAC' },
  pillOffline: { backgroundColor: '#FEF3C7', borderColor: '#FCD34D' },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  dotLive: { backgroundColor: '#16A34A' },
  dotOffline: { backgroundColor: '#D97706' },
  statusText: { fontFamily: fontFamily.medium, fontSize: fontSize.xs },
  statusTextLive: { color: '#16A34A' },
  statusTextOffline: { color: '#D97706' },

  stepper: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: COLORS.surface, borderRadius: borderRadius.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, marginBottom: spacing.md,
  },
  stepperBtn: { padding: spacing.xs },
  stepperLabel: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.text },

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: '#FEF2F2', borderRadius: borderRadius.md,
    padding: spacing.md, marginBottom: spacing.md,
  },
  errorText: { flex: 1, fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: '#991B1B' },

  hero: {
    backgroundColor: HERO_BG,
    borderRadius: 24,
    padding: spacing.xl,
    marginBottom: spacing.sm,
    overflow: 'hidden',
    minHeight: 160,
  },
  heroBubble: {
    position: 'absolute', width: 200, height: 200, borderRadius: 100,
    backgroundColor: HERO_ACCENT, bottom: -60, right: -40,
  },
  heroChip: {
    fontFamily: fontFamily.medium, fontSize: fontSize.xs,
    color: 'rgba(255,255,255,0.55)', letterSpacing: 1.2, marginBottom: spacing.sm,
  },
  heroNumber: { fontFamily: fontFamily.bold, fontSize: 52, color: '#FFFFFF', lineHeight: 56 },
  heroUnit: { fontFamily: fontFamily.regular, fontSize: fontSize.md, color: 'rgba(255,255,255,0.6)', marginTop: 4 },
  heroIcon: { position: 'absolute', bottom: spacing.lg, right: spacing.xl },

  row: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  tile: {
    flex: 1, borderRadius: 20, padding: spacing.lg,
    minHeight: 110, justifyContent: 'flex-end',
  },
  tileChip: {
    fontFamily: fontFamily.medium, fontSize: 10,
    color: 'rgba(255,255,255,0.5)', letterSpacing: 1, marginBottom: spacing.xs,
  },
  tileNumber: { fontFamily: fontFamily.bold, fontSize: 34, color: '#FFFFFF', lineHeight: 38 },
  tileUnit: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: 'rgba(255,255,255,0.5)', marginTop: 2 },

  issueTile: {
    backgroundColor: DARK_B, borderRadius: 20, padding: spacing.lg, marginBottom: spacing.sm,
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg,
  },
  issueTileActive: { backgroundColor: DARK_ISSUE_ACTIVE },
  issueTileLeft: { flex: 1 },
  issueNumber: { fontFamily: fontFamily.bold, fontSize: 36, lineHeight: 40 },
  issueBreakdown: { justifyContent: 'center', gap: spacing.xs, paddingTop: 6 },
  issueBreakdownRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    justifyContent: 'space-between', minWidth: 150,
  },
  issueBreakdownLabel: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: 'rgba(255,255,255,0.45)' },
  issueBreakdownValue: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: '#FCA5A5' },

  varianceCard: {
    backgroundColor: '#FFFBEB', borderRadius: 20, padding: spacing.lg,
    marginBottom: spacing.sm, borderWidth: 1, borderColor: '#FDE68A',
  },
  varianceLabel: { fontFamily: fontFamily.medium, fontSize: 10, color: '#92400E', letterSpacing: 1.2 },
  varianceBody: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', marginTop: spacing.md },
  varianceStat: { alignItems: 'center', flex: 1 },
  varianceDivider: { width: 1, height: 40, backgroundColor: '#FDE68A' },
  varianceStatLabel: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: '#92400E', marginBottom: 4 },
  varianceStatNum: { fontFamily: fontFamily.bold, fontSize: fontSize.xl, color: COLORS.text },
  deltaNeg: { color: '#DC2626' },

  collapsible: { marginTop: spacing.md, marginBottom: spacing.sm },
  collapsibleHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: spacing.xs, paddingHorizontal: 2, marginBottom: spacing.sm,
  },
  collapsibleHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  sectionLabel: { fontFamily: fontFamily.semiBold, fontSize: 10, color: COLORS.textMuted, letterSpacing: 1.4 },
  sectionCount: { fontFamily: fontFamily.medium, fontSize: 10, color: COLORS.textMuted },

  varietyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  varietyChip: {
    backgroundColor: COLORS.surface, borderRadius: borderRadius.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minWidth: 92,
  },
  varietyChipStems: { fontFamily: fontFamily.bold, fontSize: fontSize.md, color: COLORS.text },
  varietyChipName: { fontFamily: fontFamily.regular, fontSize: 10, color: COLORS.textMuted, marginTop: 1, maxWidth: 100 },

  rowCard: {
    backgroundColor: COLORS.surface, borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border,
    paddingHorizontal: spacing.md, paddingTop: spacing.sm + 2, paddingBottom: spacing.sm,
    marginBottom: spacing.xs + 2, overflow: 'hidden',
  },
  rowCardMain: { flexDirection: 'row', alignItems: 'center', paddingBottom: spacing.sm },
  rowCardLeft: { flex: 1, paddingRight: spacing.sm },
  rowCardName: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.text },
  rowCardMeta: { fontFamily: fontFamily.regular, fontSize: 10, color: COLORS.textMuted, marginTop: 1 },
  rowCardNum: { fontFamily: fontFamily.bold, fontSize: 17, color: COLORS.text },
  ftrHigh: { color: '#15803D' },
  ftrMid: { color: '#D97706' },
  ftrLow: { color: '#DC2626' },
  rowCardBarTrack: { height: 3, backgroundColor: COLORS.bgMuted, marginHorizontal: -spacing.md },
  rowCardBarFill: { height: '100%', backgroundColor: '#22C55E' },
});
