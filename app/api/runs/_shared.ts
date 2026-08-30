import { z } from 'zod';

import { demoRunPresets } from '@/lib/demo/muebles-del-sur-operation';
import {
  RunConflictError,
  RunInputError,
  RunNotFoundError,
  type StoredRun,
} from '@/lib/runtime/run-store';
import { runtimeRunRepository } from '@/lib/runtime/runtime-run-repository';

const globalBootstrap = globalThis as typeof globalThis & {
  __routeShiftDemoBootstrap?: Map<string, Promise<void>>;
};

export async function ensureDemoRuns(sessionId: string) {
  const existingLabels = new Set((await runtimeRunRepository.listRuns(sessionId)).map((run) => run.label));
  if (demoRunPresets.every((preset) => existingLabels.has(preset.name))) return;

  globalBootstrap.__routeShiftDemoBootstrap ??= new Map();
  const bootstraps = globalBootstrap.__routeShiftDemoBootstrap;
  const bootstrap = bootstraps.get(sessionId) ?? (async () => {
    const existingLabels = new Set((await runtimeRunRepository.listRuns(sessionId)).map((run) => run.label));
    for (const preset of demoRunPresets) {
      if (!existingLabels.has(preset.name)) {
        await runtimeRunRepository.createRun({ demoId: preset.id, bootstrapId: preset.id }, sessionId);
      }
    }
  })();
  bootstraps.set(sessionId, bootstrap);
  try {
    await bootstrap;
  } finally {
    bootstraps.delete(sessionId);
  }
}

export function runResponse(run: StoredRun) {
  return {
    runId: run.snapshot.runId,
    label: run.label,
    status: run.snapshot.status,
    revision: run.snapshot.revision,
    flowVersion: run.snapshot.flowVersion,
    eventsUrl: `/api/runs/${encodeURIComponent(run.snapshot.runId)}/events`,
    snapshot: run.snapshot,
    flow: run.flow,
  };
}

export async function contextRunId(context: {
  params: Promise<{ runId: string }> | { runId: string };
}) {
  const params = await context.params;
  return params.runId;
}

export async function readJson(request: Request) {
  const limit = 65_536;
  const declaredHeader = request.headers.get('content-length');
  const declaredLength = declaredHeader === null ? 0 : Number(declaredHeader);
  if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > limit) {
    throw new RunInputError('The request body is too large.');
  }
  try {
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        byteLength += value.byteLength;
        if (byteLength > limit) {
          await reader.cancel('RouteShift request body limit exceeded.');
          throw new RunInputError('The request body is too large.');
        }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof RunInputError) throw error;
    throw new RunInputError('The request body must be valid JSON.');
  }
}

export function errorResponse(error: unknown) {
  const status =
    error instanceof RunNotFoundError ||
    error instanceof RunConflictError ||
    error instanceof RunInputError
      ? error.status
      : error instanceof z.ZodError
        ? 400
        : 500;
  const message =
    error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ').slice(0, 1_000)
      : error instanceof Error && status < 500
        ? error.message.slice(0, 1_000)
        : 'The RouteShift runtime could not complete this request.';
  return Response.json({ error: { status, message } }, { status });
}
