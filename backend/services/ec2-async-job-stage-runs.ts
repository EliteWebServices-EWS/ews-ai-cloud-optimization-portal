/** Lambda/SQS timing for the EC2 intelligence async consumer (see AWS Lambda + SQS guidance). */
export const EC2_ANALYSIS_CONSUMER_LAMBDA_TIMEOUT_SECONDS = 300;

/** visibility timeout >= 6 × Lambda timeout (BatchSize 1, no batching window). */
export const EC2_INTELLIGENCE_QUEUE_VISIBILITY_TIMEOUT_SECONDS =
  EC2_ANALYSIS_CONSUMER_LAMBDA_TIMEOUT_SECONDS * 6;

export function ec2AsyncJobDiscoveryRunId(jobId: string): string {
  return `${jobId}#discovery`;
}

export function ec2AsyncJobCostRunId(jobId: string): string {
  return `${jobId}#cost`;
}

export function ec2AsyncJobSecurityRunId(jobId: string): string {
  return `${jobId}#security`;
}
