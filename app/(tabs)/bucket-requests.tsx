import { useTenant } from '@/src/core/tenant/tenant-context';
import { RequireStation } from '@/src/core/tenant/RequireStation';
import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { KarenBucketRequestsScreen } from '@/src/tenants/karen/features/bucket-requests/BucketRequestsScreen';

export default function BucketRequestsRoute() {
  const { tenant } = useTenant();

  if (tenant !== 'Karen' && tenant !== 'Demo') {
    return <PendingScreen feature="Bucket Requests" tenant={tenant} />;
  }

  return (
    <RequireStation next="/bucket-requests">
      {(station) => <KarenBucketRequestsScreen userFarm={station.userFarm} />}
    </RequireStation>
  );
}
