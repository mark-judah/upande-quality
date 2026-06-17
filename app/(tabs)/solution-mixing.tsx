import { useTenant } from '@/src/core/tenant/tenant-context';
import { RequireStation } from '@/src/core/tenant/RequireStation';
import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { KarenSolutionMixingScreen } from '@/src/tenants/karen/features/solution-mixing/SolutionMixingScreen';

export default function SolutionMixingRoute() {
  const { tenant } = useTenant();

  if (tenant !== 'Karen' && tenant !== 'Demo') {
    return <PendingScreen feature="Solution Mixing" tenant={tenant} />;
  }

  return (
    <RequireStation next="/solution-mixing">
      {(station) => <KarenSolutionMixingScreen userFarm={station.userFarm} />}
    </RequireStation>
  );
}
