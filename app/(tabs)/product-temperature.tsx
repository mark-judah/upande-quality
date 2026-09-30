import { useTenant } from '@/src/core/tenant/tenant-context';
import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { KarenProductTemperatureScreen } from '@/src/tenants/karen/features/product-temperature/ProductTemperatureScreen';

export default function ProductTemperatureRoute() {
  const { tenant } = useTenant();
  if (tenant !== 'Karen' && tenant !== 'Demo') {
    return <PendingScreen feature="Product Temperature" tenant={tenant} />;
  }
  return <KarenProductTemperatureScreen />;
}
