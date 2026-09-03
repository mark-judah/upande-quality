import { mapAxiosError } from '@/src/core/api/client';
import { karenVaselifeApi, type RawVaselifeBucket, type RawVaselifeFormData } from '../api/karen-vaselife-api';

export type VaselifeBreeder = { name: string };
export type VaselifeVariety = { name: string; variety: string; breeder: string; item_group: string };
export type VaselifeCrop = { name: string };
export type VaselifeCommercialStatus = { name: string };
export type VaselifeCutStage = { name: string };
export type VaselifeFailureReason = { name: string };
export type VaselifeSampleRef = { code: string; variety: string; samplingDate: string };

export type VaselifeFormData = {
  breeders: VaselifeBreeder[];
  varieties: VaselifeVariety[];
  crops: VaselifeCrop[];
  commercialStatuses: VaselifeCommercialStatus[];
  cutStages: VaselifeCutStage[];
  failureReasons: VaselifeFailureReason[];
  samples: VaselifeSampleRef[];
};

export type VaselifeBucket = {
  bucketId: string;
  harvestDate: string;
  harvestTime: string;
  farm: string;
  gh: string;
  length: string;
};

export type FormDataOutcome = ({ kind: 'ok' } & VaselifeFormData) | { kind: 'error'; message: string };
export type BucketOutcome = { kind: 'ok'; bucket: VaselifeBucket } | { kind: 'error'; message: string };
export type SampleSaveOutcome =
  | { kind: 'ok'; name: string; sampleCode: string; message: string }
  | { kind: 'error'; message: string };
export type ObservationSaveOutcome =
  | { kind: 'ok'; name: string; message: string }
  | { kind: 'error'; message: string };

function toBucket(raw: RawVaselifeBucket): VaselifeBucket {
  return {
    bucketId: String(raw.bucket_id ?? ''),
    harvestDate: String(raw.harvest_date ?? ''),
    harvestTime: String(raw.harvest_time ?? ''),
    farm: String(raw.farm ?? ''),
    gh: String(raw.greenhouse ?? ''),
    length: String(raw.length ?? ''),
  };
}

export const karenVaselifeRepository = {
  async fetchFormData(): Promise<FormDataOutcome> {
    try {
      const res = await karenVaselifeApi.fetchFormData();
      const m: RawVaselifeFormData = res.message ?? res.data ?? {};
      if (m.success === false) return { kind: 'error', message: m.error ?? 'Failed to load form data.' };
      return {
        kind: 'ok',
        breeders: (m.breeders ?? [])
          .map((b) => ({ name: String(b.name ?? '') }))
          .filter((b) => b.name),
        varieties: (m.varieties ?? [])
          .map((v) => ({
            name: String(v.name ?? ''),
            variety: String(v.variety ?? v.name ?? ''),
            breeder: String(v.breeder ?? ''),
            item_group: String(v.item_group ?? ''),
          }))
          .filter((v) => v.name),
        crops: (m.crops ?? [])
          .map((c) => ({ name: String(c.name ?? '') }))
          .filter((c) => c.name),
        commercialStatuses: (m.commercial_statuses ?? [])
          .map((s) => ({ name: String(s.name ?? '') }))
          .filter((s) => s.name),
        cutStages: (m.cut_stages ?? [])
          .map((s) => ({ name: String(s.name ?? '') }))
          .filter((s) => s.name),
        failureReasons: (m.failure_reasons ?? [])
          .map((r) => ({ name: String(r.name ?? '') }))
          .filter((r) => r.name),
        samples: (m.samples ?? [])
          .map((sm) => ({
            code: String(sm.name ?? ''),
            variety: String(sm.variety ?? ''),
            samplingDate: String(sm.sampling_date ?? ''),
          }))
          .filter((sm) => sm.code),
      };
    } catch (err) {
      return { kind: 'error', message: mapAxiosError(err).message };
    }
  },

  async getBucket(bucketId: string): Promise<BucketOutcome> {
    try {
      const res = await karenVaselifeApi.getBucket(bucketId);
      const m: RawVaselifeBucket = res.message ?? res.data ?? {};
      if (m.success === false) return { kind: 'error', message: m.error ?? 'Bucket not found.' };
      return { kind: 'ok', bucket: toBucket(m) };
    } catch (err) {
      return { kind: 'error', message: mapAxiosError(err).message };
    }
  },

  async saveSample(payload: Record<string, unknown>): Promise<SampleSaveOutcome> {
    try {
      const res = await karenVaselifeApi.saveSample(payload);
      const m = res.message ?? {};
      if (m.status === 'success' && m.name) {
        return {
          kind: 'ok',
          name: m.name,
          sampleCode: String(m.sample_code ?? m.name),
          message: m.message ?? `Sample ${m.sample_code ?? m.name} saved.`,
        };
      }
      return { kind: 'error', message: m.message ?? 'Failed to save sample.' };
    } catch (err) {
      return { kind: 'error', message: mapAxiosError(err).message };
    }
  },

  async saveObservation(payload: Record<string, unknown>): Promise<ObservationSaveOutcome> {
    try {
      const res = await karenVaselifeApi.saveObservation(payload);
      const m = res.message ?? {};
      if (m.status === 'success' && m.name) {
        return { kind: 'ok', name: m.name, message: m.message ?? `Observation ${m.name} saved.` };
      }
      return { kind: 'error', message: m.message ?? 'Failed to save observation.' };
    } catch (err) {
      return { kind: 'error', message: mapAxiosError(err).message };
    }
  },
};
