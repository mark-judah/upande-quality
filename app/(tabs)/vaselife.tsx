import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { useTenant } from '@/src/core/tenant/tenant-context';
import { VaselifeScreen } from '@/src/tenants/karen/features/vaselife/VaselifeScreen';

export default function VaselifeRoute() {
  const { tenant } = useTenant();

  if (tenant !== 'Karen' && tenant !== 'Demo') {
    return <PendingScreen feature="Vaselife" tenant={tenant} />;
  }

  return <VaselifeScreen />;
}
