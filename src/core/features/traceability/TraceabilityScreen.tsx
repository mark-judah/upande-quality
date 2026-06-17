import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { format, parseISO } from 'date-fns';
import { Screen } from '@/src/core/ui/Screen';
import { Card, Alert } from '@/src/core/ui/Card';
import { Button } from '@/src/core/ui/Button';
import { ScanField, type ScanFieldHandle } from '@/src/core/scanning/ScanField';
import { focusWhenReady } from '@/src/core/scanning/focus';
import { useTraceabilityStore } from './store';
import type {
  JourneyStage,
  SessionBunch,
  TraceabilityQuery,
  TraceabilityRepository,
  TraceabilitySnapshot,
  TraceabilityStatus,
} from './types';
import { COLORS } from '@/src/core/theme';

type Props = { repository: TraceabilityRepository };

function parseScan(raw: string): TraceabilityQuery {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;

      if (typeof obj.bunch_id === 'string' && obj.bunch_id.trim()) {
        return { kind: 'bunch', id: obj.bunch_id.trim() };
      }
      if (typeof obj.bucket_id === 'string' && obj.bucket_id.trim()) {
        return { kind: 'bucket', id: obj.bucket_id.trim() };
      }

      for (const [id, kind] of Object.entries(obj)) {
        if (kind === 'bucket') return { kind: 'bucket', id };
        if (kind === 'bunch') return { kind: 'bunch', id };
      }
    }
  } catch {
    // not JSON
  }
  return { kind: 'bucket', id: trimmed };
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return format(parseISO(iso), 'd MMM yyyy');
  } catch {
    return iso;
  }
}

const STATUS_STYLE: Record<TraceabilityStatus, { bg: string; fg: string }> = {
  Harvested:       { bg: '#e6f9ee', fg: '#1a8a3a' },
  Graded:          { bg: '#f0ecfe', fg: '#7c5cfc' },
  Received:        { bg: '#f0ecfe', fg: '#7c5cfc' },
  'On Shelf':      { bg: '#e8f0fe', fg: '#2490ef' },
  'Pending Issue': { bg: '#fff3e0', fg: '#9a5a00' },
  Issued:          { bg: '#e6f9ee', fg: '#1a8a3a' },
};

export function TraceabilityScreen({ repository }: Props) {
  const scanRef = useRef<ScanFieldHandle>(null);
  const { loading, error, snapshot, scannedKind, scannedId, fetch, reset } = useTraceabilityStore();

  useEffect(() => () => reset(), [reset]);

  const onScan = (raw: string) => fetch(repository, parseScan(raw));

  // Operator clicks this after reading the result to clear the snapshot and
  // refocus the scan field for the next scan. We deliberately do NOT sticky-
  // focus while the result is on screen — Android pops the soft keyboard back
  // every time the field regains focus, which is jarring when the operator is
  // trying to read the displayed details.
  const handleNext = () => {
    reset();
    scanRef.current?.clear();
    focusWhenReady(scanRef);
  };

  const headerLabel =
    scannedKind === 'bunch' ? `Bunch ${scannedId ?? ''}` : `Bucket ${scannedId ?? ''}`;

  const showNextButton = !loading && (snapshot !== null || error !== null);

  return (
    <Screen title="Traceability">
      <Card title="Scan a bucket or bunch">
        <Text style={s.helper}>
          Scan a bucket or bunch QR to view its journey. To make changes, use the Replacement page.
        </Text>
        <View style={{ height: 12 }} />
        <ScanField
          ref={scanRef}
          onScan={onScan}
          autoFocus={!snapshot && !error}
          editable={!loading && !snapshot && !error}
          placeholder="Bucket / Bunch ID"
        />
      </Card>

      {loading ? (
        <Card><Text style={s.muted}>Looking up {headerLabel}…</Text></Card>
      ) : error ? (
        <Alert tone="danger">{error}</Alert>
      ) : snapshot ? (
        <Snapshot data={snapshot} scannedBunchId={scannedKind === 'bunch' ? scannedId : null} />
      ) : (
        <Card><Text style={s.muted}>No bucket or bunch scanned yet.</Text></Card>
      )}

      {showNextButton ? (
        <View style={s.nextBtnWrap}>
          <Button label="Next bucket" onPress={handleNext} />
        </View>
      ) : null}
    </Screen>
  );
}

