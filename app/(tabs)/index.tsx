import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { Screen } from '@/src/core/ui/Screen';
import { Card } from '@/src/core/ui/Card';
import { useAuthStore } from '@/src/core/auth/store';
import { useTenant } from '@/src/core/tenant/tenant-context';
import { COLORS, fontFamily, fontSize } from '@/src/core/theme';
import { KarenHomeScreen } from '@/src/tenants/karen/features/dashboard/HomeScreen';

export default function HomeScreen() {
  const { tenant } = useTenant();
  const fullName = useAuthStore((s) => s.fullName);
  const email = useAuthStore((s) => s.email);

  // The KPI home reads upande_quality's getQualityDashboardData, which only
  // the Karen sites serve.
  if (tenant === 'Karen' || tenant === 'Demo') return <KarenHomeScreen />;

  return (
    <Screen title="Upande Quality">
      <Card>
        <Text style={s.greeting}>Welcome,</Text>
        <Text style={s.name}>{fullName || email || 'Quality user'}</Text>
      </Card>
    </Screen>
  );
}

const s = StyleSheet.create({
  greeting: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: COLORS.textSecondary },
  name: { fontFamily: fontFamily.bold, fontSize: fontSize.lg, color: COLORS.text, marginTop: 2 },
});
