import { api } from '@/src/core/api/client';

/** Direct Frappe REST resource access for the Vehicle Inspection doctype —
 *  no backend app method (mobile/api.py) needed; create via POST. */

export type RawVehicle = { name?: string; license_plate?: string; description?: string };

export type RawVehicleInspection = {
  name?: string;
  vehicle?: string;
  driver_name?: string;
  inspection_datetime?: string;
  inspected_by?: string;
  front_wall?: string;
  left_side?: string;
  right_side?: string;
  floor?: string;
  ceiling_roof?: string;
  doors?: string;
  undercarriage?: string;
  defect_notes?: string;
};

type ListResp<T> = { data?: T[]; exc_type?: string; _server_messages?: string; message?: string };
type DocResp = { data?: RawVehicleInspection; exc_type?: string; _server_messages?: string; message?: string };

const VI = '/api/resource/Vehicle%20Inspection';

export const karenVehicleInspectionApi = {
  listVehicles(): Promise<ListResp<RawVehicle>> {
    return api<ListResp<RawVehicle>>({
      method: 'GET',
      url: '/api/resource/Vehicle',
      params: {
        // `description` is not permitted in get_list on Vehicle — name + plate only
        fields: JSON.stringify(['name', 'license_plate']),
        limit_page_length: 0,
        order_by: 'name asc',
      },
      validateStatus: () => true,
    });
  },

  create(doc: RawVehicleInspection): Promise<DocResp> {
    return api<DocResp>({ method: 'POST', url: VI, data: doc, validateStatus: () => true });
  },
};
