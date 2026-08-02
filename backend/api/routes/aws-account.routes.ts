/**
 * AWS Account Management API — Sprint 13, Engineer 3.
 *
 * Exposes secure tenant APIs for registering, verifying, updating,
 * listing, and removing customer AWS account connections (AWS STS
 * AssumeRole). Built against the real dependencies delivered by
 * Engineer 1 (AwsAccountRepository, PR #185) and Engineer 2
 * (StsCredentialProvider / validateRequiredPermissions, PR #183).
 *
 * Reuses existing infrastructure rather than rebuilding it:
 *  - RBAC: requireTenantRole gates every mutation to Tenant Owner,
 *    Tenant Admin, or Security Admin.
 *  - Cognito: identity comes from getAuditActor / the trusted request
 *    security context, exactly like every other route file.
 *  - Audit: every mutation emits a structured audit event. verify()
 *    additionally triggers Engineer 2's own ASSUME_ROLE_STARTED /
 *    SUCCEEDED / FAILED events from inside StsCredentialProvider.
 *  - Pagination: AwsAccountApiService.list() is backed by the
 *    repository's DynamoDB-paginated listByTenant (Query only, never
 *    Scan).
 *  - Rate limiting: api/rate-limit.ts (identity-keyed, not IP).
 *
 * Tenant isolation: every operation is scoped by
 * resolveRouteTenantContext(req).tenantId, taken from the trusted
 * request context — never from the request body, query string, or path
 * — so a caller can never read or modify another tenant's AWS account
 * connections. A record that exists but belongs to another tenant is
 * indistinguishable from one that doesn't exist (safe 404).
 *
 * Note on accountId: per Engineer 1's model, accountId IS the
 * customer's 12-digit AWS account number, globally unique across the
 * whole platform (at most one tenant may ever own a given AWS account).
 * getByAccountId() (a cross-tenant, platform-internal lookup) is
 * therefore never exposed here — every read/write goes through
 * getById(tenantId, accountId), which is safe by construction.
 */

import { Router, type Request, type Response } from 'express';

import {
  AUDIT_EVENTS,
  getAuditActor,
  getCorrelationId,
  getRequestId,
  scheduleAuditPersistence,
  writeAuditEvent,
} from '../../audit';
import {
  PRIVILEGED_OPERATIONS,
  TENANT_ROLES,
  requirePrivilegedMfa,
  requireTenantRole,
} from '../../auth';
import type { MembershipRepository } from '../../repositories/contracts';
import {
  InvalidPaginationTokenError,
  RepositoryAlreadyExistsError,
  RepositoryConflictError,
  RepositoryNotFoundError,
} from '../../database';
import { buildAwsAccountApiAuditInput } from '../aws-account-api-audit';
import {
  AwsAccountApiValidationError,
  validateDeleteAwsAccountBody,
  validateRegisterAwsAccountBody,
  validateUpdateAwsAccountBody,
  validateVerifyAwsAccountBody,
} from '../aws-account-api-validation';
import { resolveRouteTenantContext } from '../tenant-route-helpers';
import { createSensitiveRateLimit, createStandardRateLimit } from '../rate-limit';
import {
  InvalidAwsAccountTransitionError,
  InvalidAwsAccountStatusConsistencyError,
} from '../../services/aws-account-lifecycle';
import { InvalidAwsAccountRecordError } from '../../repositories/models/aws-account-persistence-models';
import { AwsAccountIdentityMismatchError } from '../../services/aws-account-discovery-support';
import {
  AwsAccountQueryValidationError,
  parseAwsAccountQuery,
} from '../../services/aws-account-query';
import {
  AwsAccountApiService,
  sanitizeAwsAccountRecord,
} from '../../services/aws-account-api-service';
import {
  AppError,
  buildErrorResponse,
  buildSuccessResponse,
  isAppError,
} from '../../shared/utils';

export interface AwsAccountRouteDeps {
  awsAccountApi: AwsAccountApiService;
  membershipRepository: MembershipRepository;
}

