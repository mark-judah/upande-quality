import { useTenant } from '@/src/core/tenant/tenant-context';
import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { KarenBucketCleaningScreen } from '@/src/tenants/karen/features/packhouse-cleaning/BucketCleaningScreen';

export default function BucketCleaningRoute() {
  const { tenant } = useTenant();
  if (tenant !== 'Karen' && tenant !== 'Demo') {
    return <PendingScreen feature="Bucket Cleaning" tenant={tenant} />;
  }
  return <KarenBucketCleaningScreen />;
}
