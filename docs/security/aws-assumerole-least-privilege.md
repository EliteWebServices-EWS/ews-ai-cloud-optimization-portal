# AWS AssumeRole least privilege

## Platform runtime (SISU'M Lambda)

- Requires **`sts:AssumeRole`** on customer role ARNs (see `SisumStsAssumeRolePolicy` in `backend/template.yaml`).
- Does **not** receive customer `iam:*`, `organizations:*`, or `ec2:*` on customer accounts — those belong on the **customer cross-account role**.

## Customer role (trust + permissions)

### Trust

- Principal: SISU'M platform account
- **`sts:ExternalId`**: tenant-specific value from registration (confused-deputy protection)

### Required read permissions (minimum)

- `sts:GetCallerIdentity`
- `ec2:DescribeRegions`
- Execution read probes used by verify/discovery: EC2, RDS, S3, Lambda, CloudFront, Auto Scaling (see permission validator)

### Optional discovery reads

- `iam:ListAccountAliases` — alias metadata; AccessDenied → warning only
- `organizations:DescribeOrganization` — org ID; AccessDenied / not in org → warning only

## Least privilege assurance

Successful read-only checks **do not prove** the role lacks write permissions. Discovery reports `leastPrivilegeAssurance: NOT_VERIFIED` unless future policy-evidence workflows say otherwise.

Credentials are **never** stored in DynamoDB, logs, audit, or API responses.
