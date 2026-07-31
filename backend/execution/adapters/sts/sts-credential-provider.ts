import { randomUUID } from 'node:crypto';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';

import {
  AUDIT_EVENTS,
  buildAuditEvent,
  persistAuditEvent,
  writeAuditEventFromBuilt,
  type AuditEvent,
} from '../../../audit';
import { createLogger } from '../../../shared/utils';

import { isRetryableStsError, mapStsError } from './sts-error-mapper';
import { withRetry, withTimeout } from './retry';
import {
  StsProviderError,
  validateRoleConfig,
  type AssumedCredentials,
  type AwsAccountRoleConfig,
  type StsAssumeRoleContext,
} from './sts-types';

const logger = createLogger('StsCredentialProvider');

const DEFAULT_DURATION_SECONDS = 3600;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 5_000;
/** Refresh proactively once fewer than this much lifetime remains. */
const DEFAULT_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export interface StsCredentialProviderDeps {
  stsClient?: STSClient;
  now?: () => Date;
  delay?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  refreshMarginMs?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Injectable for tests; defaults to the shared audit pipeline. */
  emitAudit?: (event: AuditEvent) => void | Promise<void>;
}

function cacheKey(config: AwsAccountRoleConfig): string {
  // Namespaced by tenantId in addition to roleArn+externalId so a
  // misconfiguration can never cause one tenant to reuse another tenant's
  // cached credentials, even if two role ARNs were ever accidentally equal.
  return `${config.tenantId}::${config.roleArn}::${config.externalId}`;
}

function buildSessionName(config: AwsAccountRoleConfig): string {
  const prefix = (config.sessionNamePrefix ?? 'sisum').replace(/[^\w+=,.@-]/g, '-');
  // RoleSessionName max length is 64 chars.
  return `${prefix}-${randomUUID()}`.slice(0, 64);
}

/**
 * Assumes and caches short-lived cross-account credentials via STS
 * AssumeRole. Never logs or audits secretAccessKey/sessionToken — only
 * metadata (role ARN, session name, expiration, cache outcome).
 */
export class StsCredentialProvider {
  private readonly stsClient: STSClient;
  private readonly now: () => Date;
  private readonly delay?: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly refreshMarginMs: number;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly emitAudit: (event: AuditEvent) => void | Promise<void>;

  private readonly cache = new Map<string, AssumedCredentials>();
  /** Coalesces concurrent callers for the same cache key into one AssumeRole call. */
  private readonly inFlight = new Map<string, Promise<AssumedCredentials>>();

  constructor(deps: StsCredentialProviderDeps = {}) {
    this.stsClient = deps.stsClient ?? new STSClient({ region: 'us-east-1' });
    this.now = deps.now ?? (() => new Date());
    this.delay = deps.delay;
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.refreshMarginMs = deps.refreshMarginMs ?? DEFAULT_REFRESH_MARGIN_MS;
    this.maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.baseDelayMs = deps.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.maxDelayMs = deps.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    this.emitAudit =
      deps.emitAudit ??
      ((event) => {
        writeAuditEventFromBuilt(event);
        return persistAuditEvent(event);
      });
  }

  /**
   * Returns cached credentials when they are still valid beyond the refresh
   * margin, otherwise assumes the role again. Concurrent calls for the same
   * tenant/role share one in-flight AssumeRole request.
   */
  async getCredentials(
    config: AwsAccountRoleConfig,
    context: StsAssumeRoleContext,
  ): Promise<AssumedCredentials> {
    validateRoleConfig(config);

    const key = cacheKey(config);
    const cached = this.cache.get(key);
    if (cached && this.isFresh(cached)) {
      return cached;
    }

    const existingRequest = this.inFlight.get(key);
    if (existingRequest) {
      return existingRequest;
    }

    const request = this.assumeRole(config, context, key).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, request);

