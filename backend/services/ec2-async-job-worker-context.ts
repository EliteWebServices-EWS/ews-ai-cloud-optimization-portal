import type { AuditActor } from '../audit';

export const EC2_ASYNC_JOB_WORKER_USER_ID = 'system:ec2-async-worker';

export function createEc2AsyncJobWorkerActor(): AuditActor {
  return {
    authenticated: true,
    userId: EC2_ASYNC_JOB_WORKER_USER_ID,
    email: null,
    roles: [],
  };
}

export interface Ec2AsyncJobWorkerCallContext {
  actor: AuditActor;
  requestId: string;
  correlationId: string;
}

export function createEc2AsyncJobWorkerCallContext(input: {
  processingRequestId: string;
  correlationId: string;
}): Ec2AsyncJobWorkerCallContext {
  return {
    actor: createEc2AsyncJobWorkerActor(),
    requestId: input.processingRequestId,
    correlationId: input.correlationId,
  };
}
