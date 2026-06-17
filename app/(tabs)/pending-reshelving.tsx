import { Text } from 'react-native';
import { Screen } from '@/src/core/ui/Screen';
import { Card } from '@/src/core/ui/Card';
import { PendingReshelvingScreen } from '@/src/core/features/pending-reshelving/PendingReshelvingScreen';
import { getReplacementRepository } from '@/src/composition/replacement-resolver';
import { useTenant } from '@/src/core/tenant/tenant-context';

export default function PendingReshelvingRoute() {
  const { tenant } = useTenant();
  const repository = getReplacementRepository(tenant);

  if (!repository) {
    return (
      <Screen title="Pending Reshelving">
        <Card>
          <Text>Pending Reshelving is not available for this tenant.</Text>
        </Card>
      </Screen>
    );
  }
  return <PendingReshelvingScreen repository={repository} />;
}
