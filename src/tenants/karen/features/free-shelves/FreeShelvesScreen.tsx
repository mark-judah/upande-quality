import { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Screen } from '@/src/core/ui/Screen';
import { Alert, Card } from '@/src/core/ui/Card';
import { Dropdown } from '@/src/core/ui/Dropdown';
import { Segmented } from '@/src/core/ui/Segmented';
import { Skeleton } from '@/src/core/ui/Skeleton';
import { COLORS, borderRadius, fontFamily, fontSize, spacing } from '@/src/core/theme';
import { useKarenFreeShelvesStore, type FreeShelf } from '@/src/tenants/karen/state/karen-free-shelves-store';

type Filter = 'all' | 'empty' | 'one';
const ALL_FARMS = '';

export function KarenFreeShelvesScreen() {
  const { shelves, farms, loading, error, load } = useKarenFreeShelvesStore();
  const [farm, setFarm] = useState(ALL_FARMS);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const farmOptions = useMemo(
    () => [{ label: 'All farms', value: ALL_FARMS }, ...farms.map((f) => ({ label: f, value: f }))],
    [farms],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return shelves.filter(
      (sh) =>
        (!farm || sh.farm === farm) &&
        (filter === 'all' || (filter === 'empty' ? sh.free === 2 : sh.free === 1)) &&
        (!q || sh.shelfId.toLowerCase().includes(q)),
    );
  }, [shelves, farm, filter, search]);

  const empty = visible.filter((sh) => sh.free === 2).length;
  const slots = visible.reduce((n, sh) => n + sh.free, 0);

  const renderItem = useCallback(
    ({ item }: { item: FreeShelf }) => (
      <View style={s.row}>
        <View style={s.rowText}>
          <Text style={s.shelf}>{item.shelfId}</Text>
          <Text style={s.sub}>
            {item.farm} · {item.buckets === 0 ? 'Empty' : `${item.buckets} bucket on it`}
          </Text>
        </View>
        <View style={[s.pill, item.free === 2 ? s.pillEmpty : s.pillOne]}>
          <Text style={[s.pillText, item.free === 2 ? s.pillTextEmpty : s.pillTextOne]}>
            Space for {item.free}
          </Text>
        </View>
      </View>
    ),
    [],
  );

  return (
    <Screen title="Free Shelves" scroll={false} onRefresh={load}>
      <View style={s.body}>
        <Card>
          <View style={s.summary}>
            <View style={s.stat}>
              <Text style={s.statNum}>{visible.length}</Text>
              <Text style={s.statLabel}>Free shelves</Text>
            </View>
            <View style={s.stat}>
              <Text style={s.statNum}>{empty}</Text>
              <Text style={s.statLabel}>Empty</Text>
            </View>
            <View style={s.stat}>
              <Text style={s.statNum}>{slots}</Text>
              <Text style={s.statLabel}>Buckets it can take</Text>
            </View>
          </View>
        </Card>

        <Dropdown label="Farm" value={farm} options={farmOptions} onChange={setFarm} iconName="warehouse" searchable={false} />
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'empty', label: 'Empty' },
            { value: 'one', label: 'One bucket' },
          ]}
        />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search shelf"
          placeholderTextColor={COLORS.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          style={s.search}
        />

        {error ? <Alert tone="danger">{error}</Alert> : null}

        {loading && shelves.length === 0 ? (
          <Skeleton height={64} />
        ) : (
          <FlatList
            data={visible}
            keyExtractor={(item) => `${item.farm}|${item.shelfId}`}
            renderItem={renderItem}
            style={s.list}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={20}
            windowSize={9}
            ListEmptyComponent={
              error ? null : <Alert tone="info">No free shelves match.</Alert>
            }
          />
        )}
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  body: { flex: 1, gap: spacing.sm },
  summary: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { flex: 1, alignItems: 'center' },
  statNum: { fontFamily: fontFamily.bold, fontSize: fontSize.xl, color: COLORS.text },
  statLabel: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: COLORS.textMuted, textAlign: 'center' },
  search: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: COLORS.text,
    backgroundColor: COLORS.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  list: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: COLORS.surface,
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    padding: spacing.md,
    marginBottom: spacing.xs,
  },
  rowText: { flex: 1 },
  shelf: { fontFamily: fontFamily.bold, fontSize: fontSize.md, color: COLORS.text },
  sub: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: COLORS.textMuted },
  pill: { borderRadius: borderRadius.lg, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  pillEmpty: { backgroundColor: '#F0FDF4' },
  pillOne: { backgroundColor: '#FFFBEB' },
  pillText: { fontFamily: fontFamily.bold, fontSize: fontSize.sm },
  pillTextEmpty: { color: '#166534' },
  pillTextOne: { color: '#92400E' },
});
