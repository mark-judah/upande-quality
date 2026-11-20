import { useTenant } from '@/src/core/tenant/tenant-context';
import { RequireStation } from '@/src/core/tenant/RequireStation';
import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { KarenBucketReturnDispatchScreen } from '@/src/tenants/karen/features/bucket-return-dispatch/BucketReturnDispatchScreen';

export default function BucketReturnDispatchRoute() {
  const { tenant } = useTenant();

  if (tenant !== 'Karen' && tenant !== 'Demo') {
    return <PendingScreen feature="Bucket Return Dispatch" tenant={tenant} />;
  }

  return (
    <RequireStation next="/bucket-return-dispatch">
      {(station) => <KarenBucketReturnDispatchScreen userFarm={station.userFarm} />}
    </RequireStation>
  );
}
