import { useTenant } from '@/src/core/tenant/tenant-context';
import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { PackhouseCleaningHubScreen } from '@/src/tenants/karen/features/packhouse-cleaning/PackhouseCleaningHubScreen';

export default function PackhouseChecksRoute() {
  const { tenant } = useTenant();
  if (tenant !== 'Karen' && tenant !== 'Demo') {
    return <PendingScreen feature="Packhouse Cleaning" tenant={tenant} />;
  }
  return <PackhouseCleaningHubScreen />;
}
