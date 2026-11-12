import { useTenant } from '@/src/core/tenant/tenant-context';
import { NeedsAttentionScreen } from '@/src/tenants/karen/features/needs-attention/NeedsAttentionScreen';
import { PendingScreen } from '@/src/core/ui/PendingScreen';

export default function NeedsAttentionRoute() {
  const { tenant } = useTenant();
  switch (tenant) {
    case 'Karen':
    case 'Demo':
      return <NeedsAttentionScreen />;
    default:
      return <PendingScreen feature="Needs Attention" tenant={tenant} />;
  }
}
