import { createAwsAccountRepository } from './aws-account-repository-factory';
import { createEc2CloudResourceRepositories } from './ec2-cloud-resource-repository-factory';
import { createEc2CostRepositories } from './ec2-cost-repository-factory';
import { createEc2SecurityRepositories } from './ec2-security-repository-factory';
import { createEc2AsyncJobRepository } from './ec2-async-job-repository-factory';
import { Ec2DiscoveryApiService } from './ec2-discovery-api-service';
import { Ec2CostAnalysisApiService } from './ec2-cost-analysis-api-service';
import { Ec2SecurityAnalysisApiService } from './ec2-security-analysis-api-service';
import {
  Ec2AsyncJobConsumerService,
  type Ec2AsyncJobConsumerServiceDeps,
} from './ec2-async-job-consumer-service';
import { Ec2AsyncJobStageCompletionService } from './ec2-async-job-stage-completion';
import { Ec2AsyncJobStageExecutionService } from './ec2-async-job-stage-execution';

export function createEc2AsyncJobConsumerService(
  deps: Ec2AsyncJobConsumerServiceDeps,
): Ec2AsyncJobConsumerService {
  return new Ec2AsyncJobConsumerService(deps);
}

export function createEc2AsyncJobConsumerServiceFromEnv(): Ec2AsyncJobConsumerService {
  const awsAccounts = createAwsAccountRepository();
  const ec2Resources = createEc2CloudResourceRepositories();
  const ec2Cost = createEc2CostRepositories();
  const ec2Security = createEc2SecurityRepositories();
  const jobs = createEc2AsyncJobRepository();

  return createEc2AsyncJobConsumerService({
    jobs,
    awsAccounts,
    discovery: new Ec2DiscoveryApiService(
      awsAccounts,
      ec2Resources.resources,
      ec2Resources.runs,
    ),
    cost: new Ec2CostAnalysisApiService(
      awsAccounts,
      ec2Resources.resources,
      ec2Cost.recommendations,
      ec2Cost.runs,
    ),
    security: new Ec2SecurityAnalysisApiService(
      awsAccounts,
      ec2Resources.resources,
      ec2Security.findings,
      ec2Security.summaries,
      ec2Security.runs,
    ),
    stageCompletion: new Ec2AsyncJobStageCompletionService(
      ec2Resources.runs,
      ec2Cost.runs,
      ec2Security.runs,
    ),
    stageExecution: new Ec2AsyncJobStageExecutionService(
      ec2Resources.runs,
      ec2Cost.runs,
      ec2Security.runs,
    ),
  });
}
