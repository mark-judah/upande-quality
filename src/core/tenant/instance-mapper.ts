export type Tenant = 'Karen' | 'Kikwetu' | 'Xflora' | 'Mona' | 'Tambuzi' | 'Demo';

const URL_TO_TENANT: Record<string, Tenant> = {
  'https://kikwetu.upande.com': 'Kikwetu',
  'https://kikwetu-production.jh.frappe.cloud': 'Kikwetu',
  'https://kaitet-group.upande.com': 'Karen',
  'https://kaitet-group.c.frappe.cloud': 'Karen',
  'http://10.49.59.154:8001': 'Karen',
  'https://upande-kaitet-group-staging.frappe.cloud': 'Karen',
  'https://upande-kaitet2.c.frappe.cloud': 'Karen',
  'https://kaitet-group-staging.upande.com': 'Karen',
  'https://upande-insights.frappe.cloud': 'Demo',
  'http://81.17.101.149:8082': 'Karen',
  'http://10.199.11.154:8001': 'Karen',
  'http://192.168.43.97:8001': 'Karen',
  'http://192.168.43.154:8001': 'Karen',
  'http://10.186.169.154:8002': 'Karen',
  'http://10.209.26.154:8002': 'Karen',
  'http://10.88.11.154:8002':'Karen',
  'https://mona-flowers-staging.upande.com': 'Mona',
  'https://mona-flowers.upande.com': 'Mona',
  'https://xflora.fsn.frappe.cloud': 'Xflora',
  'https://krv16.nbg.frappe.cloud': 'Karen',
  'https://kaitetv16-staging.nbg.frappe.cloud': 'Karen',
  'http://192.168.0.170:8001': 'Karen',
  'https://kaitetv16.nbg.frappe.cloud': 'Karen',
  'http://192.168.3.102:8002': 'Karen',
  'http://192.168.2.106:8002': 'Karen',
  'http://10.230.56.154:8002': 'Karen',
  'http://10.77.222.154:8002': 'Karen',
  'http://192.168.88.245:8000': 'Karen',
  'http://192.168.1.230:8000': 'Karen',
  "http://172.17.49.204:8082": 'Karen',
  "http://192.168.100.27:8000": 'Karen',
  'http://192.168.1.69:8000': 'Karen',
  'http://192.168.1.71:8000': 'Karen',
  'http://172.16.32.240:8000': 'Karen',
  'http://192.168.1.150:8000': 'Karen',
  'https://misc-partnership-leader-pendant.trycloudflare.com ': 'Karen'
};

/** Host (and port) only: the app works out http or https itself, so the
 *  scheme it ended up on must not change which tenant a site is. */
const hostOf = (url: string) =>
  url.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');

const HOST_TO_TENANT: Record<string, Tenant> = Object.fromEntries(
  Object.entries(URL_TO_TENANT).map(([url, tenant]) => [hostOf(url), tenant]),
);

export function getTenantByUrl(url: string | null | undefined): Tenant | null {
  if (!url) return null;
  return HOST_TO_TENANT[hostOf(url)] ?? null;
}
