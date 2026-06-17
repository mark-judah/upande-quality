import { useTenant } from '@/src/core/tenant/tenant-context';
import { RequireStation } from '@/src/core/tenant/RequireStation';
import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { KarenQcScreen } from '@/src/tenants/karen/features/qc/QCScreen';

export default function IntakeQcRoute() {
  const { tenant } = useTenant();

  if (tenant !== 'Karen' && tenant !== 'Demo') {
    return <PendingScreen feature="Intake QC" tenant={tenant} />;
  }

  return (
    <RequireStation next="/intake-qc">
      {(station) => (
        <KarenQcScreen
          userFarm={station.userFarm}
          userGreenhouse={station.userGreenhouse}
        />
      )}
    </RequireStation>
  );
}
