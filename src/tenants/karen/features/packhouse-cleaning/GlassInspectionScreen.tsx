import { useKarenPackhouseCleaningStore } from '@/src/tenants/karen/state/karen-packhouse-cleaning-store';
import { PackhouseChecklistScreen } from './PackhouseChecklistScreen';
import { GLASS_AREAS, GLASS_COMPONENTS } from './constants';

export function KarenPackhouseGlassScreen() {
  const submitting = useKarenPackhouseCleaningStore((s) => s.submitting);
  const submitGlass = useKarenPackhouseCleaningStore((s) => s.submitGlass);
  return (
    <PackhouseChecklistScreen
      title="Glass Materials Inspection"
      areaLabel="Area inspected"
      areas={GLASS_AREAS}
      components={GLASS_COMPONENTS}
      submitting={submitting}
      onSubmit={submitGlass}
    />
  );
}
