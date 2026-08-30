import type { RunEvent } from '@/lib/runtime/contracts';
import { runtimeRunRepository } from '@/lib/runtime/runtime-run-repository';
import { contextRunId, errorResponse } from '../../_shared';
import { attachRuntimeSession, runtimeSession } from '../../_session';

type Context = { params: Promise<{ runId: string }> | { runId: string } };

const encoder = new TextEncoder();

function eventChunk(event: RunEvent) {
  return encoder.encode(
    `id: ${event.sequence}\nevent: run-event\ndata: ${JSON.stringify(event)}\n\n`,
  );
}

export async function GET(request: Request, context: Context) {
  const session = runtimeSession(request);
  try {
    const runId = await contextRunId(context);
    await runtimeRunRepository.getRun(runId, session.sessionId);
    const headerValue = request.headers.get('last-event-id');
    const queryValue = new URL(request.url).searchParams.get('after');
    const requestedSequence = Number(headerValue ?? queryValue ?? 0);
    const after = Number.isSafeInteger(requestedSequence) && requestedSequence >= 0
      ? requestedSequence
      : 0;

    let unsubscribe: () => void = () => {};
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let durablePoll: ReturnType<typeof setInterval> | undefined;
    let closed = false;
    let sentThrough = after;
    let polling = false;
    let consecutivePollFailures = 0;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const close = () => {
          if (closed) return;
          closed = true;
          unsubscribe();
          if (heartbeat) clearInterval(heartbeat);
          if (durablePoll) clearInterval(durablePoll);
          try {
            controller.close();
          } catch {
            // The client may already have closed the stream.
          }
        };

        const send = (event: RunEvent) => {
          if (closed || event.sequence <= sentThrough) return;
          sentThrough = event.sequence;
          controller.enqueue(eventChunk(event));
        };

        controller.enqueue(encoder.encode(`retry: 1500\n: connected ${runId} after ${after}\n\n`));
        const queued: RunEvent[] = [];
        let replaying = true;
        unsubscribe = await runtimeRunRepository.subscribe(runId, (event) => {
          if (replaying) queued.push(event);
          else send(event);
        });
        for (const event of await runtimeRunRepository.getEventsAfter(runId, after, session.sessionId)) {
          send(event);
        }
        replaying = false;
        for (const event of queued.sort((left, right) => left.sequence - right.sequence)) send(event);

        durablePoll = setInterval(() => {
          if (closed || polling) return;
          polling = true;
          void runtimeRunRepository.getEventsAfter(runId, sentThrough, session.sessionId)
            .then((events) => {
              consecutivePollFailures = 0;
              for (const event of events) send(event);
            })
            .catch(() => {
              if (closed) return;
              consecutivePollFailures += 1;
              if (consecutivePollFailures >= 3) {
                close();
                return;
              }
              controller.enqueue(encoder.encode(': durable replay temporarily unavailable\n\n'));
            })
            .finally(() => {
              polling = false;
            });
        }, 1_000);
        heartbeat = setInterval(() => {
          if (!closed) controller.enqueue(encoder.encode(`: heartbeat ${new Date().toISOString()}\n\n`));
        }, 15_000);
        request.signal.addEventListener('abort', close, { once: true });
      },
      cancel() {
        closed = true;
        unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
        if (durablePoll) clearInterval(durablePoll);
      },
    });

    return attachRuntimeSession(new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    }), session.setCookie);
  } catch (error) {
    return attachRuntimeSession(errorResponse(error), session.setCookie);
  }
}
