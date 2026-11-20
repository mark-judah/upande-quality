import { karenVehicleInspectionApi, RawVehicle, RawVehicleInspection } from '../api/karen-vehicle-inspection-api';

export type AreaKey =
  | 'front_wall'
  | 'left_side'
  | 'right_side'
  | 'floor'
  | 'ceiling_roof'
  | 'doors'
  | 'undercarriage';

export type AreaStatus = 'OK' | 'Defective';

export const AREAS: { key: AreaKey; label: string }[] = [
  { key: 'front_wall', label: 'Front Wall' },
  { key: 'left_side', label: 'Left Side' },
  { key: 'right_side', label: 'Right Side' },
  { key: 'floor', label: 'Floor' },
  { key: 'ceiling_roof', label: 'Ceiling / Roof' },
  { key: 'doors', label: 'Doors (Inside / Outside)' },
  { key: 'undercarriage', label: 'Outside / Undercarriage' },
];

export type VehicleOption = { value: string; label: string; sublabel?: string };

export type SubmitInput = {
  vehicle: string;
  driverName: string;
  inspectedBy: string | null;
  areas: Partial<Record<AreaKey, AreaStatus>>;
  defectNotes: string;
};

/** "YYYY-MM-DD HH:MM:SS" in local time, the format Frappe stores Datetime in. */
function now(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function frappeError(
  body: { _server_messages?: string; message?: string; exc_type?: string } | undefined,
  fallback: string,
): string {
  if (!body) return fallback;
  if (body._server_messages) {
    try {
      const msgs = JSON.parse(body._server_messages) as string[];
      const first = msgs[0];
      if (first) {
        const parsed = JSON.parse(first) as { message?: string };
        if (parsed.message) return parsed.message.replace(/<[^>]*>/g, '');
      }
    } catch {
      /* fall through */
    }
  }
  if (body.message) return body.message;
  return fallback;
}

function mapVehicle(v: RawVehicle): VehicleOption {
  const plate = v.license_plate?.trim();
  const desc = v.description?.trim();
  return {
    value: v.name ?? '',
    label: plate || v.name || '—',
    sublabel: desc || (plate ? v.name : undefined),
  };
}

export const karenVehicleInspectionRepository = {
  async loadVehicles(): Promise<VehicleOption[]> {
    const res = await karenVehicleInspectionApi.listVehicles();
    if (res.exc_type) throw new Error(frappeError(res, 'Could not load vehicles.'));
    return (res.data ?? []).map(mapVehicle).filter((v) => v.value);
  },

  async submit(input: SubmitInput): Promise<string> {
    const doc: RawVehicleInspection = {
      vehicle: input.vehicle,
      inspection_datetime: now(),
    };
    if (input.driverName.trim()) doc.driver_name = input.driverName.trim();
    if (input.inspectedBy) doc.inspected_by = input.inspectedBy;
    if (input.defectNotes.trim()) doc.defect_notes = input.defectNotes.trim();
    for (const { key } of AREAS) {
      const v = input.areas[key];
      if (v) (doc as Record<string, unknown>)[key] = v;
    }
    const res = await karenVehicleInspectionApi.create(doc);
    if (res.exc_type || !res.data?.name) {
      throw new Error(frappeError(res, 'Could not save the inspection.'));
    }
    return res.data.name;
  },
};
