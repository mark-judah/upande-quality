import type { Tenant } from '@/src/core/tenant/instance-mapper';
import type { TraceabilityRepository } from '@/src/core/features/traceability/types';
import { karenTraceabilityRepository } from '@/src/tenants/karen/repository/karen-traceability-repository';
import { kikwetuTraceabilityRepository } from '@/src/tenants/kikwetu/repository/kikwetu-traceability-repository';
import { xfloraTraceabilityRepository } from '@/src/tenants/xflora/repository/xflora-traceability-repository';
import { monaTraceabilityRepository } from '@/src/tenants/mona/repository/mona-traceability-repository';
import { tambuziTraceabilityRepository } from '@/src/tenants/tambuzi/repository/tambuzi-traceability-repository';

const REPOSITORIES: Record<Tenant, TraceabilityRepository> = {
  Karen:   karenTraceabilityRepository,
  Demo:    karenTraceabilityRepository,
  Kikwetu: kikwetuTraceabilityRepository,
  Xflora:  xfloraTraceabilityRepository,
  Mona:    monaTraceabilityRepository,
  Tambuzi: tambuziTraceabilityRepository,
};

export function getTraceabilityRepository(tenant: Tenant | null): TraceabilityRepository | null {
  if (!tenant) return null;
  return REPOSITORIES[tenant];
}
