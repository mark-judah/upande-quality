import { api } from '@/src/core/api/client';

/** Rose item-group trees the variety pickers list. Varieties sit in the
 *  sub-groups ("Spray Roses - Garden", "Standard Roses - Premium", ...), not on
 *  the parent group itself, so each tree is queried with "descendants of". */
const ROSE_GROUPS = ['Spray Roses', 'Standard Roses'];

/** Every enabled rose variety (item code), A-Z, for a searchable picker. */
export async function fetchRoseVarieties(): Promise<string[]> {
  const lists = await Promise.all(
    ROSE_GROUPS.map((group) =>
      api<{ data?: { item_code?: string }[] }>({
        method: 'GET',
        url: '/api/resource/Item',
        params: {
          filters: JSON.stringify([
            ['item_group', 'descendants of (inclusive)', group],
            ['disabled', '=', 0],
          ]),
          fields: JSON.stringify(['item_code']),
          limit_page_length: 0,
          order_by: 'item_code asc',
        },
      }),
    ),
  );
  const codes = lists.flatMap((res) => (res.data ?? []).map((r) => r.item_code ?? '').filter(Boolean));
  return [...new Set(codes)].sort((a, b) => a.localeCompare(b));
}

/** Every Item Group in the Spray Roses tree (the root and its sub-groups), so a
 *  variety's leaf group ("Spray Roses - Garden") can be told apart from Standard. */
export async function fetchSprayRoseGroups(): Promise<Set<string>> {
  const res = await api<{ data?: { name?: string }[] }>({
    method: 'GET',
    url: '/api/resource/Item Group',
    params: {
      filters: JSON.stringify([['name', 'descendants of (inclusive)', 'Spray Roses']]),
      fields: JSON.stringify(['name']),
      limit_page_length: 0,
    },
  });
  return new Set((res.data ?? []).map((r) => r.name ?? '').filter(Boolean));
}
