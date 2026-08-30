import { runtimeRunRepository } from '@/lib/runtime/runtime-run-repository';
import { humanActionSchema } from '@/lib/runtime/schemas';
import { contextRunId, errorResponse, readJson, runResponse } from '../../_shared';
import { attachRuntimeSession, runtimeSession } from '../../_session';

type Context = { params: Promise<{ runId: string }> | { runId: string } };

export async function POST(request: Request, context: Context) {
  const session = runtimeSession(request);
  try {
    const runId = await contextRunId(context);
    const raw = (await readJson(request)) as Record<string, unknown>;
    const action = humanActionSchema.parse({ ...raw, runId });
    const run = await runtimeRunRepository.submitAction(runId, action, session.sessionId);
    return attachRuntimeSession(Response.json({
      ...runResponse(run),
      persistence: await runtimeRunRepository.persistence(),
    }, { status: 202 }), session.setCookie);
  } catch (error) {
    return attachRuntimeSession(errorResponse(error), session.setCookie);
  }
}
