import { useTenant } from '@/src/core/tenant/tenant-context';
import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { KarenFreeShelvesScreen } from '@/src/tenants/karen/features/free-shelves/FreeShelvesScreen';

export default function FreeShelvesRoute() {
  const { tenant } = useTenant();

  if (tenant !== 'Karen' && tenant !== 'Demo') {
    return <PendingScreen feature="Free Shelves" tenant={tenant} />;
  }

  return <KarenFreeShelvesScreen />;
}
