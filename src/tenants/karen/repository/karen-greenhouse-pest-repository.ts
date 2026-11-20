import { karenGreenhousePestApi, type RawGreenhousePest } from '../api/karen-greenhouse-pest-api';

export type Greenhouse = { name: string; farm: string };

export type FormData = {
  farms: string[];
  greenhouses: Greenhouse[];
  supervisors: string[];
};

/** Common greenhouse rose pests. No Pest master exists, so the picker is a
 *  fixed list — swap for a REST source if one is added later. */
export const PESTS = [
  'Thrips',
  'Spider Mites',
  'Aphids',
  'Whitefly',
  'Caterpillar',
  'Bollworm',
  'Mealybug',
  'Leaf Miner',
  'Scale Insects',
  'Mildew',
  'Botrytis',
];

export type SubmitInput = {
  date: string; // YYYY-MM-DD
  time: string; // HH:mm:ss
  supervisor: string;
  farm: string;
  greenhouse: string;
  pest: string;
  count: number;
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

export const karenGreenhousePestRepository = {
  async fetchFormData(): Promise<FormData> {
    const [farmsRes, ghRes, usersRes] = await Promise.all([
      karenGreenhousePestApi.listFarms(),
      karenGreenhousePestApi.listGreenhouses(),
      karenGreenhousePestApi.listUsers(),
    ]);
    return {
      farms: (farmsRes.data ?? []).map((f) => f.name ?? '').filter(Boolean),
      greenhouses: (ghRes.data ?? [])
        .filter((g) => g.name)
        .map((g) => ({ name: g.name as string, farm: g.farm ?? '' })),
      supervisors: (usersRes.data ?? [])
        .map((u) => u.full_name?.trim() || u.name || '')
        .filter((u) => u && u !== 'Administrator' && u !== 'Guest'),
    };
  },

  async submit(input: SubmitInput): Promise<string> {
    const doc: RawGreenhousePest = { ...input };
    const res = await karenGreenhousePestApi.create(doc);
    if (res.exc_type || !res.data?.name) {
      throw new Error(frappeError(res, 'Could not save the scouting record.'));
    }
    return res.data.name;
  },
};
