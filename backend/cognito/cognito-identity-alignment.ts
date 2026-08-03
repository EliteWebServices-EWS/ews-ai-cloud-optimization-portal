/**
 * Narrow Cognito adapter for aligning custom:tenantId on the tenant owner profile.
 */

import {
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
  type CognitoIdentityProviderServiceException,
} from '@aws-sdk/client-cognito-identity-provider';

import { TENANT_USER_PROFILE_ATTRIBUTE } from '../auth/tenant-claims';
import { AppError } from '../shared/utils';

export interface CognitoIdentityAlignmentPort {
  assignTenantToUser(input: {
    username: string;
    tenantId: string;
  }): Promise<void>;
}

export class CognitoIdentityAlignmentError extends Error {
  readonly code = 'COGNITO_IDENTITY_ALIGNMENT_FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'CognitoIdentityAlignmentError';
  }
}

function resolveUserPoolId(): string {
  const poolId = process.env.COGNITO_USER_POOL_ID?.trim();

  if (!poolId) {
    throw new CognitoIdentityAlignmentError(
      'COGNITO_USER_POOL_ID is not configured for identity alignment.',
    );
  }

  return poolId;
}

function mapCognitoError(error: unknown): never {
  if (!(error instanceof Error)) {
    throw new CognitoIdentityAlignmentError('Cognito identity alignment failed.');
  }

  const serviceError = error as CognitoIdentityProviderServiceException;

  if (serviceError.name === 'UserNotFoundException') {
    throw new AppError(
      'COGNITO_USER_NOT_FOUND',
      'The configured tenant owner was not found in Cognito.',
      404,
      'tenant-onboarding',
    );
  }

  if (serviceError.name === 'InvalidParameterException') {
    throw new AppError(
      'COGNITO_ALIGNMENT_INVALID',
      'Cognito rejected the tenant identity assignment request.',
      400,
      'tenant-onboarding',
    );
  }

  throw new AppError(
    'COGNITO_ALIGNMENT_FAILED',
    'Cognito tenant identity assignment failed. The tenant remains in PROVISIONING; retry complete-onboarding.',
    503,
    'tenant-onboarding',
  );
}

export class DynamoCognitoIdentityAlignment implements CognitoIdentityAlignmentPort {
  private readonly client: CognitoIdentityProviderClient;
  private readonly userPoolId: string;

  constructor(
    client: CognitoIdentityProviderClient,
    userPoolId: string,
  ) {
    this.client = client;
    this.userPoolId = userPoolId;
  }

  async assignTenantToUser(input: {
    username: string;
    tenantId: string;
  }): Promise<void> {
    try {
      await this.client.send(
        new AdminUpdateUserAttributesCommand({
          UserPoolId: this.userPoolId,
          Username: input.username,
          UserAttributes: [
            {
              Name: TENANT_USER_PROFILE_ATTRIBUTE,
              Value: input.tenantId,
            },
          ],
        }),
      );
    } catch (error) {
      mapCognitoError(error);
    }
  }
}

export function createCognitoIdentityAlignmentPort(): CognitoIdentityAlignmentPort {
  const userPoolId = resolveUserPoolId();
  const client = new CognitoIdentityProviderClient({});

  return new DynamoCognitoIdentityAlignment(client, userPoolId);
}

/** Test/local injection — records assignments without AWS. */
export class InMemoryCognitoIdentityAlignment
  implements CognitoIdentityAlignmentPort
{
  readonly assignments = new Map<string, string>();
  failWith: Error | null = null;

  async assignTenantToUser(input: {
    username: string;
    tenantId: string;
  }): Promise<void> {
    if (this.failWith) {
      throw this.failWith;
    }

    this.assignments.set(input.username, input.tenantId);
  }
}
