import {
  karenGreenhouseIntegrityApi,
  type RawGreenHouseIntegrity,
} from '../api/karen-greenhouse-integrity-api';

export type YesNo = 'NO' | 'YES';

export type CheckKey =
  | 'roof_torn'
  | 'top_vent_torn_holes'
  | 'side_curtain_torn_holes'
  | 'skirting_torn_holes'
  | 'quarter_moon_torn_holes'
  | 'half_moon_torn_holes'
  | 'bottom_polythene_not_tucked'
  | 'side_net_torn_holes'
  | 'gaps_gutter'
  | 'gaps_halfmoon'
  | 'gaps_skirting'
  | 'gaps_top_vent'
  | 'gaps_quartermoon'
  | 'double_door_not_self_closing'
  | 'door_cover_torn_holes'
  | 'gaps_door_frames'
  | 'gaps_door_ground';

/** The 17 checklist toggles, in display order. All optional. */
export const CHECKS: { key: CheckKey; label: string }[] = [
  { key: 'roof_torn', label: 'Roof torn' },
  { key: 'top_vent_torn_holes', label: 'Top vent torn/holes' },
  { key: 'side_curtain_torn_holes', label: 'Side Curtain torn/holes' },
  { key: 'skirting_torn_holes', label: 'Skirting torn/holes' },
  { key: 'quarter_moon_torn_holes', label: 'Quarter Moon torn/holes' },
  { key: 'half_moon_torn_holes', label: 'Half moon torn/holes' },
  { key: 'bottom_polythene_not_tucked', label: 'Bottom polythene not tucked' },
  { key: 'side_net_torn_holes', label: 'Side net torn/holes' },
  { key: 'gaps_gutter', label: 'Gaps along/at the Gutter' },
  { key: 'gaps_halfmoon', label: 'Gaps along halfmoon' },
  { key: 'gaps_skirting', label: 'Gaps along the skirting' },
  { key: 'gaps_top_vent', label: 'Gaps along Top vent' },
  { key: 'gaps_quartermoon', label: 'Gaps along Quartermoon' },
  { key: 'double_door_not_self_closing', label: 'Double door not self closing' },
  { key: 'door_cover_torn_holes', label: 'Door cover torn/holes' },
  { key: 'gaps_door_frames', label: 'Gaps along door frames' },
  { key: 'gaps_door_ground', label: 'Gaps along door ground' },
];

export type Greenhouse = { name: string; farm: string };

export type FormData = {
  farms: string[];
  greenhouses: Greenhouse[];
};

export type SubmitInput = {
  date: string; // YYYY-MM-DD
  farm: string;
  gh: string;
  checks: Partial<Record<CheckKey, YesNo>>;
};

function frappeError(
  body: { _server_messages?: string; message?: string } | undefined,
  fallback: string,
): string {
  if (body?._server_messages) {
    try {
      const first = (JSON.parse(body._server_messages) as string[])[0];
      const parsed = JSON.parse(first) as { message?: string };
      if (parsed.message) return parsed.message.replace(/<[^>]*>/g, '');
    } catch {
      /* fall through */
    }
  }
  return body?.message || fallback;
}

export const karenGreenhouseIntegrityRepository = {
  /** Loads the farm + greenhouse masters in parallel. A master that isn't
   *  present on the connected site just yields an empty list. */
  async fetchFormData(): Promise<FormData> {
    const [farmsRes, ghRes] = await Promise.all([
      karenGreenhouseIntegrityApi.listFarms(),
      karenGreenhouseIntegrityApi.listGreenhouses(),
    ]);
    return {
      farms: (farmsRes.data ?? []).map((f) => f.name ?? '').filter(Boolean),
      greenhouses: (ghRes.data ?? [])
        .filter((g) => g.name)
        .map((g) => ({ name: g.name as string, farm: g.farm ?? '' })),
    };
  },

  async submit(input: SubmitInput): Promise<string> {
    const doc: RawGreenHouseIntegrity = {
      date: input.date,
      farm: input.farm,
      gh: input.gh,
      ...input.checks,
    };
    const res = await karenGreenhouseIntegrityApi.create(doc);
    if (res.exc_type || !res.data?.name) {
      throw new Error(frappeError(res, 'Could not save the inspection.'));
    }
    return res.data.name;
  },
};
