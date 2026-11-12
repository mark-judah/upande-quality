import { useTenant } from '@/src/core/tenant/tenant-context';
import { NotReceivedScreen } from '@/src/tenants/karen/features/not-received/NotReceivedScreen';
import { PendingScreen } from '@/src/core/ui/PendingScreen';

export default function NotReceivedRoute() {
  const { tenant } = useTenant();
  switch (tenant) {
    case 'Karen':
    case 'Demo':
      return <NotReceivedScreen />;
    default:
      return <PendingScreen feature="Not Received" tenant={tenant} />;
  }
}
