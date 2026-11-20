import { useTenant } from '@/src/core/tenant/tenant-context';
import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { KarenGreenhousePestScreen } from '@/src/tenants/karen/features/greenhouse-pest/GreenhousePestScreen';

export default function GreenhousePestRoute() {
  const { tenant } = useTenant();
  if (tenant !== 'Karen' && tenant !== 'Demo') {
    return <PendingScreen feature="Greenhouse Pest" tenant={tenant} />;
  }
  return <KarenGreenhousePestScreen />;
}
