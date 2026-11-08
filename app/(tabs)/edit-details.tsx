import { Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Screen } from '@/src/core/ui/Screen';
import { Card } from '@/src/core/ui/Card';
import { EditDetailsScreen } from '@/src/core/features/edit-details/EditDetailsScreen';
import { getReplacementRepository } from '@/src/composition/replacement-resolver';
import { getTraceabilityRepository } from '@/src/composition/traceability-resolver';
import { useTenant } from '@/src/core/tenant/tenant-context';

export default function EditDetailsRoute() {
  const { tenant } = useTenant();
  const { bucket, t } = useLocalSearchParams<{ bucket?: string; t?: string }>();
  const replacementRepo = getReplacementRepository(tenant);
  const traceabilityRepo = getTraceabilityRepository(tenant);

  if (!replacementRepo || !traceabilityRepo) {
    return (
      <Screen title="Edit Details">
        <Card>
          <Text>Edit Details is not available for this tenant.</Text>
        </Card>
      </Screen>
    );
  }
  return (
    <EditDetailsScreen
      replacementRepo={replacementRepo}
      traceabilityRepo={traceabilityRepo}
      initialBucketId={bucket}
      requestKey={t}
    />
  );
}
