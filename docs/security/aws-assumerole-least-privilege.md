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
- Execution read probes used by verify/discovery: all eight mandatory EC2 discovery actions listed below, plus RDS, S3, Lambda, CloudFront, Auto Scaling (see `REQUIRED_PERMISSION_CHECKS` in the permission validator)

### EC2 inventory discovery (customer role only)

Read-only actions used by the EC2 discovery adapter (grant on the customer integration role, not the platform Lambda):

- `ec2:DescribeInstances`
- `ec2:DescribeImages`
- `ec2:DescribeVolumes`
- `ec2:DescribeAddresses`
- `ec2:DescribeNetworkInterfaces`
- `ec2:DescribePlacementGroups`
- `ec2:DescribeLaunchTemplates`
- `ec2:DescribeSecurityGroups`

Verification probes **each** action below individually during account verify; grant the full list so regional inventory and security analysis evidence succeed.

### EC2 cost analysis (Engineer 2)

- `cloudwatch:GetMetricData` — bounded performance evidence for cost rules (customer role only; resource `*` where required by CloudWatch)

### Optional discovery reads

- `iam:ListAccountAliases` — alias metadata; AccessDenied → warning only
- `organizations:DescribeOrganization` — org ID; AccessDenied / not in org → warning only

## Least privilege assurance

Successful read-only checks **do not prove** the role lacks write permissions. Discovery reports `leastPrivilegeAssurance: NOT_VERIFIED` unless future policy-evidence workflows say otherwise.

Credentials are **never** stored in DynamoDB, logs, audit, or API responses.
