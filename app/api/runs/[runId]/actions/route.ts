import { runStore } from '@/lib/runtime/run-store';
import { humanActionSchema } from '@/lib/runtime/schemas';
import { contextRunId, errorResponse, readJson, runResponse } from '../../_shared';

type Context = { params: Promise<{ runId: string }> | { runId: string } };

export async function POST(request: Request, context: Context) {
  try {
    const runId = await contextRunId(context);
    const raw = (await readJson(request)) as Record<string, unknown>;
    const action = humanActionSchema.parse({ ...raw, runId });
    const run = await runStore.submitAction(runId, action);
    return Response.json(runResponse(run), { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
