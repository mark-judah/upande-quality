import { useTenant } from '@/src/core/tenant/tenant-context';
import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { KarenFlowerAuditHubScreen } from '@/src/tenants/karen/features/flower-audit/FlowerAuditHubScreen';

export default function FlowerAuditRoute() {
  const { tenant } = useTenant();
  if (tenant !== 'Karen' && tenant !== 'Demo') {
    return <PendingScreen feature="Flower Audit" tenant={tenant} />;
  }
  return <KarenFlowerAuditHubScreen />;
}
