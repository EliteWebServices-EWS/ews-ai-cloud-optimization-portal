# Learning DynamoDB deep validation

`tests/integration/learning.validation.test.ts` exercises conditional writes (duplicate rejection, stale version, concurrent update). It **only runs** when both environment variables are set:

- `DYNAMODB_ENDPOINT` (e.g. `http://localhost:8000` for DynamoDB Local)
- `DYNAMODB_TABLE_NAME` (explicit test table, never a production name)

Normal `npm test` **skips** this suite safely with no AWS calls.

Focused run (after creating the validation table):

```bash
cd backend
DYNAMODB_ENDPOINT=http://localhost:8000 \
DYNAMODB_TABLE_NAME=sisum-sprint11-validation \
npm run test:learning-validation
```

Production tables such as `sisum-learning-production` must never be used as a fallback.
