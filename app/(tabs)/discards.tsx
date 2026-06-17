import { useTenant } from '@/src/core/tenant/tenant-context';
import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { KarenDiscardsScreen } from '@/src/tenants/karen/features/discards/DiscardsScreen';

export default function DiscardsRoute() {
  const { tenant } = useTenant();
  switch (tenant) {
    case 'Karen':
    case 'Demo':
      return <KarenDiscardsScreen />;
    default:
      return <PendingScreen feature="Discards" tenant={tenant} />;
  }
}