/** Roles trusted to manage a tenant's AWS account connections. */
const AWS_ACCOUNT_MANAGEMENT_ROLES = [
  TENANT_ROLES.TENANT_OWNER,
  TENANT_ROLES.TENANT_ADMIN,
  TENANT_ROLES.SECURITY_ADMIN,
] as const;

function handleAwsAccountRouteError(
  res: Response,
  error: unknown,
  requestId: string,
): void {
  if (
    error instanceof AwsAccountApiValidationError ||
    error instanceof InvalidAwsAccountRecordError
  ) {
    const statusCode = isAppError(error) ? error.statusCode : 422;
    res
      .status(statusCode)
      .json(buildErrorResponse('INVALID_REQUEST', error.message, requestId, 'aws-account-api'));
    return;
  }

  if (error instanceof AwsAccountQueryValidationError) {
    res
      .status(400)
      .json(buildErrorResponse('INVALID_REQUEST', error.message, requestId, 'aws-account-api'));
    return;
  }

  if (
    error instanceof InvalidAwsAccountTransitionError ||
    error instanceof InvalidAwsAccountStatusConsistencyError
  ) {
    res
      .status(409)
      .json(buildErrorResponse('CONFLICT', error.message, requestId, 'aws-account-api'));
    return;
  }

  if (
    error instanceof RepositoryConflictError ||
    error instanceof RepositoryAlreadyExistsError
  ) {
    res
      .status(409)
      .json(buildErrorResponse('CONFLICT', error.message, requestId, 'aws-account-api'));
    return;
  }

  if (error instanceof RepositoryNotFoundError) {
    res
      .status(404)
      .json(
        buildErrorResponse(
          'NOT_FOUND',
          'AWS account connection not found.',
          requestId,
          'aws-account-api',
        ),
      );
    return;
  }

  if (error instanceof InvalidPaginationTokenError) {
    res
      .status(422)
      .json(
        buildErrorResponse(
          'INVALID_REQUEST',
          'Pagination token is invalid or not valid for this tenant.',
          requestId,
          'aws-account-api',
        ),
      );
    return;
  }

  if (isAppError(error)) {
    res
      .status(error.statusCode)
      .json(buildErrorResponse(error.code, error.message, requestId, error.stage));
    return;
  }

  const message = error instanceof Error ? error.message : 'Request failed';
  res
    .status(500)
    .json(buildErrorResponse('ENGINE_ERROR', message, requestId, 'aws-account-api'));
}

/**
 * Loads an AWS account connection scoped to the caller's tenant, throwing
 * the standard safe 404 if it doesn't exist. getById is already
 * tenant-scoped at the repository layer, so a connection belonging to
 * another tenant simply cannot be found here.
 */
async function loadTenantAwsAccountOrThrow(
  deps: AwsAccountRouteDeps,
  tenantId: string,
  accountId: string,
) {
  const account = await deps.awsAccountApi.getById(tenantId, accountId);
  if (!account) {
    throw new AppError(
      'NOT_FOUND',
      'AWS account connection not found.',
      404,
      'aws-account-api',
    );
  }
  return account;
}

