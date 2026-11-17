import { api } from '@/src/core/api/client';

/** Direct Frappe REST access for the Greenhouse Pest doctype. Pickers come from
 *  the Farm / Greenhouse / User masters; the record is created with POST. */

export type RawFarm = { name?: string };
export type RawGreenhouse = { name?: string; farm?: string };
export type RawUser = { name?: string; full_name?: string };

export type RawGreenhousePest = {
  name?: string;
  date?: string;
  time?: string;
  supervisor?: string;
  farm?: string;
  greenhouse?: string;
  pest?: string;
  count?: number;
};

type ListResp<T> = { data?: T[]; exc_type?: string; _server_messages?: string; message?: string };
type DocResp = { data?: RawGreenhousePest; exc_type?: string; _server_messages?: string; message?: string };

const GP = '/api/resource/Greenhouse%20Pest';

function list<T>(url: string, fields: string[], params: Record<string, unknown> = {}): Promise<ListResp<T>> {
  return api<ListResp<T>>({
    method: 'GET',
    url,
    params: { fields: JSON.stringify(fields), limit_page_length: 0, order_by: 'name asc', ...params },
    validateStatus: () => true,
  });
}

export const karenGreenhousePestApi = {
  listFarms: () => list<RawFarm>('/api/resource/Farm', ['name']),
  listGreenhouses: () => list<RawGreenhouse>('/api/resource/Greenhouse', ['name', 'farm']),
  listUsers: () =>
    list<RawUser>('/api/resource/User', ['name', 'full_name'], {
      filters: JSON.stringify([['enabled', '=', 1]]),
    }),

  create(doc: RawGreenhousePest): Promise<DocResp> {
    return api<DocResp>({ method: 'POST', url: GP, data: doc, validateStatus: () => true });
  },
};
