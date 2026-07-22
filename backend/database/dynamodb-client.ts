import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  type TranslateConfig,
} from '@aws-sdk/lib-dynamodb';

/**
 * Controls how JavaScript values are converted to and from DynamoDB values.
 */
const translateConfig: TranslateConfig = {
  marshallOptions: {
    removeUndefinedValues: true,
    convertClassInstanceToMap: true,
  },
  unmarshallOptions: {
    wrapNumbers: false,
  },
};

/**
 * Low-level DynamoDB client.
 *
 * AWS_REGION is supplied automatically in Lambda.
 * The fallback supports local development.
 */
const dynamoDbClient = new DynamoDBClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
});

/**
 * Shared document client used by all DynamoDB repositories.
 *
 * Creating it once allows Lambda execution environments to reuse the
 * underlying connections between invocations.
 */
export const dynamoDbDocumentClient =
  DynamoDBDocumentClient.from(
    dynamoDbClient,
    translateConfig,
  );