export function createAwsAccountRoutes(deps: AwsAccountRouteDeps): Router {
  const router = Router();

  const standardRateLimit = createStandardRateLimit();
  const sensitiveRateLimit = createSensitiveRateLimit();

  // Baseline limit for every AWS account route (defense in depth on top
  // of API Gateway's account-wide throttle — see api/rate-limit.ts).
  // Sensitive mutations below layer a stricter limiter on top of this.
  router.use(standardRateLimit);

  // ---------------------------------------------------------------------
  // Register AWS account
  // ---------------------------------------------------------------------
  router.post(
    '/aws-accounts',
    sensitiveRateLimit,
    requireTenantRole(deps.membershipRepository, ...AWS_ACCOUNT_MANAGEMENT_ROLES),
    requirePrivilegedMfa(PRIVILEGED_OPERATIONS.AWS_ACCOUNT_REGISTER),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      const correlationId = getCorrelationId(req, requestId);
      const actor = getAuditActor(req);
      const tenantId = resolveRouteTenantContext(req).tenantId;

      try {
        const input = validateRegisterAwsAccountBody(req.body);
        const account = await deps.awsAccountApi.register(tenantId, input);

        const event = writeAuditEvent(
          buildAwsAccountApiAuditInput({
            eventName: AUDIT_EVENTS.ACCOUNT_REGISTERED,
            outcome: 'success',
            requestId,
            correlationId,
            actor,
            tenantId,
            action: 'aws_account.register',
            method: req.method,
            path: req.path,
            statusCode: 201,
            accountId: account.accountId,
            region: account.region,
          }),
        );
        scheduleAuditPersistence(req, event);

        // Register is the one response that includes the full,
        // unmasked externalId — the tenant needs it to configure their
        // IAM role trust policy. Every later read returns it masked.
        res.status(201).json(buildSuccessResponse(account, requestId));
      } catch (error) {
        const statusCode = isAppError(error) ? error.statusCode : 500;
        const errorCode = isAppError(error) ? error.code : 'ENGINE_ERROR';
        const reason =
          error instanceof Error ? error.message : 'AWS account registration failed.';

        const event = writeAuditEvent(
          buildAwsAccountApiAuditInput({
            eventName: AUDIT_EVENTS.ACCOUNT_ACTION_FAILED,
            outcome: 'failure',
            requestId,
            correlationId,
            actor,
            tenantId,
            action: 'aws_account.register',
            method: req.method,
            path: req.path,
            statusCode,
            reason,
            errorCode,
          }),
        );
        scheduleAuditPersistence(req, event);

        handleAwsAccountRouteError(res, error, requestId);
      }
    },
  );

  // ---------------------------------------------------------------------
  // List AWS accounts (pagination, filtering, search)
  // ---------------------------------------------------------------------
  router.get('/aws-accounts', async (req: Request, res: Response) => {
    const requestId = getRequestId(req);
    const tenantId = resolveRouteTenantContext(req).tenantId;

    try {
      const query = parseAwsAccountQuery(req.query as Record<string, unknown>);
      const result = await deps.awsAccountApi.list(tenantId, query);

      res.json(
        buildSuccessResponse(
          {
            accounts: result.accounts.map(sanitizeAwsAccountRecord),
            total: result.total,
            filters: query.filters,
            search: query.search,
            sort: { sortBy: query.sortBy, sortOrder: query.sortOrder },
            pagination: {
              limit: query.limit,
              count: result.accounts.length,
              nextToken: result.nextToken,
            },
          },
          requestId,
        ),
      );
    } catch (error) {
      handleAwsAccountRouteError(res, error, requestId);
    }
  });

  // ---------------------------------------------------------------------
  // Get connection status
  // ---------------------------------------------------------------------
  router.get('/aws-accounts/:accountId/status', async (req: Request, res: Response) => {
    const requestId = getRequestId(req);
    const tenantId = resolveRouteTenantContext(req).tenantId;

    try {
      const status = await deps.awsAccountApi.getConnectionStatus(
        tenantId,
        req.params.accountId,
      );

      if (!status) {
        throw new AppError(
          'NOT_FOUND',
          'AWS account connection not found.',
          404,
          'aws-account-api',
        );
      }

      res.json(buildSuccessResponse(status, requestId));
    } catch (error) {
      handleAwsAccountRouteError(res, error, requestId);
    }
  });

  // ---------------------------------------------------------------------
  // Get a single AWS account connection
  // ---------------------------------------------------------------------
  router.get('/aws-accounts/:accountId', async (req: Request, res: Response) => {
    const requestId = getRequestId(req);
    const tenantId = resolveRouteTenantContext(req).tenantId;

    try {
      const account = await loadTenantAwsAccountOrThrow(deps, tenantId, req.params.accountId);

      res.json(buildSuccessResponse(sanitizeAwsAccountRecord(account), requestId));
    } catch (error) {
      handleAwsAccountRouteError(res, error, requestId);
    }
  });

  // ---------------------------------------------------------------------
  // Discover account metadata (AssumeRole + read-only AWS discovery)
  // ---------------------------------------------------------------------
  router.post(
    '/aws-accounts/:accountId/discovery',
    requireTenantRole(deps.membershipRepository, ...AWS_ACCOUNT_MANAGEMENT_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      const correlationId = getCorrelationId(req, requestId);
      const actor = getAuditActor(req);
      const tenantId = resolveRouteTenantContext(req).tenantId;
      const accountId = req.params.accountId;

      const startedEvent = writeAuditEvent(
        buildAwsAccountApiAuditInput({
          eventName: AUDIT_EVENTS.ACCOUNT_DISCOVERY_STARTED,
          outcome: 'started',
          requestId,
          correlationId,
          actor,
          tenantId,
          action: 'aws_account.discovery',
          method: req.method,
          path: req.path,
          statusCode: 200,
          accountId,
        }),
      );
      scheduleAuditPersistence(req, startedEvent);

      try {
        await loadTenantAwsAccountOrThrow(deps, tenantId, accountId);

        const result = await deps.awsAccountApi.discover(tenantId, accountId, {
          actor,
          requestId,
          correlationId,
        });

        const successEvent = writeAuditEvent(
          buildAwsAccountApiAuditInput({
            eventName: AUDIT_EVENTS.ACCOUNT_DISCOVERY_SUCCEEDED,
            outcome: 'success',
            requestId,
            correlationId,
            actor,
            tenantId,
            action: 'aws_account.discovery',
            method: req.method,
            path: req.path,
            statusCode: 200,
            accountId: result.account.accountId,
            discoveredAccountId: result.discovery.accountId,
            organizationId: result.discovery.organizationId,
            enabledRegionCount: result.discovery.enabledRegions.length,
            warningCodes: result.discovery.warnings.map((warning) => warning.code),
            region: result.account.region,
          }),
        );
        scheduleAuditPersistence(req, successEvent);

        res.json(
          buildSuccessResponse(
            {
              account: sanitizeAwsAccountRecord(result.account),
              discovery: result.discovery,
            },
            requestId,
          ),
        );
      } catch (error) {
        if (error instanceof AwsAccountIdentityMismatchError) {
          const mismatchEvent = writeAuditEvent(
            buildAwsAccountApiAuditInput({
              eventName: AUDIT_EVENTS.ACCOUNT_IDENTITY_MISMATCH,
              outcome: 'failure',
              requestId,
              correlationId,
              actor,
              tenantId,
              action: 'aws_account.discovery',
              method: req.method,
              path: req.path,
              statusCode: 409,
              accountId,
              discoveredAccountId: error.discoveredAccountId,
              errorCode: error.code,
            }),
          );
          scheduleAuditPersistence(req, mismatchEvent);
        } else {
          const failedEvent = writeAuditEvent(
            buildAwsAccountApiAuditInput({
              eventName: AUDIT_EVENTS.ACCOUNT_DISCOVERY_FAILED,
              outcome: 'failure',
              requestId,
              correlationId,
              actor,
              tenantId,
              action: 'aws_account.discovery',
              method: req.method,
              path: req.path,
              statusCode: isAppError(error) ? error.statusCode : 500,
              accountId,
              errorCode: isAppError(error) ? error.code : 'ENGINE_ERROR',
              reason: error instanceof Error ? error.message : 'Discovery failed.',
            }),
          );
          scheduleAuditPersistence(req, failedEvent);
        }

        handleAwsAccountRouteError(res, error, requestId);
      }
    },
  );

  // ---------------------------------------------------------------------
  // Verify account (validate AssumeRole + required IAM permissions)
  // ---------------------------------------------------------------------
  router.post(
    '/aws-accounts/:accountId/verify',
    sensitiveRateLimit,
    requireTenantRole(deps.membershipRepository, ...AWS_ACCOUNT_MANAGEMENT_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      const correlationId = getCorrelationId(req, requestId);
      const actor = getAuditActor(req);
      const tenantId = resolveRouteTenantContext(req).tenantId;
      const accountId = req.params.accountId;

      try {
        await loadTenantAwsAccountOrThrow(deps, tenantId, accountId);

        const { expectedVersion } = validateVerifyAwsAccountBody(req.body);
        const result = await deps.awsAccountApi.verify(tenantId, accountId, expectedVersion, {
          actor,
          requestId,
          correlationId,
        });

        const event = writeAuditEvent(
          buildAwsAccountApiAuditInput({
            eventName: result.succeeded
              ? AUDIT_EVENTS.ACCOUNT_VERIFIED
              : AUDIT_EVENTS.ACCOUNT_ACTION_FAILED,
            outcome: result.succeeded ? 'success' : 'failure',
            requestId,
            correlationId,
            actor,
            tenantId,
            action: 'aws_account.verify',
            method: req.method,
            path: req.path,
            statusCode: 200,
            accountId: result.account.accountId,
            region: result.account.region,
            reason: result.succeeded ? undefined : result.failureReason,
          }),
        );
        scheduleAuditPersistence(req, event);

        res.json(
          buildSuccessResponse(
            {
              account: sanitizeAwsAccountRecord(result.account),
              succeeded: result.succeeded,
              permissionReport: result.permissionReport,
              failureReason: result.failureReason,
            },
            requestId,
          ),
        );
      } catch (error) {
        handleAwsAccountRouteError(res, error, requestId);
      }
    },
  );

  // ---------------------------------------------------------------------
  // Update configuration (region / metadata only)
  // ---------------------------------------------------------------------
  router.patch(
    '/aws-accounts/:accountId',
    requireTenantRole(deps.membershipRepository, ...AWS_ACCOUNT_MANAGEMENT_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      const correlationId = getCorrelationId(req, requestId);
      const actor = getAuditActor(req);
      const tenantId = resolveRouteTenantContext(req).tenantId;
      const accountId = req.params.accountId;

      try {
        await loadTenantAwsAccountOrThrow(deps, tenantId, accountId);

        const { expectedVersion, ...changes } = validateUpdateAwsAccountBody(req.body);
        const account = await deps.awsAccountApi.updateConfiguration(
          tenantId,
          accountId,
          changes,
          expectedVersion,
        );

        const event = writeAuditEvent(
          buildAwsAccountApiAuditInput({
            eventName: AUDIT_EVENTS.ACCOUNT_UPDATED,
            outcome: 'success',
            requestId,
            correlationId,
            actor,
            tenantId,
            action: 'aws_account.update',
            method: req.method,
            path: req.path,
            statusCode: 200,
            accountId: account.accountId,
            region: account.region,
            reason: `Updated fields: ${Object.keys(changes).join(', ') || 'none'}`,
          }),
        );
        scheduleAuditPersistence(req, event);

        res.json(buildSuccessResponse(sanitizeAwsAccountRecord(account), requestId));
      } catch (error) {
        handleAwsAccountRouteError(res, error, requestId);
      }
    },
  );

  // ---------------------------------------------------------------------
  // Delete account (soft-delete: status -> DELETED)
  // ---------------------------------------------------------------------
  router.delete(
    '/aws-accounts/:accountId',
    sensitiveRateLimit,
    requireTenantRole(deps.membershipRepository, ...AWS_ACCOUNT_MANAGEMENT_ROLES),
    requirePrivilegedMfa(PRIVILEGED_OPERATIONS.AWS_ACCOUNT_REMOVE),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      const correlationId = getCorrelationId(req, requestId);
      const actor = getAuditActor(req);
      const tenantId = resolveRouteTenantContext(req).tenantId;
      const accountId = req.params.accountId;

      try {
        await loadTenantAwsAccountOrThrow(deps, tenantId, accountId);

        const { expectedVersion } = validateDeleteAwsAccountBody(req.body);
        const account = await deps.awsAccountApi.remove(tenantId, accountId, expectedVersion);

        const event = writeAuditEvent(
          buildAwsAccountApiAuditInput({
            eventName: AUDIT_EVENTS.ACCOUNT_REMOVED,
            outcome: 'success',
            requestId,
            correlationId,
            actor,
            tenantId,
            action: 'aws_account.remove',
            method: req.method,
            path: req.path,
            statusCode: 200,
            accountId: account.accountId,
            region: account.region,
          }),
        );
        scheduleAuditPersistence(req, event);

        res.json(buildSuccessResponse(sanitizeAwsAccountRecord(account), requestId));
      } catch (error) {
        handleAwsAccountRouteError(res, error, requestId);
      }
    },
  );

  return router;
}
