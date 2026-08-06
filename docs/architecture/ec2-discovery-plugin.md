# EC2 discovery plugin architecture

Sprint 14 Engineer 1 — first **Cloud Intelligence** discovery plugin (`service=ec2`).

## Flow

1. Tenant calls `POST /api/v1/aws-accounts/:accountId/ec2/discovery` (verified account only).
2. API resolves tenant from trusted JWT context; RBAC via membership roles.
3. `Ec2DiscoveryApiService` loads account, builds `StsCredentialProvider` + `createAssumeRoleClientFactory` (Sprint 13).
4. `Ec2CloudDiscoveryPlugin` uses `Ec2DiscoveryClientPort` (AWS adapter) — no SDK types outside adapter.
5. `Ec2DiscoveryOrchestrator` upserts resources, marks `NOT_SEEN` for missing IDs in **successful** region+type scopes, records discovery run.
6. Inventory persisted in `CLOUD_RESOURCES_TABLE_NAME` (DynamoDB Query only).

## Plugin contract

`CloudResourceDiscoveryPlugin` in `backend/cloud-intelligence/plugins/cloud-resource-discovery-plugin.ts`.

## Resource types

`INSTANCE`, `IMAGE`, `VOLUME`, `ELASTIC_IP`, `NETWORK_INTERFACE`, `PLACEMENT_GROUP`, `LAUNCH_TEMPLATE`.

## Keys (DynamoDB)

- `pk = TENANT#{tenantId}#AWS_ACCOUNT#{accountId}`
- Resource `sk = CLOUD_RESOURCE#{region}#SERVICE#ec2#TYPE#{resourceType}#ID#{resourceId}`
- Run `sk = EC2_DISCOVERY_RUN#{runId}`

## Stale rule

Resources are marked `NOT_SEEN` only when a discovery run **successfully completed** the same account + region + resource type scope and the resource ID was absent from that run.

## Volume attachment metadata (Engineer 1 → Engineer 2)

`VOLUME` records persist `metadata.attachments[]` when EC2 discovery maps `DescribeVolumes` attachments:

- `instanceId`, optional `deviceName`, `state`, `attachTime`, `deleteOnTermination`
- Derived `attachedInstanceIds` lists instance IDs in `attached` state

Legacy inventory without `attachments` requires a **new EC2 discovery run** before STOPPED_WITH_STORAGE cost analysis can link volumes to instances.

## Limitations

- Synchronous discovery in existing Lambda (no queues).
- Default **one region** (registered account region); max **3** regions per request.
- No cost, security, or rightsizing analysis in this scope.

See also [Sprint 13 live AWS integration](../architecture/sprint-13-live-aws-integration.md).

**Production validation (Engineer 1):** [EC2 discovery validation — production section](../validation/ec2-discovery-validation.md#production-validation-sprint-14-engineer-1).