    return request;
  }

  /** Evicts a cache entry, forcing the next getCredentials() to re-assume. */
  invalidate(config: AwsAccountRoleConfig): void {
    this.cache.delete(cacheKey(config));
  }

  private isFresh(credentials: AssumedCredentials): boolean {
    const msRemaining = credentials.expiration.getTime() - this.now().getTime();
    return msRemaining > this.refreshMarginMs;
  }

  private async assumeRole(
    config: AwsAccountRoleConfig,
    context: StsAssumeRoleContext,
    key: string,
  ): Promise<AssumedCredentials> {
    const sessionName = buildSessionName(config);
    const durationSeconds = config.durationSeconds ?? DEFAULT_DURATION_SECONDS;

    await this.audit(
      AUDIT_EVENTS.ASSUME_ROLE_STARTED,
      'started',
      config,
      context,
      { sessionName },
    );

    try {
      const credentials = await withRetry(
        () => this.callAssumeRole(config, sessionName, durationSeconds),
        {
          maxAttempts: this.maxAttempts,
          baseDelayMs: this.baseDelayMs,
          maxDelayMs: this.maxDelayMs,
          isRetryable: isRetryableStsError,
          delay: this.delay,
        },
      );

      this.cache.set(key, credentials);

      await this.audit(
        AUDIT_EVENTS.ASSUME_ROLE_SUCCEEDED,
        'success',
        config,
        context,
        {
          sessionName,
          expiration: credentials.expiration.toISOString(),
        },
      );

      logger.info(`Assumed role for tenant ${config.tenantId}`, {
        operation: 'assumeRole',
        status: 'success',
      });

      return credentials;
    } catch (error) {
      const mapped = mapStsError(error);

      await this.audit(
        AUDIT_EVENTS.ASSUME_ROLE_FAILED,
        'failure',
        config,
        context,
        { sessionName },
        mapped.code,
      );

      logger.error(`AssumeRole failed for tenant ${config.tenantId}: ${mapped.code}`, {
        operation: 'assumeRole',
        status: 'failure',
      });

      throw mapped;
    }
  }

  private async callAssumeRole(
    config: AwsAccountRoleConfig,
    sessionName: string,
    durationSeconds: number,
  ): Promise<AssumedCredentials> {
    return withTimeout(
      async (signal) => {
        const response = await this.stsClient.send(
          new AssumeRoleCommand({
            RoleArn: config.roleArn,
            ExternalId: config.externalId,
            RoleSessionName: sessionName,
            DurationSeconds: durationSeconds,
          }),
          { abortSignal: signal },
        );

        const creds = response.Credentials;
        if (
          !creds?.AccessKeyId ||
          !creds.SecretAccessKey ||
          !creds.SessionToken ||
          !creds.Expiration
        ) {
          throw new StsProviderError(
            'ASSUME_ROLE_INCOMPLETE_RESPONSE',
            'STS AssumeRole response is missing required credential fields.',
            false,
          );
        }

        return {
          accessKeyId: creds.AccessKeyId,
          secretAccessKey: creds.SecretAccessKey,
          sessionToken: creds.SessionToken,
          expiration: creds.Expiration,
          assumedRoleId: response.AssumedRoleUser?.AssumedRoleId ?? '',
          sessionName,
        };
      },
      this.timeoutMs,
      () =>
        new StsProviderError(
          'ASSUME_ROLE_TIMEOUT',
          `AssumeRole did not complete within ${this.timeoutMs}ms.`,
          true,
        ),
    );
  }

  private async audit(
    eventName: (typeof AUDIT_EVENTS)[keyof typeof AUDIT_EVENTS],
    outcome: 'started' | 'success' | 'failure',
    config: AwsAccountRoleConfig,
    context: StsAssumeRoleContext,
    detail: { sessionName: string; expiration?: string },
    errorCode?: string,
  ): Promise<void> {
    // Never include accessKeyId/secretAccessKey/sessionToken here.
    const event = buildAuditEvent({
      eventName,
      outcome,
      requestId: context.requestId,
      correlationId: context.correlationId,
      actor: context.actor,
      tenantId: config.tenantId,
      workflowId: context.workflowId,
      action: 'sts.assume_role',
      resource: {
        type: 'iam-role',
        id: config.roleArn,
      },
      errorCode,
      reason: detail.expiration
        ? `sessionName=${detail.sessionName} expiresAt=${detail.expiration}`
        : `sessionName=${detail.sessionName}`,
    });

    await this.emitAudit(event);
  }
}

export function createStsCredentialProvider(
  deps?: StsCredentialProviderDeps,
): StsCredentialProvider {
  return new StsCredentialProvider(deps);
}
