import { z } from 'zod';

import { inferFlowMutationWithTelemetry } from '@/lib/runtime/infer-step-semantics';
import { runtimeRunRepository } from '@/lib/runtime/runtime-run-repository';
import { flowMutationSchema } from '@/lib/runtime/schemas';
import { contextRunId, errorResponse, readJson, runResponse } from '../../_shared';
import { attachRuntimeSession, runtimeSession } from '../../_session';

type Context = { params: Promise<{ runId: string }> | { runId: string } };

const instructionSchema = z
  .object({
    instruction: z.string().trim().min(1).max(500),
    expectedFlowVersion: z.number().int().positive(),
  })
  .strict();

export async function POST(request: Request, context: Context) {
  const session = runtimeSession(request);
  try {
    const runId = await contextRunId(context);
    const raw = await readJson(request);
    const instruction = instructionSchema.safeParse(raw);
    const inferred = instruction.success
      ? await inferFlowMutationWithTelemetry(instruction.data)
      : null;
    const mutation = inferred?.mutation ?? flowMutationSchema.parse(raw);
    const run = await runtimeRunRepository.mutateFlow(runId, mutation, session.sessionId);
    return attachRuntimeSession(Response.json({
      ...runResponse(run),
      mutation: {
        operation: mutation.operation,
        insertedStepId: mutation.step.id,
        title: mutation.step.title,
      },
      climax: 'FLOW CHANGED → ARI UNDERSTOOD → UI RECOMPOSED',
      agentExecution: inferred?.agentExecution ?? {
        providerId: 'validated-json',
        providerMode: 'deterministic_fallback',
        structuredOutput: false,
      },
      persistence: await runtimeRunRepository.persistence(),
    }), session.setCookie);
  } catch (error) {
    return attachRuntimeSession(errorResponse(error), session.setCookie);
  }
}
