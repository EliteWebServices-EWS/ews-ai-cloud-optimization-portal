import type {
  OwnershipRecord,
  OwnershipResourceType,
} from '../models';

export type CreateOwnershipInput = Omit<
  OwnershipRecord,
  'version' | 'createdAt' | 'updatedAt'
>;

export interface OwnershipRepository {
  create(input: CreateOwnershipInput): Promise<OwnershipRecord>;

  get(
    resourceType: OwnershipResourceType,
    resourceId: string,
  ): Promise<OwnershipRecord | undefined>;

  delete(
    resourceType: OwnershipResourceType,
    resourceId: string,
    expectedVersion?: number,
  ): Promise<void>;
}