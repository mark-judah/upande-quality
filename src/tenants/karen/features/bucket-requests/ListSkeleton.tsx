import { StyleSheet, View } from 'react-native';
import { Card } from '@/src/core/ui/Card';
import { Skeleton } from '@/src/core/ui/Skeleton';
import { spacing } from '@/src/core/theme';

/** Stand-in cards while a Bucket Requests list loads: a head line with a pill, then
 *  bucket-like rows, so the page keeps its shape when the data lands. */
export function ListSkeleton({ cards = 3, rows = 3 }: { cards?: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: cards }, (_, c) => (
        <Card key={c}>
          <View style={s.head}>
            <View style={{ flex: 1, gap: 6 }}>
              <Skeleton width="55%" height={14} />
              <Skeleton width="35%" height={10} />
            </View>
            <Skeleton width={78} height={22} radius={10} />
          </View>
          {Array.from({ length: rows }, (_, r) => (
            <View key={r} style={s.row}>
              <Skeleton width={18} height={18} radius={9} />
              <View style={{ flex: 1, gap: 5 }}>
                <Skeleton width={r % 2 ? '40%' : '50%'} height={12} />
                <Skeleton width={r % 2 ? '60%' : '45%'} height={10} />
              </View>
              <Skeleton width={56} height={12} />
            </View>
          ))}
        </Card>
      ))}
    </>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
});
