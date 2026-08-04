import { Router, type Request, type Response } from 'express';
import { analyzeEc2Security, type Ec2GovernancePolicy, type Ec2SecurityInventoryItem } from '../../engines/ec2-security';
import { ANALYSIS_ROLES, requireAnyRole } from '../../auth';
import { buildErrorResponse, buildSuccessResponse, generateRequestId } from '../../shared/utils';

/** In-memory analysis cache; intentionally process-local until persistence is introduced. */
let latestAnalysis: ReturnType<typeof analyzeEc2Security> | undefined;

function isInventory(value: unknown): value is Ec2SecurityInventoryItem[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'object' && item !== null && typeof (item as { instanceId?: unknown }).instanceId === 'string' && typeof (item as { instanceType?: unknown }).instanceType === 'string');
}

export function createEc2SecurityRoutes(): Router {
  const router = Router();
  router.post('/analysis/ec2/security', requireAnyRole(...ANALYSIS_ROLES), (req: Request, res: Response) => {
    const requestId = generateRequestId();
    const inventory = req.body?.inventory;
    if (!isInventory(inventory)) {
      res.status(400).json(buildErrorResponse('VALIDATION_ERROR', 'Body.inventory must be an array of EC2 inventory items with instanceId and instanceType.', requestId, 'ec2-security'));
      return;
    }
    latestAnalysis = analyzeEc2Security(inventory, (req.body?.policy ?? {}) as Ec2GovernancePolicy);
    res.json(buildSuccessResponse(latestAnalysis, requestId));
  });
  router.get('/recommendations/ec2/security', (_req: Request, res: Response) => {
    const requestId = generateRequestId();
    if (!latestAnalysis) {
      res.status(404).json(buildErrorResponse('ANALYSIS_NOT_FOUND', 'Run POST /analysis/ec2/security before requesting recommendations.', requestId, 'ec2-security'));
      return;
    }
    res.json(buildSuccessResponse({ analyzedAt: latestAnalysis.analyzedAt, summary: latestAnalysis.summary, recommendations: latestAnalysis.results.flatMap((result) => result.recommendations.map((recommendation) => ({ instanceId: result.instanceId, ...recommendation }))) }, requestId));
  });
  return router;
}
