import { z } from 'zod';

import { runStore } from '@/lib/runtime/run-store';
import { flowDefinitionSchema, jsonObjectSchema } from '@/lib/runtime/schemas';
import { ensureDemoRuns, errorResponse, readJson, runResponse } from './_shared';

const createRunSchema = z
  .object({
    demoId: z
      .enum(['booking-preparation', 'vessel-departed', 'unexpected-transshipment'])
      .optional(),
    label: z.string().trim().min(1).max(160).optional(),
    flow: flowDefinitionSchema.optional(),
    seed: jsonObjectSchema.optional(),
  })
  .strict();

export async function GET() {
  try {
    await ensureDemoRuns();
    return Response.json({
      persistence: 'IN_MEMORY_NON_DURABLE',
      singleProcess: true,
      runs: runStore.listRuns(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const raw = request.headers.get('content-length') === '0' ? {} : await readJson(request);
    const input = createRunSchema.parse(raw);
    const run = await runStore.createRun(input);
    return Response.json(runResponse(run), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
