# Execution API operational notes

## Wiring

`createApp()` constructs `createExecutionRepositories()`, shared `ExecutionOrchestrator`, and `ExecutionApiService`, injected via `ApiDependencies.executionApi`.

## Persistence modes

Same factory as Sprint 12.5: DynamoDB when `EXECUTION_PLANS_TABLE_NAME` and durable persistence gates are satisfied; otherwise in-memory mocks with warning.

## Rollback

Uses `ExecutionOrchestrator.rollbackRun()` with persisted run snapshot state.

## Deployment

Ensure IAM and table env vars before enabling production execution flags in deployed environments.

## CI

Use `npm run test:execution-api` in validation pipelines alongside existing backend test/build/SAM steps.
