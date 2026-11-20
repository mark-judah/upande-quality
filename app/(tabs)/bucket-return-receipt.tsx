import { useTenant } from '@/src/core/tenant/tenant-context';
import { RequireStation } from '@/src/core/tenant/RequireStation';
import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { KarenBucketReturnReceiptScreen } from '@/src/tenants/karen/features/bucket-return-receipt/BucketReturnReceiptScreen';

export default function BucketReturnReceiptRoute() {
  const { tenant } = useTenant();

  if (tenant !== 'Karen' && tenant !== 'Demo') {
    return <PendingScreen feature="Bucket Return Receipt" tenant={tenant} />;
  }

  return (
    <RequireStation next="/bucket-return-receipt">
      {(station) => <KarenBucketReturnReceiptScreen userFarm={station.userFarm} />}
    </RequireStation>
  );
}
