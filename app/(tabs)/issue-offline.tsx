import { useTenant } from '@/src/core/tenant/tenant-context';
import { RequireStation } from '@/src/core/tenant/RequireStation';
import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { KarenShelfOperationsScreen } from '@/src/tenants/karen/features/shelf-operations/ShelfOperationsScreen';

/** Sidebar shortcut: Shelf Operations opened on its Issue Offline tab. */
export default function IssueOfflineRoute() {
  const { tenant } = useTenant();

  if (tenant !== 'Karen' && tenant !== 'Demo') {
    return <PendingScreen feature="Issue Offline" tenant={tenant} />;
  }

  return (
    <RequireStation next="/issue-offline">
      {(station) => <KarenShelfOperationsScreen userFarm={station.userFarm} initialMode="issue-offline" />}
    </RequireStation>
  );
}
