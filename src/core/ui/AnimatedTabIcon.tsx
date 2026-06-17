import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/src/core/theme';

interface Props {
  outline: keyof typeof Ionicons.glyphMap;
  filled: keyof typeof Ionicons.glyphMap;
  focused: boolean;
  size: number;
}

/** Tab icon that springs up to ~1.2× on focus with an ease-in-out curve, plus
 *  a subtle vertical lift. Runs on the native driver for smoothness. */
export function AnimatedTabIcon({ outline, filled, focused, size }: Props) {
  const scale = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(scale, {
      toValue: focused ? 1 : 0,
      duration: 360,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [focused, scale]);

  const transform = [
    {
      scale: scale.interpolate({
        inputRange: [0, 0.65, 1],
        outputRange: [1, 1.28, 1.2],
      }),
    },
    { translateY: scale.interpolate({ inputRange: [0, 1], outputRange: [0, -2] }) },
  ];
  const opacity = scale.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] });

  return (
    <Animated.View style={{ transform, opacity }}>
      <Ionicons
        name={focused ? filled : outline}
        size={size}
        color={focused ? COLORS.text : COLORS.textMuted}
      />
    </Animated.View>
  );
}
