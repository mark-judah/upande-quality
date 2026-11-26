import { useTenant } from '@/src/core/tenant/tenant-context';
import { NotShelvedScreen } from '@/src/tenants/karen/features/not-shelved/NotShelvedScreen';
import { PendingScreen } from '@/src/core/ui/PendingScreen';

export default function NotShelvedRoute() {
  const { tenant } = useTenant();
  switch (tenant) {
    case 'Karen':
    case 'Demo':
      return <NotShelvedScreen />;
    default:
      return <PendingScreen feature="Received Not Shelved" tenant={tenant} />;
  }
}
