import { z } from 'zod';

import { inferFlowMutationWithTelemetry } from '@/lib/runtime/infer-step-semantics';
import { runStore } from '@/lib/runtime/run-store';
import { flowMutationSchema } from '@/lib/runtime/schemas';
import { contextRunId, errorResponse, readJson, runResponse } from '../../_shared';

type Context = { params: Promise<{ runId: string }> | { runId: string } };

const instructionSchema = z
  .object({
    instruction: z.string().trim().min(1).max(500),
    expectedFlowVersion: z.number().int().positive(),
  })
  .strict();

export async function POST(request: Request, context: Context) {
  try {
    const runId = await contextRunId(context);
    const raw = await readJson(request);
    const instruction = instructionSchema.safeParse(raw);
    const inferred = instruction.success
      ? await inferFlowMutationWithTelemetry(instruction.data)
      : null;
    const mutation = inferred?.mutation ?? flowMutationSchema.parse(raw);
    const run = await runStore.mutateFlow(runId, mutation);
    return Response.json({
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
    });
  } catch (error) {
    return errorResponse(error);
  }
}
