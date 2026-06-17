import type { Tenant } from '@/src/core/tenant/instance-mapper';
import type { ReplacementRepository } from '@/src/core/features/replacement/types';
import { karenReplacementRepository } from '@/src/tenants/karen/repository/karen-replacement-repository';

/**
 * Replacement is currently only implemented for Karen/Demo. Other tenants
 * return null, which the route file uses to show a "not available" message.
 */
const REPOSITORIES: Partial<Record<Tenant, ReplacementRepository>> = {
  Karen: karenReplacementRepository,
  Demo: karenReplacementRepository,
};

export function getReplacementRepository(tenant: Tenant | null): ReplacementRepository | null {
  if (!tenant) return null;
  return REPOSITORIES[tenant] ?? null;
}
