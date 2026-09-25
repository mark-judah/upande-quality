import { useTenant } from '@/src/core/tenant/tenant-context';
import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { KarenFreightDispatchScreen } from '@/src/tenants/karen/features/freight-dispatch/FreightDispatchScreen';

export default function FreightDispatchRoute() {
  const { tenant } = useTenant();
  if (tenant !== 'Karen' && tenant !== 'Demo') {
    return <PendingScreen feature="Freight Dispatch" tenant={tenant} />;
  }
  return <KarenFreightDispatchScreen />;
}
