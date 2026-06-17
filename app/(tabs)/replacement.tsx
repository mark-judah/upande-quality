import { Text } from 'react-native';
import { Screen } from '@/src/core/ui/Screen';
import { Card } from '@/src/core/ui/Card';
import { ReplacementScreen } from '@/src/core/features/replacement/ReplacementScreen';
import { getReplacementRepository } from '@/src/composition/replacement-resolver';
import { getTraceabilityRepository } from '@/src/composition/traceability-resolver';
import { useTenant } from '@/src/core/tenant/tenant-context';

export default function ReplacementRoute() {
  const { tenant } = useTenant();
  const replacementRepo = getReplacementRepository(tenant);
  const traceabilityRepo = getTraceabilityRepository(tenant);

  if (!replacementRepo || !traceabilityRepo) {
    return (
      <Screen title="Replacement">
        <Card>
          <Text>Replacement is not available for this tenant.</Text>
        </Card>
      </Screen>
    );
  }
  return (
    <ReplacementScreen
      replacementRepo={replacementRepo}
      traceabilityRepo={traceabilityRepo}
    />
  );
}
