import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { useTenant } from '@/src/core/tenant/tenant-context';

export default function PackhouseQcRoute() {
  const { tenant } = useTenant();
  return <PendingScreen feature="Packhouse QC" tenant={tenant} />;
}
