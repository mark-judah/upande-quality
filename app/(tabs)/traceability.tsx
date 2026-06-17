import { Text } from 'react-native';
import { Screen } from '@/src/core/ui/Screen';
import { Card } from '@/src/core/ui/Card';
import { TraceabilityScreen } from '@/src/core/features/traceability/TraceabilityScreen';
import { getTraceabilityRepository } from '@/src/composition/traceability-resolver';
import { useTenant } from '@/src/core/tenant/tenant-context';

export default function TraceabilityRoute() {
  const { tenant } = useTenant();
  const repository = getTraceabilityRepository(tenant);

  if (!repository) {
    return (
      <Screen title="Traceability">
        <Card>
          <Text>Tenant not configured.</Text>
        </Card>
      </Screen>
    );
  }
  return <TraceabilityScreen repository={repository} />;
}
