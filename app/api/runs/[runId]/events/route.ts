import type { RunEvent } from '@/lib/runtime/contracts';
import { runStore } from '@/lib/runtime/run-store';
import { contextRunId, errorResponse } from '../../_shared';

type Context = { params: Promise<{ runId: string }> | { runId: string } };

const encoder = new TextEncoder();

function eventChunk(event: RunEvent) {
  return encoder.encode(
    `id: ${event.sequence}\nevent: run-event\ndata: ${JSON.stringify(event)}\n\n`,
  );
}

export async function GET(request: Request, context: Context) {
  try {
    const runId = await contextRunId(context);
    runStore.getRun(runId);
    const headerValue = request.headers.get('last-event-id');
    const queryValue = new URL(request.url).searchParams.get('after');
    const requestedSequence = Number(headerValue ?? queryValue ?? 0);
    const after = Number.isSafeInteger(requestedSequence) && requestedSequence >= 0
      ? requestedSequence
      : 0;

    let unsubscribe: () => void = () => {};
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let closed = false;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const close = () => {
          if (closed) return;
          closed = true;
          unsubscribe();
          if (heartbeat) clearInterval(heartbeat);
          try {
            controller.close();
          } catch {
            // The client may already have closed the stream.
          }
        };

        controller.enqueue(encoder.encode(`: connected ${runId} after ${after}\n\n`));
        for (const event of runStore.getEventsAfter(runId, after)) {
          controller.enqueue(eventChunk(event));
        }
        unsubscribe = runStore.subscribe(runId, (event) => {
          if (!closed) controller.enqueue(eventChunk(event));
        });
        heartbeat = setInterval(() => {
          if (!closed) controller.enqueue(encoder.encode(`: heartbeat ${new Date().toISOString()}\n\n`));
        }, 15_000);
        request.signal.addEventListener('abort', close, { once: true });
      },
      cancel() {
        closed = true;
        unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
