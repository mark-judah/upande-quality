import { useMemo, useState, type ReactNode } from 'react';
import { router } from 'expo-router';
import { format, parseISO } from 'date-fns';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { borderRadius, COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';
import { useAuthStore } from '@/src/core/auth/store';
import { getTenantByUrl } from '@/src/core/tenant/instance-mapper';
import { readUserStation } from '@/src/core/tenant/user-station';
import { tenantCompany } from '@/src/core/features/station/repository';

/** Shared by the home's drill-down lists (Not Received, Needs Attention). */

/** A farm with more rows than this starts folded under All farms. */
const FOLD_OVER = 3;

const DARK_A = '#171717';
const DARK_B = '#1C1917';

/** The farm scope to ask the server for: the home's farm (null before the home
 *  has loaded, then the station's), the station farm, and the tenant company. */
export async function homeScopeParams(
  homeFarm: string | null,
): Promise<{ farm?: string; stationFarm?: string; company?: string }> {
  const station = await readUserStation().catch(() => null);
  return {
    farm: homeFarm ?? station?.userFarm ?? undefined,
    stationFarm: station?.userFarm,
    company: tenantCompany(getTenantByUrl(useAuthStore.getState().instanceUrl)),
  };
}

/** "12 Nov 2026, 23:37" for a "YYYY-MM-DD HH:MM:SS[.ffffff]" server time. */
export function serverDateTime(ts: string): string {
  if (ts.length < 16) return '';
  try {
    return format(parseISO(ts.slice(0, 19).replace(' ', 'T')), 'd MMM yyyy, HH:mm');
  } catch {
    return ts.slice(0, 16);
  }
}

export function HomeButton() {
  return (
    <Pressable
      style={s.headerBtn}
      hitSlop={6}
      onPress={() => router.navigate('/')}
      accessibilityRole="button"
      accessibilityLabel="Home"
    >
      <Ionicons name="home-outline" size={20} color={COLORS.text} />
    </Pressable>
  );
}

export function TotalTiles({ tiles }: { tiles: { label: string; value: number }[] }) {
  return (
    <View style={s.tiles}>
      {tiles.map((t, i) => (
        <View key={t.label} style={[s.tile, { backgroundColor: i % 2 ? DARK_B : DARK_A }]}>
          <Text style={s.tileChip}>{t.label}</Text>
          <Text style={s.tileValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
            {t.value.toLocaleString()}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function BucketRow({
  title,
  lines,
  value,
  inCard,
}: {
  title: string;
  lines: string[];
  value: number;
  inCard: boolean;
}) {
  return (
    <View style={[s.row, inCard && s.cardRow]}>
      <View style={s.rowMain}>
        <Text style={s.bucket}>{title}</Text>
        {lines.map((l, i) => (
          <Text key={i} style={i === 0 ? s.detail : s.meta} numberOfLines={i === 0 ? 2 : 1}>
            {l}
          </Text>
        ))}
      </View>
      <Text style={s.stems}>{value.toLocaleString()}</Text>
    </View>
  );
}

/**
 * One card per farm under All farms (by name, folded when the farm has more
 * than FOLD_OVER rows, opened by tapping it); a plain list for one farm.
 */
export function FarmCards<T>({
  rows,
  allFarms,
  farmOf,
  stemsOf,
  unit,
  renderRow,
}: {
  rows: T[];
  allFarms: boolean;
  farmOf: (r: T) => string;
  stemsOf: (r: T) => number;
  /** Plural noun for the rows in a farm's totals, e.g. "buckets". */
  unit: string;
  renderRow: (r: T, inCard: boolean) => ReactNode;
}) {
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => {
    const byFarm = new Map<string, T[]>();
    for (const r of rows) {
      const key = allFarms ? farmOf(r) : '';
      const list = byFarm.get(key);
      if (list) list.push(r);
      else byFarm.set(key, [r]);
    }
    return [...byFarm.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, list]) => ({ name, list, stems: list.reduce((t, r) => t + stemsOf(r), 0) }));
  }, [rows, allFarms, farmOf, stemsOf]);

  return (
    <>
      {groups.map((g) => {
        const open = !allFarms || (toggled[g.name] ?? g.list.length <= FOLD_OVER);
        return (
          <View key={g.name || 'farm'} style={allFarms ? s.farmCard : s.group}>
            {allFarms ? (
              <Pressable
                style={s.groupHead}
                onPress={() => setToggled((t) => ({ ...t, [g.name]: !open }))}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
              >
                <Text style={s.groupName} numberOfLines={1}>
                  {g.name || '—'}
                </Text>
                <Text style={s.groupTotals}>
                  {g.list.length.toLocaleString()} {unit} · {g.stems.toLocaleString()} stems
                </Text>
                <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.textMuted} />
              </Pressable>
            ) : null}
            {open ? g.list.map((r) => renderRow(r, allFarms)) : null}
          </View>
        );
      })}
    </>
  );
}

const s = StyleSheet.create({
  headerBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  tiles: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  tile: { flex: 1, borderRadius: 20, padding: spacing.lg, minHeight: 96, justifyContent: 'flex-end' },
  tileChip: {
    fontFamily: fontFamily.medium,
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  tileValue: { fontFamily: fontFamily.bold, fontSize: 32, lineHeight: 38, color: '#FFFFFF' },
  group: { marginBottom: spacing.lg },
  farmCard: {
    backgroundColor: COLORS.surface,
    borderRadius: borderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  groupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  groupName: { flex: 1, fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: COLORS.text },
  groupTotals: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: COLORS.textMuted },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  // Inside a farm card the line sits above each row, so none trails the last.
  cardRow: { borderBottomWidth: 0, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  rowMain: { flex: 1, paddingRight: 12 },
  bucket: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: COLORS.text },
  detail: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: COLORS.textSecondary },
  meta: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: COLORS.textMuted },
  stems: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: COLORS.danger },
});
