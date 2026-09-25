import { useTenant } from '@/src/core/tenant/tenant-context';
import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { KarenVehicleHygieneScreen } from '@/src/tenants/karen/features/packhouse-cleaning/VehicleHygieneScreen';

export default function VehicleHygieneRoute() {
  const { tenant } = useTenant();
  if (tenant !== 'Karen' && tenant !== 'Demo') {
    return <PendingScreen feature="Vehicle Hygiene" tenant={tenant} />;
  }
  return <KarenVehicleHygieneScreen />;
}
