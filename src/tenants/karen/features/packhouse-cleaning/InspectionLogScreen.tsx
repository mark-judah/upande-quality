import { useKarenPackhouseCleaningStore } from '@/src/tenants/karen/state/karen-packhouse-cleaning-store';
import { PackhouseChecklistScreen } from './PackhouseChecklistScreen';
import { INSPECTION_AREAS, INSPECTION_COMPONENTS } from './constants';

export function KarenPackhouseInspectionScreen() {
  const submitting = useKarenPackhouseCleaningStore((s) => s.submitting);
  const submitInspection = useKarenPackhouseCleaningStore((s) => s.submitInspection);
  return (
    <PackhouseChecklistScreen
      title="Packhouse Inspection Log"
      areaLabel="Area inspected"
      areas={INSPECTION_AREAS}
      components={INSPECTION_COMPONENTS}
      submitting={submitting}
      onSubmit={submitInspection}
    />
  );
}
