import { useTenant } from '@/src/core/tenant/tenant-context';
import { RequireStation } from '@/src/core/tenant/RequireStation';
import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { KarenCleaningRecordScreen } from '@/src/tenants/karen/features/coldroom/CleaningRecordScreen';

export default function CleaningRecordRoute() {
  const { tenant } = useTenant();
  if (tenant !== 'Karen' && tenant !== 'Demo') {
    return <PendingScreen feature="Coldroom Cleaning" tenant={tenant} />;
  }
  return (
    <RequireStation next="/cleaning-record">
      {(station) => <KarenCleaningRecordScreen userFarm={station.userFarm} />}
    </RequireStation>
  );
}
