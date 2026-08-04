import { useTenant } from '@/src/core/tenant/tenant-context';
import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { KarenPackhouseGlassScreen } from '@/src/tenants/karen/features/packhouse-cleaning/GlassInspectionScreen';

export default function PackhouseGlassRoute() {
  const { tenant } = useTenant();
  if (tenant !== 'Karen' && tenant !== 'Demo') {
    return <PendingScreen feature="Glass Inspection" tenant={tenant} />;
  }
  return <KarenPackhouseGlassScreen />;
}
