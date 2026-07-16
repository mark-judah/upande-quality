import { useTenant } from '@/src/core/tenant/tenant-context';
import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { PackhouseQcScreen } from '@/src/tenants/karen/features/packhouse-qc/PackhouseQcScreen';

export default function PackhouseQcRoute() {
  const { tenant } = useTenant();

  if (tenant !== 'Karen' && tenant !== 'Demo') {
    return <PendingScreen feature="Packhouse QC" tenant={tenant} />;
  }

  return <PackhouseQcScreen />;
}
