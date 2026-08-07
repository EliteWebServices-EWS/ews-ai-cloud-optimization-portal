# EC2 asynchronous job reliability runbook

This runbook covers the SQS-backed EC2 job producer and worker.  The monitoring
stack is parameterized, so use the deployed environment's queue and worker
names rather than the production defaults shown in the template.

## Operating model

The producer logs `ec2.job_queued`; the worker logs `ec2.job_started`,
`ec2.job_retry`, `ec2.job_partial`, `ec2.job_failed`, and
`ec2.job_completed`.  A DLQ mover or redrive utility must additionally log
`ec2.job_dlq_moved` and `ec2.job_redrive_completed`.  Every event must include
the `jobId`, request ID, correlation ID, and (for a delivery) attempt number.
Do not put job bodies, credentials, tokens, or customer tags in audit events.

The `SISUM-<environment>-EC2-Jobs` dashboard is the primary view.  It shows
queue depth, oldest-message age, worker errors/duration/concurrency, success
rate, retry rate, DLQ depth, and the reliability alarm state.

## Initial setup and mock validation

Deploy the worker and producer before the monitoring stack, and ensure these
log groups exist before deploying CloudWatch metric filters:

```powershell
aws logs create-log-group --log-group-name /aws/lambda/<producer-function>
aws logs create-log-group --log-group-name /aws/lambda/<worker-function>
aws cloudformation deploy --stack-name sisum-monitoring-<environment> --template-file infrastructure/monitoring/template.yaml --parameter-overrides Environment=<environment> Ec2JobQueueName=<queue-name> Ec2JobDeadLetterQueueName=<dlq-name> Ec2JobProducerFunctionName=<producer-function> Ec2JobWorkerFunctionName=<worker-function>
```

For a non-production validation, write the structured audit events using the
mock worker/producer and confirm the `SISUM/EC2Jobs` metrics.  Check metric
filters before relying on alarms:

```powershell
aws logs describe-metric-filters --log-group-name /aws/lambda/<worker-function>
aws cloudwatch get-metric-data --metric-data-queries file://metric-queries.json --start-time <ISO-START> --end-time <ISO-END>
```

## Queue recovery

1. Acknowledge the queue-age or depth alarm and record the alarm time.
2. Inspect queue depth, oldest age, in-flight count, worker Errors, Duration,
   ConcurrentExecutions, and Throttles on the EC2 Jobs dashboard.
3. Confirm the worker is enabled and that its reserved concurrency, event
   source mapping, timeout, and visibility timeout are compatible. The queue
   visibility timeout must exceed the Lambda timeout plus a safe retry margin.
4. If the worker is healthy but lagging, increase event-source concurrency in
   a reviewed change. If it is failing, fix the failure first; do not simply
   increase concurrency.
5. Watch oldest-message age fall for at least three one-minute periods before
   resolving the alarm.

```powershell
aws sqs get-queue-attributes --queue-url <queue-url> --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible ApproximateAgeOfOldestMessage RedrivePolicy
aws lambda list-event-source-mappings --function-name <worker-function>
aws lambda get-function-concurrency --function-name <worker-function>
```

## DLQ replay

Never replay a DLQ until the triggering defect, dependency outage, malformed
payload class, or permission error is understood. Preserve the incident ID,
message count, and a sample of sanitized message metadata first.

1. Stop or disable the worker event source mapping if replay could worsen an
   active incident.
2. Confirm the primary queue is draining normally and has capacity.
3. Use SQS managed redrive; do not manually receive, delete, and resend
   production messages. Set a conservative velocity and monitor retry rate.
4. The redrive utility must write `ec2.job_redrive_completed` for the run.
5. Verify the DLQ returns to zero and reconcile completed, partial, and failed
   job audit events by correlation ID before closing the incident.

```powershell
aws sqs start-message-move-task --source-arn <dlq-arn> --destination-arn <primary-queue-arn> --max-number-of-messages-per-second 10
aws sqs list-message-move-tasks --source-arn <dlq-arn> --max-results 10
```

## Retry procedure

The worker records `ec2.job_retry` whenever SQS redelivers a job. Retry only
transient conditions (for example, service throttling or an unavailable
dependency). Treat authorization failures, invalid payloads, and policy
violations as non-retryable so they reach the DLQ promptly. Keep processing
idempotent by job ID; a redelivered message may already have partially run.

When retry rate exceeds the configured threshold:

1. Compare `JobRetried` with `JobStarted` and inspect the common error code.
2. Check downstream AWS service throttling and Lambda duration.
3. Apply backoff or reduce worker concurrency if a downstream service is
   saturated. Raise capacity only after confirming the worker is the limit.
4. Confirm that the retry rate falls for two consecutive five-minute periods.

## Alarm investigation

| Alarm | First checks | Escalation condition |
| --- | --- | --- |
| DLQ messages | Audit `ec2.job_failed`, message class, recent deploys | Any unexplained DLQ message |
| Queue age | Worker mapping, concurrency, Errors, Duration | Age rises for three minutes |
| Worker errors | CloudWatch Logs by correlation ID and `errorCode` | Repeated error or customer impact |
| Retry rate | Dependency health, error-code distribution, throughput | Sustained rate above threshold |
| Throttles | Reserved/account concurrency and event-source scaling | Throttles persist after capacity review |
| Timeouts | Duration versus Lambda timeout; hung dependency | Any timeout (messages may be retried) |

## Operational troubleshooting

Use CloudWatch Logs Insights against the producer and worker log groups to
build an incident timeline. Replace the time window and job ID as needed:

```text
fields @timestamp, eventName, jobId, attempt, correlationId, errorCode, reason
| filter category = "audit" and jobId = "<job-id>"
| sort @timestamp asc
```

An empty custom metric with present audit logs usually means a metric filter is
attached to the wrong log group or does not match the canonical event name.
An empty audit trail with Lambda Errors usually means the runtime stopped before
the failure event could be emitted; use the Lambda request ID and timeout log
line, then inspect the SQS receive count.  Record the dashboard screenshot,
alarm history, correlation IDs, and remediation in the incident ticket.
