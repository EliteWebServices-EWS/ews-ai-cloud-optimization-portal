import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';

import { TENANT_USER_PROFILE_ATTRIBUTE } from '../../auth/tenant-claims';
import { DynamoCognitoIdentityAlignment } from '../../cognito/cognito-identity-alignment';

describe('DynamoCognitoIdentityAlignment', () => {
  it('sends only custom:tenantId via AdminUpdateUserAttributes', async () => {
    const sent: unknown[] = [];
    const client = {
      send: async (command: unknown) => {
        sent.push(command);
        return {};
      },
    } as unknown as CognitoIdentityProviderClient;

    const adapter = new DynamoCognitoIdentityAlignment(client, 'pool-test');

    await adapter.assignTenantToUser({
      username: 'owner-sub-1',
      tenantId: 'tenant-generated-1',
    });

    assert.equal(sent.length, 1);
    const command = sent[0] as AdminUpdateUserAttributesCommand;
    assert.ok(command instanceof AdminUpdateUserAttributesCommand);
    assert.equal(command.input.UserPoolId, 'pool-test');
    assert.equal(command.input.Username, 'owner-sub-1');
    assert.deepEqual(command.input.UserAttributes, [
      { Name: TENANT_USER_PROFILE_ATTRIBUTE, Value: 'tenant-generated-1' },
    ]);
  });
});
