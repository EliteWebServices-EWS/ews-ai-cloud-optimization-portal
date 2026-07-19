import type { AuditEvent } from './audit-types';
import type {
  AuditQueryFilters,
  AuditQueryResult,
} from './audit-query';

export interface AuditRepository {
  save(event: AuditEvent): Promise<void>;
  query(filters: AuditQueryFilters): Promise<AuditQueryResult>;
}
