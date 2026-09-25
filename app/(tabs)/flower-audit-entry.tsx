import { useLocalSearchParams } from 'expo-router';
import { useTenant } from '@/src/core/tenant/tenant-context';
import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { KarenFlowerAuditHubScreen } from '@/src/tenants/karen/features/flower-audit/FlowerAuditHubScreen';
import { KarenFlowerAuditScreen } from '@/src/tenants/karen/features/flower-audit/FlowerAuditScreen';
import { auditBySlug } from '@/src/tenants/karen/features/flower-audit/constants';

export default function FlowerAuditEntryRoute() {
  const { tenant } = useTenant();
  const { audit: slug } = useLocalSearchParams<{ audit?: string }>();
  if (tenant !== 'Karen' && tenant !== 'Demo') {
    return <PendingScreen feature="Flower Audit" tenant={tenant} />;
  }
  const audit = auditBySlug(slug);
  // Deep-linked without a known audit type — fall back to the picker.
  if (!audit) return <KarenFlowerAuditHubScreen />;
  return <KarenFlowerAuditScreen audit={audit} />;
}
