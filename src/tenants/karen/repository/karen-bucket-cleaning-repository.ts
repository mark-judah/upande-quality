import {
  karenBucketCleaningApi,
  type BucketCleaningPayload,
} from '../api/karen-bucket-cleaning-api';

export type ChemicalOption = { value: string; label: string };

export type FormData = {
  detergents: ChemicalOption[];
  disinfectants: ChemicalOption[];
};

export type SubmitOutcome =
  | { kind: 'ok'; name: string; message: string }
  | { kind: 'error'; message: string };

const toChemicals = (rows: { name?: string; item_name?: string }[] = []): ChemicalOption[] =>
  rows
    .filter((r) => !!r.name)
    .map((r) => ({ value: r.name as string, label: r.item_name || (r.name as string) }));

export const karenBucketCleaningRepository = {
  async fetchFormData(): Promise<FormData> {
    const res = await karenBucketCleaningApi.fetchFormData();
    const m = res.message ?? {};
    if (m.success === false) throw new Error(m.error || 'Could not load form data.');
    return {
      detergents: toChemicals(m.detergents),
      disinfectants: toChemicals(m.disinfectants),
    };
  },

  async submit(payload: BucketCleaningPayload): Promise<SubmitOutcome> {
    const res = await karenBucketCleaningApi.submit(payload);
    const m = res.message ?? {};
    if (m.status === 'success') {
      return { kind: 'ok', name: m.name ?? '', message: m.message ?? 'Saved.' };
    }
    return { kind: 'error', message: m.message ?? 'Save failed.' };
  },
};
