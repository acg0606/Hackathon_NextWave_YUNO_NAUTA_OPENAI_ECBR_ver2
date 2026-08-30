import { runtimeRunRepository } from '@/lib/runtime/runtime-run-repository';
import { contextRunId, errorResponse, runResponse } from '../_shared';
import { attachRuntimeSession, runtimeSession } from '../_session';

type Context = { params: Promise<{ runId: string }> | { runId: string } };

export async function GET(request: Request, context: Context) {
  const session = runtimeSession(request);
  try {
    const runId = await contextRunId(context);
    const persistence = await runtimeRunRepository.persistence();
    return attachRuntimeSession(Response.json({
      ...runResponse(await runtimeRunRepository.getRun(runId, session.sessionId)),
      persistence,
    }), session.setCookie);
  } catch (error) {
    return attachRuntimeSession(errorResponse(error), session.setCookie);
  }
}
