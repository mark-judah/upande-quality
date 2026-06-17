import { useTenant } from '@/src/core/tenant/tenant-context';
import { KarenReceivingScreen } from '@/src/tenants/karen/features/receiving/ReceivingScreen';
import { PendingScreen } from '@/src/core/ui/PendingScreen';

export default function ReceivingRoute() {
  const { tenant } = useTenant();
  switch (tenant) {
    case 'Karen':
    case 'Demo':
      return <KarenReceivingScreen />;
    default:
      return <PendingScreen feature="Receiving" tenant={tenant} />;
  }
}
