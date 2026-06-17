import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { useTenant } from '@/src/core/tenant/tenant-context';

export default function ColdroomQcRoute() {
  const { tenant } = useTenant();
  return <PendingScreen feature="Coldroom QC" tenant={tenant} />;
}
