import { useTenant } from '@/src/core/tenant/tenant-context';
import { RequireStation } from '@/src/core/tenant/RequireStation';
import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { KarenBucketCountScreen } from '@/src/tenants/karen/features/bucket-count/BucketCountScreen';

export default function BucketCountRoute() {
  const { tenant } = useTenant();

  if (tenant !== 'Karen' && tenant !== 'Demo') {
    return <PendingScreen feature="Bucket Count" tenant={tenant} />;
  }

  return (
    <RequireStation next="/bucket-count" title="Bucket Count">
      {(station) => <KarenBucketCountScreen userFarm={station.userFarm} />}
    </RequireStation>
  );
}
