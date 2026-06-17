import { useTenant } from '@/src/core/tenant/tenant-context';
import { RequireStation } from '@/src/core/tenant/RequireStation';
import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { KarenShelvingScreen } from '@/src/tenants/karen/features/shelving/ShelvingScreen';

export default function ShelvingRoute() {
  const { tenant } = useTenant();

  if (tenant !== 'Karen' && tenant !== 'Demo') {
    return <PendingScreen feature="Shelving" tenant={tenant} />;
  }

  return (
    <RequireStation next="/shelving">
      {(station) => <KarenShelvingScreen userFarm={station.userFarm} />}
    </RequireStation>
  );
}
