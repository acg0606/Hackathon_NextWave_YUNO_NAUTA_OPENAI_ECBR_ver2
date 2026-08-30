import { describe, expect, it } from 'vitest';

import { scenarios } from '@/app/scenarios';
import {
  assertPublicEventSafe,
  sanitizePublicEvent,
} from '@/lib/runtime/public-events';
import { isSafeEvidenceUrl } from '@/lib/runtime/safe-url';
import {
  jsonObjectSchema,
  provenanceSchema,
  runEventSchema,
  runtimeArtifactSchema,
  safeHttpsUrlSchema,
  stepDefinitionSchema,
} from '@/lib/runtime/schemas';
import {
  fixedNow,
  makeEvent,
  makeStep,
} from '@/tests/fixtures/runtime-fixtures';

describe('runtime security boundary', () => {
  it('removes private reasoning keys from public events', () => {
    const sanitized = sanitizePublicEvent(
      makeEvent(1, 'agent.summary.updated', {
        summary: 'Compared two transport documents.',
        chainOfThought: 'private reasoning',
        nested: { reasoning: 'also private', confidence: 0.98 },
      }),
    );
    const rendered = JSON.stringify(sanitized);
    expect(rendered).not.toContain('private reasoning');
    expect(rendered).not.toContain('also private');
    expect(rendered).toContain('0.98');
    expect(() => assertPublicEventSafe(sanitized)).not.toThrow();
  });

  it('rejects unsafe URL protocols and credentials', () => {
    expect(() => safeHttpsUrlSchema.parse('javascript:alert(1)')).toThrow();
    expect(() =>
      safeHttpsUrlSchema.parse('https://user:secret@nasa.gov/data'),
    ).toThrow();
    expect(() => safeHttpsUrlSchema.parse('https:evil.com')).toThrow();
    expect(() =>
      safeHttpsUrlSchema.parse(String.raw`http:\\evil.com`),
    ).toThrow();
    expect(() =>
      safeHttpsUrlSchema.parse('https://nasa.gov:444/evidence'),
    ).toThrow();
    expect(isSafeEvidenceUrl('https:evil.com')).toBe(false);
    expect(isSafeEvidenceUrl(String.raw`http:\\evil.com`)).toBe(false);
  });

  it('rejects non-allowlisted evidence hosts', () => {
    expect(() =>
      safeHttpsUrlSchema.parse('https://attacker.invalid/source'),
    ).toThrow(/allowlisted/i);
  });

  it('rejects arbitrary HTTP URLs in runtime JSON and tool parameters', () => {
    expect(() =>
      jsonObjectSchema.parse({
        endpoint: 'https://www.nasa.gov/hidden-tool-endpoint',
      }),
    ).toThrow(/bounded JSON/i);
    expect(() =>
      jsonObjectSchema.parse({
        sourceUrl: 'https://attacker.invalid/evidence',
      }),
    ).toThrow(/bounded JSON/i);
    expect(() =>
      jsonObjectSchema.parse({ sourceUrl: 'https:evil.com' }),
    ).toThrow(/bounded JSON/i);
    expect(() =>
      jsonObjectSchema.parse({ sourceUrl: String.raw`http:\\evil.com` }),
    ).toThrow(/bounded JSON/i);
    expect(() =>
      stepDefinitionSchema.parse({
        ...makeStep(),
        tool: {
          id: 'mock.document.compare',
          parameters: { callbackUrl: 'http://attacker.invalid/callback' },
        },
      }),
    ).toThrow(/bounded JSON/i);
  });

  it('keeps curated sourceUrl evidence valid through the dedicated URL boundary', () => {
    for (const scenario of scenarios) {
      expect(safeHttpsUrlSchema.parse(scenario.sourceUrl)).toBe(
        scenario.sourceUrl,
      );
      expect(jsonObjectSchema.parse({ sourceUrl: scenario.sourceUrl })).toEqual(
        {
          sourceUrl: scenario.sourceUrl,
        },
      );
      expect(provenanceSchema.parse({
        classification: 'HISTORICAL_FACT',
        sourceTitle: scenario.sourceLabel,
        sourceUrl: scenario.sourceUrl,
        eventDate: scenario.eventStartDate,
      }).eventDate).toBe(scenario.eventStartDate);
    }

    const artifact = runtimeArtifactSchema.parse({
      id: 'historical-evidence',
      kind: 'historical-evidence',
      value: { summary: 'Curated operational evidence' },
      truth: 'HISTORICAL_FACT',
      provenance: {
        classification: 'HISTORICAL_FACT',
        sourceTitle: 'Maersk operational update',
        sourceUrl:
          'https://www.maersk.com/news/articles/2023/02/06/operational-impact-of-earthquake-in-turkey',
        publicationDate: '2023-02-06',
        eventDate: '2023-02-06',
        retrievedAt: fixedNow,
        confidence: 0.98,
      },
      revision: 1,
      updatedAt: fixedNow,
    });
    expect(
      runEventSchema.parse(
        makeEvent(1, 'artifact.upserted', {
          artifact,
        }),
      ).payload,
    ).toHaveProperty('artifact.provenance.sourceUrl');
  });
});