function Snapshot({
  data,
  scannedBunchId,
}: {
  data: TraceabilitySnapshot;
  scannedBunchId: string | null;
}) {
  const style = STATUS_STYLE[data.status] ?? STATUS_STYLE.Harvested;
  const headerLabelId = data.kind === 'bunch' && data.bunchId ? data.bunchId : data.bucketId;
  const headerLabelTag = data.kind === 'bunch' ? 'BUNCH' : 'BUCKET';

  const varietyConsensus = mode(data.stages.map((st) => st.variety.trim()).filter(Boolean));
  const lengthConsensus = mode(data.stages.map((st) => st.stemLength.trim()).filter(Boolean));

  return (
    <>
      <Card>
        <View style={s.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.bucketLabel}>{headerLabelTag}</Text>
            <Text style={s.bucketId}>{headerLabelId.toUpperCase() || '—'}</Text>
            {data.kind === 'bunch' && data.bucketId ? (
              <Text style={s.subId}>currently in bucket {data.bucketId.toUpperCase()}</Text>
            ) : data.roseType === 'Spray Roses' && data.sessionSize > 0 ? (
              <Text style={s.subId}>
                {data.sessionSize} bunch{data.sessionSize === 1 ? '' : 'es'} in this bucket
              </Text>
            ) : null}
          </View>
          <View style={[s.badge, { backgroundColor: style.bg }]}>
            <Text style={[s.badgeText, { color: style.fg }]}>{data.status}</Text>
          </View>
        </View>
      </Card>

      <Card title="Current details">
        <Row label="Rose type"   value={data.roseType} />
        <Row label="Variety"     value={data.variety} />
        <Row label="Farm"        value={data.farm} />
        <Row label="Greenhouse"  value={data.greenhouse} />
        <Row label="Stem length" value={data.stemLength} />
        <Row label="Stems"       value={data.numberOfStems != null ? String(data.numberOfStems) : '—'} />
        <Row label="Latest"      value={formatDate(data.date)} />
        {data.batchNo ? <Row label="Session" value={data.batchNo} small /> : null}
      </Card>

      {data.bunches.length > 0 && (
        <Card title={`Bunches in bucket (${data.bunches.length})`}>
          <Text style={s.bunchSub}>
            Each bunch's claim from its QR code.
          </Text>
          <View style={{ height: 8 }} />
          {data.bunches.map((bunch) => (
            <BunchRow
              key={bunch.bunchId}
              bunch={bunch}
              sessionVariety={data.variety}
              isScanned={scannedBunchId !== null && bunch.bunchId === scannedBunchId}
            />
          ))}
        </Card>
      )}

      {data.stages.length > 0 && (
        <Card title="Journey">
          {data.stages.map((stage, i) => (
            <StageRow
              key={`${stage.stage}-${i}`}
              stage={stage}
              isLast={i === data.stages.length - 1}
              varietyConsensus={varietyConsensus}
              lengthConsensus={lengthConsensus}
            />
          ))}
        </Card>
      )}
    </>
  );
}

function BunchRow({
  bunch,
  sessionVariety,
  isScanned,
}: {
  bunch: SessionBunch;
  sessionVariety: string;
  isScanned: boolean;
}) {
  const varietyMismatch =
    bunch.variety.trim() !== '' &&
    sessionVariety.trim() !== '' &&
    bunch.variety.trim().toLowerCase() !== sessionVariety.trim().toLowerCase();
  const lengthMismatch =
    bunch.stemLength.trim() !== '' &&
    bunch.gradingStemLength.trim() !== '' &&
    bunch.stemLength.trim().toLowerCase() !== bunch.gradingStemLength.trim().toLowerCase();

  return (
    <View style={[s.bunchRow, isScanned && s.bunchRowHighlight]}>
      <View style={s.bunchHeader}>
        <Text style={s.bunchId}>{bunch.bunchId}</Text>
        {bunch.issuedOpl ? (
          <View style={[s.statusChip, { backgroundColor: '#e6f9ee' }]}>
            <Text style={[s.statusChipText, { color: '#1a8a3a' }]}>Issued</Text>
          </View>
        ) : (
          <View style={[s.statusChip, { backgroundColor: '#f4f5f6' }]}>
            <Text style={[s.statusChipText, { color: COLORS.textMuted }]}>In bucket</Text>
          </View>
        )}
      </View>
      <View style={s.bunchMeta}>
        <MetaPill label="Variety" value={bunch.variety || '—'} warn={varietyMismatch} />
        <MetaPill label="Length"  value={bunch.stemLength || '—'} warn={lengthMismatch} />
        <MetaPill label="Size"    value={bunch.bunchSize || '—'} warn={false} />
      </View>
      <View style={s.bunchFooter}>
        <Text style={s.bunchFooterText}>
          {bunch.gradedBy ? `Graded by ${bunch.gradedBy}` : ''}
          {bunch.gradingSe ? `  ·  ${bunch.gradingSe}` : ''}
        </Text>
      </View>
      {bunch.issuedOpl ? <Text style={s.bunchOpl}>{bunch.issuedOpl}</Text> : null}
    </View>
  );
}

