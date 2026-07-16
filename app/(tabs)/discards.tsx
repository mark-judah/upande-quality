import { useTenant } from '@/src/core/tenant/tenant-context';
import { RequireStation } from '@/src/core/tenant/RequireStation';
import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { KarenDiscardsScreen } from '@/src/tenants/karen/features/discards/DiscardsScreen';

export default function DiscardsRoute() {
  const { tenant } = useTenant();

  if (tenant !== 'Karen' && tenant !== 'Demo') {
    return <PendingScreen feature="Discards" tenant={tenant} />;
  }

  return (
    <RequireStation next="/discards">
      {(station) => <KarenDiscardsScreen userFarm={station.userFarm} />}
    </RequireStation>
  );
}
