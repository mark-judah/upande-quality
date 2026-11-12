export type Tenant = 'Karen' | 'Kikwetu' | 'Xflora' | 'Mona' | 'Tambuzi' | 'Demo';

const URL_TO_TENANT: Record<string, Tenant> = {
  'http://192.168.100.48:8000': 'Karen',
  'http://192.168.8.103:8000': 'Karen',
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
  'https://misc-partnership-leader-pendant.trycloudflare.com ': 'Karen',
  'http://10.118.65.204:8000': 'Karen',
};

/** Host (and port) only: the app works out http or https itself, so the
 *  scheme it ended up on must not change which tenant a site is. */
const hostOf = (url: string) =>
  url.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');

const HOST_TO_TENANT: Record<string, Tenant> = Object.fromEntries(
  Object.entries(URL_TO_TENANT).map(([url, tenant]) => [hostOf(url), tenant]),
);

/** A development server on a local network (a laptop's bench: 192.168.x, 10.x, 172.16-31.x,
 *  a Tailscale 100.64-127.x address, localhost) or a temporary tunnel. Its address changes with
 *  every network, so it is never in the list above; these are Kaitet test benches. */
function isDevHost(host: string): boolean {
  const name = host.split(':')[0];
  if (name === 'localhost' || name.endsWith('.trycloudflare.com')) return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(name);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 10 ||
    a === 127 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

export function getTenantByUrl(url: string | null | undefined): Tenant | null {
  if (!url) return null;
  const host = hostOf(url);
  // a bench not in the list would otherwise get no tenant, so no screens at all
  return HOST_TO_TENANT[host] ?? (isDevHost(host) ? 'Karen' : null);
}
