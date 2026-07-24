import { isPersistenceEnabled } from './persistence-table';

const REQUIRED_TABLE_VARS = [
  'WORKFLOWS_TABLE_NAME',
  'OWNERSHIP_TABLE_NAME',
  'REPORTS_TABLE_NAME',
  'LEARNING_TABLE_NAME',
  'VERIFICATIONS_TABLE_NAME',
] as const;

export type PersistenceTableEnvVar = (typeof REQUIRED_TABLE_VARS)[number];

export class PersistenceConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceConfigurationError';
  }
}

function resolveEnvironmentName(): string {
  return (
    process.env.ENVIRONMENT?.trim() ||
    process.env.NODE_ENV?.trim() ||
    'development'
  ).toLowerCase();
}

export function isDeployedEnvironment(environment = resolveEnvironmentName()): boolean {
  return environment === 'production' || environment === 'staging';
}

export function isExplicitLocalTestEnvironment(
  environment = resolveEnvironmentName(),
): boolean {
  return (
    environment === 'test' ||
    environment === 'local' ||
    environment === 'development'
  );
}

export function listMissingPersistenceTables(): PersistenceTableEnvVar[] {
  return REQUIRED_TABLE_VARS.filter((envVar) => {
    const value = process.env[envVar]?.trim();
    return !value;
  });
}

/**
 * Deployed environments must configure every Sprint 11 table and must not
 * disable persistence. Local/test may omit tables when callers inject mocks.
 */
export function validateDeployedPersistenceConfig(
  environment = resolveEnvironmentName(),
): void {
  if (!isDeployedEnvironment(environment)) {
    return;
  }

  if (!isPersistenceEnabled()) {
    throw new PersistenceConfigurationError(
      'PERSISTENCE_ENABLED=false is not allowed in deployed environments.',
    );
  }

  const missing = listMissingPersistenceTables();
  if (missing.length > 0) {
    throw new PersistenceConfigurationError(
      `Missing required persistence table configuration: ${missing.join(', ')}`,
    );
  }
}

export function shouldUseDurablePersistence(
  environment = resolveEnvironmentName(),
): boolean {
  if (!isPersistenceEnabled()) {
    return false;
  }

  if (isDeployedEnvironment(environment)) {
    validateDeployedPersistenceConfig(environment);
    return true;
  }

  return listMissingPersistenceTables().length === 0;
}
