import { useTenant } from '@/src/core/tenant/tenant-context';
import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { KarenPackhouseCleaningScreen } from '@/src/tenants/karen/features/packhouse-cleaning/CleaningRecordScreen';

export default function PackhouseCleaningRoute() {
  const { tenant } = useTenant();
  if (tenant !== 'Karen' && tenant !== 'Demo') {
    return <PendingScreen feature="Packhouse Cleaning" tenant={tenant} />;
  }
  return <KarenPackhouseCleaningScreen />;
}
