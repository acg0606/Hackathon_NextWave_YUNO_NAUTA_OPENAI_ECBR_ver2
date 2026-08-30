import { z } from 'zod';

import { runtimeRunRepository } from '@/lib/runtime/runtime-run-repository';
import { flowDefinitionSchema, jsonObjectSchema } from '@/lib/runtime/schemas';
import { ensureDemoRuns, errorResponse, readJson, runResponse } from './_shared';
import { attachRuntimeSession, runtimeSession } from './_session';

const createRunSchema = z
  .object({
    demoId: z
      .enum(['booking-preparation', 'vessel-departed', 'unexpected-transshipment'])
      .optional(),
    label: z.string().trim().min(1).max(160).optional(),
    idempotencyKey: z.uuid().optional(),
    flow: flowDefinitionSchema.optional(),
    seed: jsonObjectSchema.optional(),
  })
  .strict();

export async function GET(request: Request) {
  const session = runtimeSession(request);
  try {
    await ensureDemoRuns(session.sessionId);
    const persistence = await runtimeRunRepository.persistence();
    return attachRuntimeSession(Response.json({
      persistence,
      singleProcess: persistence === 'IN_MEMORY_NON_DURABLE',
      runs: await runtimeRunRepository.listRuns(session.sessionId),
    }), session.setCookie);
  } catch (error) {
    return attachRuntimeSession(errorResponse(error), session.setCookie);
  }
}

export async function POST(request: Request) {
  const session = runtimeSession(request);
  try {
    const raw = request.headers.get('content-length') === '0' ? {} : await readJson(request);
    const input = createRunSchema.parse(raw);
    const { idempotencyKey, ...runInput } = input;
    const run = await runtimeRunRepository.createRun({
      ...runInput,
      ...(idempotencyKey ? { bootstrapId: `request-${idempotencyKey}` } : {}),
    }, session.sessionId);
    return attachRuntimeSession(Response.json({
      ...runResponse(run),
      persistence: await runtimeRunRepository.persistence(),
    }, { status: 201 }), session.setCookie);
  } catch (error) {
    return attachRuntimeSession(errorResponse(error), session.setCookie);
  }
}
