import { useTenant } from '@/src/core/tenant/tenant-context';
import { RequireStation } from '@/src/core/tenant/RequireStation';
import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { KarenInspectionLogScreen } from '@/src/tenants/karen/features/coldroom/InspectionLogScreen';

export default function InspectionLogRoute() {
  const { tenant } = useTenant();
  if (tenant !== 'Karen' && tenant !== 'Demo') {
    return <PendingScreen feature="Coldroom Inspection" tenant={tenant} />;
  }
  return (
    <RequireStation next="/inspection-log">
      {(station) => <KarenInspectionLogScreen userFarm={station.userFarm} />}
    </RequireStation>
  );
}
