import { useTenant } from '@/src/core/tenant/tenant-context';
import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { KarenBucketTransfersScreen } from '@/src/tenants/karen/features/bucket-transfers/BucketTransfersScreen';

export default function BucketTransfersRoute() {
  const { tenant } = useTenant();
  switch (tenant) {
    case 'Karen':
    case 'Demo':
      return <KarenBucketTransfersScreen />;
    default:
      return <PendingScreen feature="Bucket Transfers" tenant={tenant} />;
  }
}
