import { useTenant } from '@/src/core/tenant/tenant-context';
import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { KarenGreenHouseIntegrityScreen } from '@/src/tenants/karen/features/greenhouse-integrity/GreenHouseIntegrityScreen';

export default function GreenHouseIntegrityRoute() {
  const { tenant } = useTenant();
  if (tenant !== 'Karen' && tenant !== 'Demo') {
    return <PendingScreen feature="GreenHouse Integrity" tenant={tenant} />;
  }
  return <KarenGreenHouseIntegrityScreen />;
}
