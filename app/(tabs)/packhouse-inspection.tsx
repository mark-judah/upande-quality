import { useTenant } from '@/src/core/tenant/tenant-context';
import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { KarenPackhouseInspectionScreen } from '@/src/tenants/karen/features/packhouse-cleaning/InspectionLogScreen';

export default function PackhouseInspectionRoute() {
  const { tenant } = useTenant();
  if (tenant !== 'Karen' && tenant !== 'Demo') {
    return <PendingScreen feature="Packhouse Inspection" tenant={tenant} />;
  }
  return <KarenPackhouseInspectionScreen />;
}
