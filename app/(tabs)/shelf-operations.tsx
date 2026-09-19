import { useTenant } from '@/src/core/tenant/tenant-context';
import { RequireStation } from '@/src/core/tenant/RequireStation';
import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { KarenShelfOperationsScreen } from '@/src/tenants/karen/features/shelf-operations/ShelfOperationsScreen';

export default function ShelfOperationsRoute() {
  const { tenant } = useTenant();

  if (tenant !== 'Karen' && tenant !== 'Demo') {
    return <PendingScreen feature="Shelf Operations" tenant={tenant} />;
  }

  return (
    <RequireStation next="/shelf-operations">
      {(station) => <KarenShelfOperationsScreen userFarm={station.userFarm} />}
    </RequireStation>
  );
}
