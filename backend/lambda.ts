import serverlessExpress from '@codegenie/serverless-express';
import { createApp } from './index';

const app = createApp();

export const handler = serverlessExpress({ app });
