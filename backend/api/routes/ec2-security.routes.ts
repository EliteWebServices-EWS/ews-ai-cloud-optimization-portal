import { Router, type Request, type Response } from 'express';

import {
  AUDIT_EVENTS,
  getAuditActor,
  getCorrelationId,
  getRequestId,
  scheduleAuditPersistence,
  writeAuditEvent,
} from '../../audit';
import { TENANT_ROLES, requireTenantRole } from '../../auth';
import { RepositoryNotFoundError } from '../../database';
import { resolveRouteTenantContext } from '../tenant-route-helpers';
import { createStandardRateLimit } from '../rate-limit';
import {
  Ec2SecurityAnalysisApiService,
  Ec2SecurityValidationError,
} from '../../services/ec2-security-analysis-api-service';
import { Ec2CostValidationError } from '../../services/ec2-cost-analysis-api-service';
import type { MembershipRepository } from '../../repositories/contracts';
import { buildErrorResponse, buildSuccessResponse, isAppError } from '../../shared/utils';
import {
  parseEc2SecurityAnalysisBody,
  parseEc2SecurityFindingListQuery,
  parseEc2SecuritySummaryQuery,
} from '../ec2-security-api-validation';
import {
  resolveEc2SecurityAuditErrorCode,
  resolveEc2SecurityAuditStatusCode,
} from '../ec2-security-api-error-handling';

export interface Ec2SecurityRouteDeps {
  ec2SecurityAnalysisApi: Ec2SecurityAnalysisApiService;
  membershipRepository: MembershipRepository;
}

const EC2_SECURITY_READ_ROLES = [
  TENANT_ROLES.TENANT_OWNER,
  TENANT_ROLES.TENANT_ADMIN,
  TENANT_ROLES.SECURITY_ADMIN,
  TENANT_ROLES.ANALYST,
  TENANT_ROLES.VIEWER,
  TENANT_ROLES.AUDITOR,
] as const;

const EC2_SECURITY_ANALYSIS_ROLES = [
  TENANT_ROLES.TENANT_OWNER,
  TENANT_ROLES.TENANT_ADMIN,
  TENANT_ROLES.SECURITY_ADMIN,
  TENANT_ROLES.ANALYST,
] as const;

const EC2_SECURITY_PUBLIC_INTERNAL_ERROR_MESSAGE =
  'EC2 security analysis is temporarily unavailable. Try again later.';

function handleEc2SecurityRouteError(res: Response, error: unknown, requestId: string): void {
  if (error instanceof Ec2SecurityValidationError) {
    res
      .status(422)
      .json(buildErrorResponse('INVALID_REQUEST', error.message, requestId, 'ec2-security-api'));
    return;
  }
  if (error instanceof Ec2CostValidationError) {
    res
      .status(422)
      .json(buildErrorResponse('INVALID_REQUEST', error.message, requestId, 'ec2-security-api'));
    return;
  }
  if (error instanceof RepositoryNotFoundError) {
    res
      .status(404)
      .json(buildErrorResponse('NOT_FOUND', error.message, requestId, 'ec2-security-api'));
    return;
  }
  if (isAppError(error)) {
    res
      .status(error.statusCode)
      .json(buildErrorResponse(error.code, error.message, requestId, error.stage ?? 'ec2-security-api'));
    return;
  }
  res
    .status(500)
    .json(
      buildErrorResponse(
        'ENGINE_ERROR',
        EC2_SECURITY_PUBLIC_INTERNAL_ERROR_MESSAGE,
        requestId,
        'ec2-security-api',
      ),
    );
}

