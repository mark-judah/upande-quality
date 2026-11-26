import { useEffect } from 'react';
import { Screen } from '@/src/core/ui/Screen';
import { useKarenPackhouseCleaningStore } from '@/src/tenants/karen/state/karen-packhouse-cleaning-store';
import { PackhouseChecklistScreen } from './PackhouseChecklistScreen';

const TITLE = 'Packhouse Inspection Log';

/** Areas (Post Harvest Team) and items (Packhouse Inspection Item) come from the server, where
 *  Quality Managers maintain them. */
export function KarenPackhouseInspectionScreen() {
  const submitting = useKarenPackhouseCleaningStore((s) => s.submitting);
  const submitInspection = useKarenPackhouseCleaningStore((s) => s.submitInspection);
  const areas = useKarenPackhouseCleaningStore((s) => s.inspectionAreas);
  const components = useKarenPackhouseCleaningStore((s) => s.inspectionComponents);
  const loading = useKarenPackhouseCleaningStore((s) => s.setupLoading);
  const error = useKarenPackhouseCleaningStore((s) => s.setupError);
  const load = useKarenPackhouseCleaningStore((s) => s.loadInspectionSetup);

  useEffect(() => {
    load();
  }, [load]);

  if (components.length === 0) {
    return (
      <Screen
        title={TITLE}
        loading={loading}
        error={error ?? (loading ? null : 'No inspection items are set up yet (Packhouse Inspection Item).')}
        onRetry={load}
      >
        {null}
      </Screen>
    );
  }
  return (
    <PackhouseChecklistScreen
      title={TITLE}
      areaLabel="Area inspected"
      areas={areas}
      components={components}
      submitting={submitting}
      onSubmit={submitInspection}
    />
  );
}
