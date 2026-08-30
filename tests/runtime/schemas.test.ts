import { describe, expect, it } from 'vitest';

import {
  flowDefinitionSchema,
  flowMutationSchema,
  runtimeUISpecSchema,
  stepDefinitionSchema,
} from '@/lib/runtime/schemas';
import { makeFlow, makeStep } from '@/tests/fixtures/runtime-fixtures';

describe('runtime schemas', () => {
  it('accepts a bounded semantic flow', () => {
    expect(flowDefinitionSchema.parse(makeFlow()).id).toBe('test-flow');
  });

  it('rejects duplicate step IDs', () => {
    const flow = makeFlow();
    flow.steps.push({ ...flow.steps[0] });
    expect(() => flowDefinitionSchema.parse(flow)).toThrow(/unique/i);
  });

  it('rejects an unregistered tool', () => {
    expect(() =>
      stepDefinitionSchema.parse({
        ...makeStep(),
        tool: { id: 'shell.execute' },
      }),
    ).toThrow();
  });

  it('rejects executable markup inside UI data', () => {
    expect(() =>
      runtimeUISpecSchema.parse({
        schemaVersion: '1.0',
        runId: 'run-test-001',
        revision: 1,
        flowVersion: 1,
        layout: 'focus',
        priority: 'normal',
        ownership: 'agent',
        truthContext: ['SIMULATED_IF_TODAY'],
        sections: [
          {
            id: 'unsafe',
            type: 'generic-step',
            data: { content: '<script>steal()</script>' },
          },
        ],
        allowedActions: [],
      }),
    ).toThrow(/bounded JSON|executable/i);
  });

  it('accepts and normalizes a position bounded by after and before anchors', () => {
    const parsed = flowMutationSchema.parse({
      schemaVersion: '1.0',
      operation: 'insert-step',
      expectedFlowVersion: 1,
      step: { ...makeStep(), id: 'inserted-validation' },
      position: {
        after: 'prepare-booking',
        before: 'confirm-booking',
      },
    });

    expect(parsed.position).toEqual({
      afterStepId: 'prepare-booking',
      beforeStepId: 'confirm-booking',
    });
  });
});
