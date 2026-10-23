import { useCallback, useEffect } from 'react';
import { useFocusEffect } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { Screen } from '@/src/core/ui/Screen';
import { COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';
import { useAuthStore } from '@/src/core/auth/store';
import { useKarenDashboardStore } from '@/src/tenants/karen/state/karen-dashboard-store';
import { QualityDashboard } from '@/src/tenants/karen/features/dashboard/QualityDashboard';

export function KarenHomeScreen() {
  const fullName = useAuthStore((s) => s.fullName);
  const email = useAuthStore((s) => s.email);
  const firstName = (fullName || email || 'there').split(' ')[0];

  const load = useKarenDashboardStore((s) => s.load);
  const reset = useKarenDashboardStore((s) => s.reset);

  // Each login starts on today's numbers for that user.
  useEffect(() => {
    reset();
  }, [email, reset]);

  // Loaded whenever home is opened: after login, from the menu or the tab bar.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <Screen title="Upande Quality" onRefresh={load}>
      <Text style={s.greeting}>Welcome back, {firstName}</Text>
      <QualityDashboard />
    </Screen>
  );
}

const s = StyleSheet.create({
  greeting: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.lg,
    color: COLORS.text,
    marginBottom: spacing.md,
  },
});
