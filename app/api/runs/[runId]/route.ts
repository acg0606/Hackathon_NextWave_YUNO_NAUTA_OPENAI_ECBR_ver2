import { runStore } from '@/lib/runtime/run-store';
import { contextRunId, errorResponse, runResponse } from '../_shared';

type Context = { params: Promise<{ runId: string }> | { runId: string } };

export async function GET(_request: Request, context: Context) {
  try {
    const runId = await contextRunId(context);
    return Response.json({
      ...runResponse(runStore.getRun(runId)),
      persistence: 'IN_MEMORY_NON_DURABLE',
    });
  } catch (error) {
    return errorResponse(error);
  }
}