function StageRow({
  stage,
  isLast,
  varietyConsensus,
  lengthConsensus,
}: {
  stage: JourneyStage;
  isLast: boolean;
  varietyConsensus: string | null;
  lengthConsensus: string | null;
}) {
  const varietyMismatch =
    varietyConsensus !== null &&
    stage.variety.trim() !== '' &&
    stage.variety.trim() !== varietyConsensus;
  const lengthMismatch =
    lengthConsensus !== null &&
    stage.stemLength.trim() !== '' &&
    stage.stemLength.trim() !== lengthConsensus;

  const whoText =
    stage.who ? `${stage.who}${stage.whoKind === 'payroll' ? ' (payroll)' : ''}` :
    stage.user ? stage.user :
    '—';

  return (
    <View style={s.stageRow}>
      <View style={s.spineLine}>
        <View style={s.spineDot} />
        {!isLast && <View style={s.spineTrack} />}
      </View>

      <View style={[s.stageBody, isLast ? null : s.stageBodyGap]}>
        <View style={s.stageHeader}>
          <Text style={s.stageName}>{stage.stage}</Text>
          {stage.date ? <Text style={s.stageDate}>{formatDate(stage.date)}</Text> : null}
        </View>

        {stage.detail ? <Text style={s.stageDetail}>{stage.detail}</Text> : null}

        <View style={s.stageMeta}>
          {stage.variety ? (
            <MetaPill label="Variety" value={stage.variety} warn={varietyMismatch} />
          ) : null}
          {stage.stemLength ? (
            <MetaPill label="Length" value={stage.stemLength} warn={lengthMismatch} />
          ) : null}
          {stage.qty != null ? (
            <MetaPill label="Stems" value={String(stage.qty)} warn={false} />
          ) : null}
        </View>

        <View style={s.stageFooter}>
          <Text style={s.stageWho}>{whoText}</Text>
          {stage.doc ? <Text style={s.stageDoc}>{stage.doc}</Text> : null}
        </View>
      </View>
    </View>
  );
}

function MetaPill({ label, value, warn }: { label: string; value: string; warn: boolean }) {
  return (
    <View style={[s.pill, warn && s.pillWarn]}>
      <Text style={[s.pillLabel, warn && s.pillLabelWarn]}>{label}</Text>
      <Text style={[s.pillValue, warn && s.pillValueWarn]}>{value}</Text>
    </View>
  );
}

function Row({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[s.rowValue, small && s.rowValueSmall]}>{value || '—'}</Text>
    </View>
  );
}

function mode(values: string[]): string | null {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  for (const v of values) {
    const key = v.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const v of values) {
    const c = counts.get(v.toLowerCase()) ?? 0;
    if (c > bestCount) {
      bestCount = c;
      best = v.toLowerCase();
    }
  }
  return best;
}

const DOT = 8;
const TRACK_W = 2;

const s = StyleSheet.create({
  helper:      { fontSize: 13, color: COLORS.textMuted },
  muted:       { fontSize: 13, color: COLORS.textMuted },

  headerRow:   { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bucketLabel: { fontSize: 11, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  bucketId:    { fontSize: 20, fontWeight: '700', color: COLORS.text, marginTop: 2, letterSpacing: 1 },
  subId:       { fontSize: 12, color: COLORS.textMuted, marginTop: 4 },
  badge:       { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  badgeText:   { fontSize: 13, fontWeight: '700' },

  row:           { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7 },
  rowLabel:      { fontSize: 12, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  rowValue:      { fontSize: 14, color: COLORS.text, flexShrink: 1, textAlign: 'right' },
  rowValueSmall: { fontSize: 11 },

  bunchSub:    { fontSize: 12, color: COLORS.textMuted, lineHeight: 16 },

  bunchRow: {
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  bunchRowHighlight: {
    backgroundColor: '#fff8e6',
    borderRadius: 6,
    paddingHorizontal: 6,
  },
  bunchHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  bunchId:     { fontSize: 13, fontWeight: '700', color: COLORS.text },
  bunchMeta:   { marginTop: 6, flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  bunchFooter: { marginTop: 6 },
  bunchFooterText: { fontSize: 11, color: COLORS.textMuted },
  bunchOpl:    { marginTop: 2, fontSize: 11, color: '#1a8a3a', fontWeight: '600' },
  statusChip:  { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  statusChipText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },

  stageRow:     { flexDirection: 'row', gap: 12 },
  spineLine:    { width: DOT, alignItems: 'center', paddingTop: 6 },
  spineDot:     { width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: COLORS.text },
  spineTrack:   { width: TRACK_W, flex: 1, backgroundColor: COLORS.border, marginTop: 4 },
  stageBody:    { flex: 1, paddingTop: 2 },
  stageBodyGap: { paddingBottom: 16 },
  stageHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  stageName:    { fontSize: 14, fontWeight: '700', color: COLORS.text },
  stageDate:    { fontSize: 12, color: COLORS.textMuted },
  stageDetail:  { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  stageMeta:    { marginTop: 6, flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  stageFooter:  {
    marginTop: 6,
    gap: 2,
  },
  stageWho:     { fontSize: 11, color: COLORS.textMuted },
  stageDoc:     { fontSize: 10, color: COLORS.textMuted, fontStyle: 'italic' },

  pill:         {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#f4f5f6',
    flexDirection: 'row',
    gap: 5,
    alignItems: 'baseline',
  },
  pillWarn:     { backgroundColor: '#fde8ec' },
  pillLabel:    { fontSize: 10, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 0.3 },
  pillLabelWarn:{ color: '#9a1f33' },
  pillValue:    { fontSize: 12, color: COLORS.text, fontWeight: '600' },
  pillValueWarn:{ color: '#9a1f33' },

  nextBtnWrap:  { marginTop: 16 },
});
