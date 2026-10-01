import { useTenant } from '@/src/core/tenant/tenant-context';
import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { KarenColdroomQcScreen } from '@/src/tenants/karen/features/coldroom-qc/ColdroomQcScreen';

export default function ColdroomQcRoute() {
  const { tenant } = useTenant();
  if (tenant !== 'Karen' && tenant !== 'Demo') {
    return <PendingScreen feature="Coldroom QC" tenant={tenant} />;
  }
  return <KarenColdroomQcScreen />;
}
