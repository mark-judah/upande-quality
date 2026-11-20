import { useTenant } from '@/src/core/tenant/tenant-context';
import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { KarenVehicleInspectionScreen } from '@/src/tenants/karen/features/vehicle-inspection/VehicleInspectionScreen';

export default function VehicleInspectionRoute() {
  const { tenant } = useTenant();
  if (tenant !== 'Karen' && tenant !== 'Demo') {
    return <PendingScreen feature="Vehicle Inspection" tenant={tenant} />;
  }
  return <KarenVehicleInspectionScreen />;
}
