const baseUrl = (process.env.ROUTESHIFT_BASE_URL || 'http://localhost:4388').replace(/\/$/, '');
const instruction = 'Validate Bill of Lading against booking before confirming.';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} returned ${response.status}: ${JSON.stringify(body)}`);
  }
  return { response, body };
}

async function post(path, body) {
  return api(path, { method: 'POST', body: JSON.stringify(body) });
}

async function connectEventStream(runId, afterSequence) {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/runs/${encodeURIComponent(runId)}/events`, {
    headers: {
      accept: 'text/event-stream',
      'last-event-id': String(afterSequence),
    },
    signal: controller.signal,
  });
  assert(response.ok && response.body, `Could not connect to the SSE stream for ${runId}.`);

  const events = [];
  const waiters = new Set();
  let buffer = '';
  const decoder = new TextDecoder();
  const reader = response.body.getReader();

  function publish(event) {
    events.push(event);
    for (const waiter of waiters) {
      if (waiter.predicate(event, events)) {
        clearTimeout(waiter.timer);
        waiters.delete(waiter);
        waiter.resolve(event);
      }
    }
  }

  const pump = (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (!frame || frame.startsWith(':')) continue;
          const data = frame
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
          if (data) publish(JSON.parse(data));
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    }
  })();

  return {
    events,
    waitFor(predicate, description, timeoutMs = 10_000) {
      const existing = events.find((event) => predicate(event, events));
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          reject,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            reject(new Error(`Timed out waiting for ${description}.`));
          }, timeoutMs),
        };
        waiters.add(waiter);
      });
    },
    async close() {
      controller.abort();
      await reader.cancel().catch(() => undefined);
      await pump.catch(() => undefined);
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('SSE stream closed before the expected event arrived.'));
      }
      waiters.clear();
    },
  };
}

function comparisonFrom(snapshot) {
  return snapshot.artifacts?.documentComparison?.value;
}

function difference(comparison, field) {
  return comparison?.differences?.find((candidate) => candidate.field === field);
}

async function createRun(body) {
  const created = await post('/api/runs', body);
  assert(created.response.status === 201, 'Run creation did not return HTTP 201.');
  return created.body;
}

async function insertValidation(run) {
  const result = await post(`/api/runs/${encodeURIComponent(run.runId)}/flow`, {
    instruction,
    expectedFlowVersion: run.flowVersion,
  });
  return result.body;
}

