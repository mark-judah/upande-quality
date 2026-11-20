import { api } from '@/src/core/api/client';

/** Direct Frappe REST access for the GreenHouse Integrity doctype — no backend
 *  app method needed. Pickers come from the Farm / Greenhouse / User masters;
 *  the inspection is created with POST. */

export type RawFarm = { name?: string };
export type RawGreenhouse = { name?: string; farm?: string };

export type RawGreenHouseIntegrity = {
  name?: string;
  date?: string;
  farm?: string;
  gh?: string;
  roof_torn?: string;
  top_vent_torn_holes?: string;
  side_curtain_torn_holes?: string;
  skirting_torn_holes?: string;
  quarter_moon_torn_holes?: string;
  half_moon_torn_holes?: string;
  bottom_polythene_not_tucked?: string;
  side_net_torn_holes?: string;
  gaps_gutter?: string;
  gaps_halfmoon?: string;
  gaps_skirting?: string;
  gaps_top_vent?: string;
  gaps_quartermoon?: string;
  double_door_not_self_closing?: string;
  door_cover_torn_holes?: string;
  gaps_door_frames?: string;
  gaps_door_ground?: string;
};

type ListResp<T> = { data?: T[]; exc_type?: string; _server_messages?: string; message?: string };
type DocResp = { data?: RawGreenHouseIntegrity; exc_type?: string; _server_messages?: string; message?: string };

const GHI = '/api/resource/GreenHouse%20Integrity';

function list<T>(url: string, fields: string[], params: Record<string, unknown> = {}): Promise<ListResp<T>> {
  return api<ListResp<T>>({
    method: 'GET',
    url,
    params: { fields: JSON.stringify(fields), limit_page_length: 0, order_by: 'name asc', ...params },
    validateStatus: () => true,
  });
}

export const karenGreenhouseIntegrityApi = {
  listFarms: () => list<RawFarm>('/api/resource/Farm', ['name']),
  listGreenhouses: () => list<RawGreenhouse>('/api/resource/Greenhouse', ['name', 'farm']),

  create(doc: RawGreenHouseIntegrity): Promise<DocResp> {
    return api<DocResp>({ method: 'POST', url: GHI, data: doc, validateStatus: () => true });
  },
};
