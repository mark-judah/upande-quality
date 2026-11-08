import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import {
  Animated,
  FlatList,
  Platform,
  StyleSheet,
  type ListRenderItemInfo,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

/** One card (or heading) of a page's list. `render` draws it; it is only called while
 *  the card is inside the list's render window. */
export type CardItem = { key: string; render: () => ReactNode };

/** A page's cards as a virtualised list: the first few paint at once, the rest follow in
 *  batches as the list scrolls, so a trip with hundreds of buckets opens straight away. */
export const CardList = memo(function CardList({
  items,
  header,
  footer,
  refreshControl,
  initial = 4,
}: {
  items: CardItem[];
  /** Cards painted before the list first shows: fewer for tall cards. */
  initial?: number;
  header?: ReactElement | null;
  footer?: ReactElement | null;
  refreshControl?: ReactElement;
}) {
  const renderItem = useCallback(({ item }: ListRenderItemInfo<CardItem>) => <>{item.render()}</>, []);
  return (
    <FlatList
      style={s.list}
      data={items}
      keyExtractor={keyOf}
      renderItem={renderItem}
      ListHeaderComponent={header ?? undefined}
      ListFooterComponent={footer ?? undefined}
      contentContainerStyle={s.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl as ReactElement<never> | undefined}
      initialNumToRender={initial}
      maxToRenderPerBatch={4}
      updateCellsBatchingPeriod={30}
      windowSize={7}
      removeClippedSubviews={Platform.OS === 'android'}
    />
  );
});

/** Fades its content in once, when it first mounts (a list replacing its skeletons). */
export function FadeIn({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const [opacity] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
  }, [opacity]);
  return <Animated.View style={[style, { opacity }]}>{children}</Animated.View>;
}

const keyOf = (it: CardItem) => it.key;

/** A callback that never changes identity but always runs the latest closure: handlers
 *  passed to memoised lists without re-rendering them on every screen render. */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}

const s = StyleSheet.create({
  list: { flex: 1 },
  content: { paddingBottom: 40 },
});