export function createEc2SecurityRoutes(deps: Ec2SecurityRouteDeps): Router {
  const router = Router();
  const rateLimit = createStandardRateLimit();

  router.post(
    '/analysis/ec2/security',
    rateLimit,
    requireTenantRole(deps.membershipRepository, ...EC2_SECURITY_ANALYSIS_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      const correlationId = getCorrelationId(req, requestId);
      const actor = getAuditActor(req);
      const tenantId = resolveRouteTenantContext(req).tenantId;
      let analysisStarted = false;
      try {
        const body = parseEc2SecurityAnalysisBody(req.body);
        const prepared = await deps.ec2SecurityAnalysisApi.resolveSecurityAnalysisPreconditions(
          tenantId,
          body,
        );

        scheduleAuditPersistence(
          req,
          writeAuditEvent({
            eventName: AUDIT_EVENTS.EC2_SECURITY_ANALYSIS_STARTED,
            outcome: 'started',
            requestId,
            correlationId,
            actor,
            tenantId,
            action: 'ec2.security_analysis',
            method: req.method,
            path: req.path,
            statusCode: 200,
            resource: {
              type: 'aws_account',
              id: prepared.accountId,
              accountId: prepared.accountId,
            },
            reason: `regions=${prepared.regions.join(',')}`,
          }),
        );
        analysisStarted = true;

        const result = await deps.ec2SecurityAnalysisApi.startSecurityAnalysis(tenantId, body);

        const isPartial =
          result.status === 'PARTIAL' ||
          (Boolean(result.warnings?.length) && result.instancesAnalyzed > 0);
        const terminalEventName = isPartial
          ? AUDIT_EVENTS.EC2_SECURITY_ANALYSIS_PARTIAL
          : result.status === 'FAILED'
            ? AUDIT_EVENTS.EC2_SECURITY_ANALYSIS_FAILED
            : AUDIT_EVENTS.EC2_SECURITY_ANALYSIS_SUCCEEDED;

        scheduleAuditPersistence(
          req,
          writeAuditEvent({
            eventName: terminalEventName,
            outcome:
              terminalEventName === AUDIT_EVENTS.EC2_SECURITY_ANALYSIS_FAILED ? 'failure' : 'success',
            requestId,
            correlationId,
            actor,
            tenantId,
            action: 'ec2.security_analysis',
            method: req.method,
            path: req.path,
            statusCode: 200,
            resource: {
              type: 'ec2_security_analysis_run',
              id: result.runId,
              accountId: prepared.accountId,
            },
            reason: `instancesAnalyzed=${result.instancesAnalyzed};findingsCreated=${result.findingsCreated}`,
          }),
        );

        res.json(buildSuccessResponse(result, requestId));
      } catch (error) {
        if (analysisStarted) {
          scheduleAuditPersistence(
            req,
            writeAuditEvent({
              eventName: AUDIT_EVENTS.EC2_SECURITY_ANALYSIS_FAILED,
              outcome: 'failure',
              requestId,
              correlationId,
              actor,
              tenantId,
              action: 'ec2.security_analysis',
              method: req.method,
              path: req.path,
              statusCode: resolveEc2SecurityAuditStatusCode(error),
              errorCode: resolveEc2SecurityAuditErrorCode(error),
            }),
          );
        }
        handleEc2SecurityRouteError(res, error, requestId);
      }
    },
  );

  router.get(
    '/recommendations/ec2/security',
    rateLimit,
    requireTenantRole(deps.membershipRepository, ...EC2_SECURITY_READ_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      const correlationId = getCorrelationId(req, requestId);
      const actor = getAuditActor(req);
      const tenantId = resolveRouteTenantContext(req).tenantId;
      try {
        const query = parseEc2SecurityFindingListQuery(tenantId, req.query as Record<string, unknown>);
        const page = await deps.ec2SecurityAnalysisApi.listSecurityFindings(query);

        scheduleAuditPersistence(
          req,
          writeAuditEvent({
            eventName: AUDIT_EVENTS.EC2_SECURITY_FINDINGS_LISTED,
            outcome: 'success',
            requestId,
            correlationId,
            actor,
            tenantId,
            action: 'ec2.security_findings.list',
            method: req.method,
            path: req.path,
            statusCode: 200,
            resource: { type: 'aws_account', id: query.accountId, accountId: query.accountId },
          }),
        );

        res.json(
          buildSuccessResponse(
            {
              items: page.items,
              nextToken: page.nextToken,
            },
            requestId,
          ),
        );
      } catch (error) {
        handleEc2SecurityRouteError(res, error, requestId);
      }
    },
  );

  router.get(
    '/security/ec2/summary',
    rateLimit,
    requireTenantRole(deps.membershipRepository, ...EC2_SECURITY_READ_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      const correlationId = getCorrelationId(req, requestId);
      const actor = getAuditActor(req);
      const tenantId = resolveRouteTenantContext(req).tenantId;
      try {
        const query = parseEc2SecuritySummaryQuery(tenantId, req.query as Record<string, unknown>);
        const summary = await deps.ec2SecurityAnalysisApi.getSecuritySummary(
          query.tenantId,
          query.accountId,
          query.region,
        );

        scheduleAuditPersistence(
          req,
          writeAuditEvent({
            eventName: AUDIT_EVENTS.EC2_SECURITY_SUMMARY_VIEWED,
            outcome: 'success',
            requestId,
            correlationId,
            actor,
            tenantId,
            action: 'ec2.security_summary.view',
            method: req.method,
            path: req.path,
            statusCode: 200,
            resource: { type: 'aws_account', id: query.accountId, accountId: query.accountId },
          }),
        );

        res.json(buildSuccessResponse(summary, requestId));
      } catch (error) {
        handleEc2SecurityRouteError(res, error, requestId);
      }
    },
  );

  return router;
}
