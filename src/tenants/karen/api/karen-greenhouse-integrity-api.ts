import { api } from '@/src/core/api/client';

/** Direct Frappe REST access for the GreenHouse Integrity doctype — no backend
 *  app method needed. Pickers come from the Farm / Greenhouse masters, the checks
 *  from the Greenhouse Inspection Item Master; the inspection is created with POST. */

export type RawFarm = { name?: string };
export type RawGreenhouse = { name?: string; farm?: string };

/** One check from the Greenhouse Inspection Item Master (named by item_name). */
export type RawInspectionItem = { name?: string; item_name?: string; sort_order?: number };

export type RawChecklistRow = { inspection_item: string; status: 'OK' | 'Defect'; remarks?: string };

export type RawGreenHouseIntegrity = {
  name?: string;
  date?: string;
  farm?: string;
  gh?: string;
  inspection_checklist?: RawChecklistRow[];
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
  listItems: () =>
    list<RawInspectionItem>(
      '/api/resource/Greenhouse%20Inspection%20Item%20Master',
      ['name', 'item_name', 'sort_order'],
      { filters: JSON.stringify([['active', '=', 1]]), order_by: 'sort_order asc, name asc' },
    ),

  create(doc: RawGreenHouseIntegrity): Promise<DocResp> {
    return api<DocResp>({ method: 'POST', url: GHI, data: doc, validateStatus: () => true });
  },
};
