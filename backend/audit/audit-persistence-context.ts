import type { Request, Response, NextFunction } from 'express';
import type { AuditEvent } from './audit-types';
import { persistAuditEvent } from './audit-service';

const PENDING_AUDIT_SYMBOL = Symbol('pendingAuditWrites');

interface RequestWithPendingAudits extends Request {
  [PENDING_AUDIT_SYMBOL]?: Promise<void>[];
}

export function getPendingAuditWrites(
  req: Request
): Promise<void>[] {
  const request = req as RequestWithPendingAudits;

  if (!request[PENDING_AUDIT_SYMBOL]) {
    request[PENDING_AUDIT_SYMBOL] = [];
  }

  return request[PENDING_AUDIT_SYMBOL]!;
}

/**
 * Tracks audit persistence promises and waits for them before the HTTP
 * response is finalized. This prevents Lambda from freezing before DynamoDB
 * writes complete, without making every audit call site async.
 */
export function auditPersistenceFlushMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  getPendingAuditWrites(req);

  const originalEnd = res.end.bind(res);

  res.end = function auditFlushEnd(
    this: Response,
    ...args: Parameters<Response['end']>
  ): Response {
    const pending = getPendingAuditWrites(req);

    void Promise.allSettled(pending).finally(() => {
      originalEnd(...args);
    });

    return this;
  } as Response['end'];

  next();
}

export function scheduleAuditPersistence(
  req: Request,
  event: AuditEvent
): void {
  const pending = getPendingAuditWrites(req);
  const writePromise = persistAuditEvent(event);

  pending.push(writePromise);
}
