import { useTenant } from '@/src/core/tenant/tenant-context';
import { RequireStation } from '@/src/core/tenant/RequireStation';
import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { KarenTemperatureLogScreen } from '@/src/tenants/karen/features/coldroom/TemperatureLogScreen';

export default function TemperatureLogRoute() {
  const { tenant } = useTenant();
  if (tenant !== 'Karen' && tenant !== 'Demo') {
    return <PendingScreen feature="Cold Store Temperature" tenant={tenant} />;
  }
  return (
    <RequireStation next="/temperature-log">
      {(station) => <KarenTemperatureLogScreen userFarm={station.userFarm} />}
    </RequireStation>
  );
}
