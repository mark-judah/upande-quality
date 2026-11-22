import {
  karenGreenhouseIntegrityApi,
  type RawGreenHouseIntegrity,
} from '../api/karen-greenhouse-integrity-api';

export type YesNo = 'NO' | 'YES';

/** A check from the Greenhouse Inspection Item Master: `name` is what the checklist row links to. */
export type InspectionItem = { name: string; label: string };

export type Greenhouse = { name: string; farm: string };

export type FormData = {
  farms: string[];
  greenhouses: Greenhouse[];
  items: InspectionItem[];
};

export type SubmitInput = {
  date: string; // YYYY-MM-DD
  farm: string;
  gh: string;
  items: InspectionItem[];
  /** Keyed by item name. YES = a defect was found; an unanswered check is saved as OK. */
  checks: Record<string, YesNo>;
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
  /** Loads the farm, greenhouse and checklist masters in parallel. A master that isn't
   *  present on the connected site just yields an empty list. */
  async fetchFormData(): Promise<FormData> {
    const [farmsRes, ghRes, itemsRes] = await Promise.all([
      karenGreenhouseIntegrityApi.listFarms(),
      karenGreenhouseIntegrityApi.listGreenhouses(),
      karenGreenhouseIntegrityApi.listItems(),
    ]);
    return {
      farms: (farmsRes.data ?? []).map((f) => f.name ?? '').filter(Boolean),
      greenhouses: (ghRes.data ?? [])
        .filter((g) => g.name)
        .map((g) => ({ name: g.name as string, farm: g.farm ?? '' })),
      items: (itemsRes.data ?? [])
        .filter((i) => i.name)
        .map((i) => ({ name: i.name as string, label: i.item_name || (i.name as string) })),
    };
  },

  async submit(input: SubmitInput): Promise<string> {
    const doc: RawGreenHouseIntegrity = {
      date: input.date,
      farm: input.farm,
      gh: input.gh,
      inspection_checklist: input.items.map((i) => ({
        inspection_item: i.name,
        status: input.checks[i.name] === 'YES' ? 'Defect' : 'OK',
      })),
    };
    const res = await karenGreenhouseIntegrityApi.create(doc);
    if (res.exc_type || !res.data?.name) {
      throw new Error(frappeError(res, 'Could not save the inspection.'));
    }
    return res.data.name;
  },
};