async function main() {
  await api('/api/runs').catch((error) => {
    throw new Error(
      `RouteShift is not reachable at ${baseUrl}. Start the local server first, then rerun pnpm verify:trial. ${error.message}`,
    );
  });

  const created = await createRun({ demoId: 'booking-preparation', label: 'Trial by fire A' });
  const runId = created.runId;
  const mutationStream = await connectEventStream(runId, 0);
  await mutationStream.waitFor(
    (event) => event.type === 'run.completed',
    'the complete initial booking-preparation replay',
  );
  const initialEvents = mutationStream.events.filter(
    (event) => event.sequence <= created.snapshot.lastSequence,
  );
  const initialIndex = (type, stepId, artifactId) => initialEvents.findIndex(
    (event) =>
      event.type === type &&
      (!stepId || event.stepId === stepId) &&
      (!artifactId || event.payload?.artifact?.id === artifactId),
  );
  const prepareStarted = initialIndex('step.started', 'prepare-booking');
  const bookingUpserted = initialIndex('artifact.upserted', 'prepare-booking', 'booking');
  const billUpserted = initialIndex('artifact.upserted', 'prepare-booking', 'billOfLading');
  const prepareCompleted = initialIndex('step.completed', 'prepare-booking');
  assert(
    prepareStarted >= 0 &&
      bookingUpserted > prepareStarted &&
      billUpserted > bookingUpserted &&
      prepareCompleted > billUpserted,
    'The replayed SSE stream did not prove prepare started → booking → B/L → prepare completed.',
  );
  const mutated = await insertValidation(created);

  await mutationStream.waitFor(
    (event) => event.type === 'run.awaiting_human',
    'the human pause after dynamic validation',
  );
  assert(mutated.runId === runId, 'Flow mutation changed the runId.');
  assert(mutated.flowVersion === created.flowVersion + 1, 'Flow version did not advance.');
  assert(mutated.snapshot.status === 'awaiting_human', 'Mismatch did not pause for a human.');
  assert(
    mutationStream.events.some(
      (event) => event.sequence > created.snapshot.lastSequence && event.type === 'flow.definition.updated',
    ) &&
      mutationStream.events.some(
        (event) => event.sequence > created.snapshot.lastSequence && event.type === 'step.discovered',
      ) &&
      mutationStream.events.some(
        (event) => event.sequence > created.snapshot.lastSequence && event.type === 'ui.spec.emitted',
      ),
    'SSE did not prove flow change, semantic discovery and UI recompilation.',
  );

  const comparison = comparisonFrom(mutated.snapshot);
  const port = difference(comparison, 'portOfDischarge');
  const weight = difference(comparison, 'grossWeightKg');
  assert(comparison?.matches === false, 'The mismatch fixture unexpectedly matched.');
  assert(comparison?.confidence === 0.98, 'Expected 98% comparison confidence.');
  assert(port?.expected === 'TRISK' && port?.actual === 'TRMER' && port?.blocking === true,
    'Expected blocking TRISK versus TRMER discrepancy.');
  assert(weight?.expected === 18240 && weight?.actual === 19050 && weight?.delta === 810,
    'Expected blocking 18,240 versus 19,050 kg discrepancy with delta 810.');
  assert(Math.abs(weight?.deltaPercent - 4.44) < 0.001, 'Expected a 4.44% weight delta.');
  assert(
    mutated.snapshot.latestUISpec?.sections?.some((section) => section.type === 'document-comparison'),
    'The runtime did not compose a document comparison section.',
  );
  const firstStepId = mutated.mutation.insertedStepId;
  assert(firstStepId.startsWith('step-'), 'The inserted step did not receive a runtime-randomized ID.');
  await mutationStream.close();

  const decision = mutated.snapshot.pendingDecision;
  const actionStream = await connectEventStream(runId, mutated.snapshot.lastSequence);
  const correctedResult = await post(`/api/runs/${encodeURIComponent(runId)}/actions`, {
    decisionId: decision.decisionId,
    actionId: 'request-corrected-document',
    expectedRevision: mutated.revision,
    idempotencyKey: `verify-correction-${crypto.randomUUID()}`,
  });
  assert(correctedResult.response.status === 202, 'Human action did not return HTTP 202.');
  const corrected = correctedResult.body;
  await actionStream.waitFor(
    (event) => event.type === 'step.started' && event.stepId === 'confirm-booking',
    'confirm-booking to begin after correction',
  );
  assert(corrected.runId === runId, 'The human action resumed a different run.');
  assert(comparisonFrom(corrected.snapshot)?.matches === true, 'The corrected B/L did not validate.');
  assert(actionStream.events.some((event) => event.type === 'human.action.received'),
    'SSE did not expose human.action.received.');
  assert(actionStream.events.some((event) => event.type === 'run.resumed'),
    'SSE did not expose run.resumed.');
  await actionStream.close();

  const secondCreated = await createRun({ demoId: 'booking-preparation', label: 'Trial by fire B' });
  const secondMutated = await insertValidation(secondCreated);
  assert(secondMutated.mutation.insertedStepId !== firstStepId,
    'A second live mutation reused the first random step ID.');
  assert(secondMutated.snapshot.status === 'awaiting_human',
    'The second randomized validation did not reproduce the human pause.');

  const airCreated = await createRun({
    demoId: 'booking-preparation',
    label: 'Trial by fire AIR',
    seed: {
      shipment: {
        orderId: 'RS-AIR-001',
        scenarioId: 'EVT-012',
        transportMode: 'AIR',
        origin: 'Frankfurt',
        destination: 'Atlanta',
        disruption: 'NONE',
      },
      booking: {
        bookingNumber: 'AIR-BOOKING',
        portOfLoading: 'FRA',
        portOfDischarge: 'ATL',
      },
      billOfLading: {
        bookingNumber: 'AIR-BOOKING',
        portOfLoading: 'FRA',
        portOfDischarge: 'ATL',
      },
    },
  });
  const airStream = await connectEventStream(airCreated.runId, airCreated.snapshot.lastSequence);
  const airMutated = await insertValidation(airCreated);
  await airStream.waitFor(
    (event) => event.type === 'step.skipped' && event.stepId === airMutated.mutation.insertedStepId,
    'AIR to skip the maritime-only validation',
  );
  assert(airMutated.snapshot.skippedStepIds.includes(airMutated.mutation.insertedStepId),
    'AIR did not record the validation step as skipped.');
  assert(airMutated.snapshot.status === 'completed', 'AIR did not continue safely after the skip.');
  await airStream.close();

  console.log('RouteShift trial by fire: PASS');
  console.log(`Same-run human continuation: ${runId}`);
  console.log(`Flow mutation 1: ${firstStepId}`);
  console.log(`Flow mutation 2: ${secondMutated.mutation.insertedStepId}`);
  console.log('Comparison: TRISK → TRMER; 18,240 kg → 19,050 kg; confidence 98%');
  console.log('Corrected comparison: MATCH; confirm-booking started');
  console.log(`AIR validation: ${airMutated.mutation.insertedStepId} skipped safely`);
}

main().catch((error) => {
  console.error(`RouteShift trial by fire: FAIL\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
