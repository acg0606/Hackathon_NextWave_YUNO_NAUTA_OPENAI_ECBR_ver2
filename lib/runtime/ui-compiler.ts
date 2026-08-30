import type {
  FlowDefinition,
  JsonObject,
  JsonValue,
  RunSnapshot,
  RuntimeArtifact,
  RuntimeUISection,
  RuntimeUISpec,
  StepCapability,
  StepDefinition,
  TruthClassification,
} from './contracts';
import {
  flowDefinitionSchema,
  runSnapshotSchema,
  runtimeUISpecSchema,
} from './schemas';

function asObject(value: JsonValue | undefined): JsonObject | undefined {
  if (
    value === null ||
    value === undefined ||
    Array.isArray(value) ||
    typeof value !== 'object'
  ) {
    return undefined;
  }
  return value;
}

function normalizedKind(artifact: RuntimeArtifact): string {
  return artifact.kind.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function artifactByShape(
  snapshot: RunSnapshot,
  kindFragments: readonly string[],
): RuntimeArtifact | undefined {
  const normalizedFragments = kindFragments.map((fragment) =>
    fragment.toLowerCase().replace(/[^a-z0-9]/g, ''),
  );
  return Object.values(snapshot.artifacts).find((artifact) => {
    const kind = normalizedKind(artifact);
    return normalizedFragments.some((fragment) => kind.includes(fragment));
  });
}

function artifactData(artifact: RuntimeArtifact | undefined): JsonObject {
  if (!artifact) return { available: false };
  const object = asObject(artifact.value);
  return {
    available: true,
    artifactId: artifact.id,
    kind: artifact.kind,
    truth: artifact.truth,
    value: object ?? artifact.value,
  };
}

function humanizeField(field: string): string {
  return field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (letter) => letter.toUpperCase());
}

function documentPresentation(artifact: RuntimeArtifact): {
  title: string;
  summary: string;
} {
  const kind = normalizedKind(artifact);
  const value = asObject(artifact.value);
  if (kind.includes('billoflading') || kind.includes('lading')) {
    const billNumber =
      typeof value?.billNumber === 'string' ? value.billNumber : artifact.id;
    return {
      title: 'Bill of Lading',
      summary: `Carrier document ${billNumber}`,
    };
  }
  if (kind.includes('booking')) {
    const bookingNumber =
      typeof value?.bookingNumber === 'string'
        ? value.bookingNumber
        : artifact.id;
    return {
      title: 'Booking',
      summary: `Booking ${bookingNumber}`,
    };
  }
  return {
    title: humanizeField(artifact.kind),
    summary: `Prepared artifact ${artifact.id}`,
  };
}

function fieldRows(value: JsonValue | undefined): JsonValue[] {
  const object = asObject(value);
  if (!object) return value === undefined ? [] : [{ label: 'Value', value }];
  return Object.entries(object)
    .slice(0, 24)
    .map(([field, fieldValue]) => ({
      field,
      label: humanizeField(field),
      value: fieldValue,
    }));
}

function shallowEqual(
  left: JsonValue | undefined,
  right: JsonValue | undefined,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function comparisonData(snapshot: RunSnapshot): JsonObject {
  const expectedArtifact = artifactByShape(snapshot, ['booking']);
  const actualArtifact = artifactByShape(snapshot, [
    'bill-of-lading',
    'billoflading',
    'lading',
  ]);
  const expected = asObject(expectedArtifact?.value) ?? {};
  const actual = asObject(actualArtifact?.value) ?? {};
  const comparison = artifactByShape(snapshot, [
    'document-comparison',
    'comparison',
  ]);
  const comparisonValue = comparison ? asObject(comparison.value) : undefined;
  if (comparisonValue) {
    return {
      artifactId: comparison?.id ?? 'comparison',
      expectedDocument: artifactData(expectedArtifact),
      actualDocument: artifactData(actualArtifact),
      expected: comparisonValue.expected ?? expected,
      actual: comparisonValue.actual ?? actual,
      rows: comparisonValue.rows ?? comparisonValue.differences ?? [],
      matches: comparisonValue.matches ?? false,
      confidence: comparisonValue.confidence ?? null,
      recommendedAction: comparisonValue.recommendedAction ?? null,
      publicSummary:
        comparisonValue.publicSummary ??
        snapshot.publicAgentSummary?.summary ??
        null,
    };
  }

  const fields = [
    ...new Set([...Object.keys(expected), ...Object.keys(actual)]),
  ].slice(0, 32);
  const rows: JsonValue[] = fields.map((field) => ({
    field,
    label: humanizeField(field),
    expected: expected[field] ?? null,
    actual: actual[field] ?? null,
    matches: shallowEqual(expected[field], actual[field]),
  }));
  return {
    expectedDocument: artifactData(expectedArtifact),
    actualDocument: artifactData(actualArtifact),
    expected,
    actual,
    rows,
    matches:
      Boolean(expectedArtifact && actualArtifact) &&
      rows.every((row) => asObject(row)?.matches === true),
  };
}

function documentEvidenceData(snapshot: RunSnapshot): JsonObject {
  const documents = [
    {
      artifact: artifactByShape(snapshot, ['booking']),
      title: 'Booking summary',
      summary:
        'Expected commercial and transport fields used as the validation baseline.',
    },
    {
      artifact: artifactByShape(snapshot, [
        'bill-of-lading',
        'billoflading',
        'lading',
      ]),
      title: 'Bill of Lading summary',
      summary: 'Actual carrier document compared against the booking.',
    },
  ];
  const items: JsonValue[] = documents.map(({ artifact, title, summary }) => ({
    title,
    summary,
    ...artifactData(artifact),
    classification: artifact?.truth ?? 'UNKNOWN',
    ...(artifact?.provenance?.sourceTitle
      ? { sourceTitle: artifact.provenance.sourceTitle }
      : {}),
    ...(artifact?.provenance?.sourceUrl
      ? { sourceUrl: artifact.provenance.sourceUrl }
      : {}),
    ...(artifact?.provenance?.eventDate
      ? { eventDate: artifact.provenance.eventDate }
      : {}),
  }));
  if (snapshot.publicAgentSummary) {
    const providerLabel = snapshot.publicAgentSummary.providerMode === 'live'
      ? `Ari · OpenAI structured observation${snapshot.publicAgentSummary.model ? ` · ${snapshot.publicAgentSummary.model}` : ''}`
      : 'Ari · deterministic safe fallback';
    items.unshift({
      title: providerLabel,
      summary: snapshot.publicAgentSummary.summary,
      evidence: snapshot.publicAgentSummary.evidence,
      providerId: snapshot.publicAgentSummary.providerId ?? 'unknown',
      providerMode: snapshot.publicAgentSummary.providerMode ?? 'deterministic_fallback',
      ...(snapshot.publicAgentSummary.confidence !== undefined
        ? { confidence: snapshot.publicAgentSummary.confidence }
        : {}),
      ...(snapshot.publicAgentSummary.selectedAction
        ? { selectedAction: snapshot.publicAgentSummary.selectedAction }
        : {}),
    });
  }
  return { items };
}

function discrepancyData(
  snapshot: RunSnapshot,
  comparison: JsonObject,
): JsonObject {
  const declaredRows = comparison.rows;
  const mismatchRows = Array.isArray(declaredRows)
    ? declaredRows.filter((row) => asObject(row)?.matches === false)
    : [];
  const blockingFindings = snapshot.findings
    .filter((finding) => finding.severity === 'blocking')
    .map((finding) => ({
      id: finding.id,
      title: finding.title,
      summary: finding.summary,
      confidence: finding.confidence ?? null,
      details: finding.details ?? {},
      truth: finding.truth,
    }));
  return {
    items: blockingFindings.length > 0 ? blockingFindings : mismatchRows,
    blocking: blockingFindings.length > 0 || mismatchRows.length > 0,
  };
}

function routeData(snapshot: RunSnapshot): JsonObject {
  const route = artifactByShape(snapshot, ['route', 'shipment']);
  const value = asObject(route?.value) ?? {};
  return {
    artifactId: route?.id ?? null,
    origin: value.origin ?? null,
    destination: value.destination ?? null,
    waypoints: value.waypoints ?? value.route ?? [],
    event: value.event ?? value.disruption ?? null,
    state: value.state ?? snapshot.status,
    editable: false,
    truth: route?.truth ?? 'UNKNOWN',
  };
}

function progressData(flow: FlowDefinition, snapshot: RunSnapshot): JsonObject {
  return {
    items: flow.steps.map((step) => ({
      stepId: step.id,
      title: step.title,
      owner: step.owner,
      status: snapshot.completedStepIds.includes(step.id)
        ? 'completed'
        : snapshot.skippedStepIds.includes(step.id)
          ? 'skipped'
          : snapshot.currentStepId === step.id
            ? snapshot.status
            : 'pending',
    })),
    currentStepId: snapshot.currentStepId,
    revision: snapshot.revision,
  };
}

function evidenceData(snapshot: RunSnapshot): JsonObject {
  return {
    items: snapshot.findings.map((finding) => ({
      id: finding.id,
      kind: finding.kind,
      severity: finding.severity,
      title: finding.title,
      summary: finding.summary,
      confidence: finding.confidence ?? null,
      truth: finding.truth,
      details: finding.details ?? {},
    })),
    agentSummary: snapshot.publicAgentSummary?.summary ?? null,
    agentEvidence: snapshot.publicAgentSummary?.evidence ?? [],
    agentProvider: snapshot.publicAgentSummary?.providerId ?? 'unknown',
    agentProviderMode: snapshot.publicAgentSummary?.providerMode ?? 'deterministic_fallback',
    agentModel: snapshot.publicAgentSummary?.model ?? null,
  };
}

function truthContext(snapshot: RunSnapshot): TruthClassification[] {
  const classifications = new Set<TruthClassification>();
  for (const artifact of Object.values(snapshot.artifacts))
    classifications.add(artifact.truth);
  for (const finding of snapshot.findings) classifications.add(finding.truth);
  for (const connector of Object.values(snapshot.connectorStates))
    classifications.add(connector.truth);
  if (classifications.size === 0) classifications.add('UNKNOWN');
  return [...classifications];
}

function section(
  step: StepDefinition | undefined,
  type: RuntimeUISection['type'],
  title: string,
  data: JsonObject,
  truth?: TruthClassification,
): RuntimeUISection {
  return {
    id: `${step?.id ?? 'run'}:${type}`,
    type,
    title,
    ...(truth ? { truth } : {}),
    data,
  };
}

function sectionsForCapability(
  capability: StepCapability,
  step: StepDefinition,
  flow: FlowDefinition,
  snapshot: RunSnapshot,
): RuntimeUISection[] {
  switch (capability) {
    case 'route.view':
      return [section(step, 'route-map', 'Current route', routeData(snapshot))];
    case 'booking.view': {
      const artifact = artifactByShape(snapshot, ['booking']);
      return [
        section(
          step,
          'booking',
          'Booking',
          {
            ...artifactData(artifact),
            fields: fieldRows(artifact?.value),
          },
          artifact?.truth,
        ),
      ];
    }
    case 'container.track': {
      const artifact = artifactByShape(snapshot, ['container']);
      const liveTransport = artifactByShape(snapshot, ['live-transport-context']);
      const nauta = Object.values(snapshot.connectorStates).find((connector) =>
        connector.connectorId.toLowerCase().includes('nauta'),
      );
      const fallbackValue = nauta?.data;
      return [
        section(
          step,
          'container',
          'Container tracking',
          {
            ...(artifact
              ? artifactData(artifact)
              : {
                  available: Boolean(nauta && nauta.status !== 'unavailable' && nauta.status !== 'failed'),
                  connectorId: nauta?.connectorId ?? 'mock.nauta',
                  connectorStatus: nauta?.status ?? 'unavailable',
                  truth: nauta?.truth ?? 'UNKNOWN',
                  value: fallbackValue ?? {},
                }),
            fields: fieldRows(artifact?.value ?? fallbackValue),
            liveContext: artifactData(liveTransport),
          },
          artifact?.truth ?? nauta?.truth,
        ),
      ];
    }
    case 'document.view': {
      if (step.capabilities.includes('document.compare')) return [];
      const documents = Object.values(snapshot.artifacts)
        .filter((artifact) => {
          const kind = normalizedKind(artifact);
          return (
            kind.includes('document') ||
            kind.includes('booking') ||
            kind.includes('billoflading') ||
            kind.includes('lading')
          );
        })
        .map((artifact) => ({
          ...artifactData(artifact),
          ...documentPresentation(artifact),
          classification: artifact.truth,
        }));
      return [section(step, 'evidence', 'Documents', { items: documents })];
    }
    case 'document.compare': {
      const comparison = comparisonData(snapshot);
      const confidence =
        typeof comparison.confidence === 'number'
          ? comparison.confidence
          : (snapshot.publicAgentSummary?.confidence ?? null);
      return [
        section(step, 'document-comparison', 'Document comparison', comparison),
        section(
          step,
          'evidence',
          'Document summaries, provenance and Ari explanation',
          documentEvidenceData(snapshot),
          'MOCK_CONNECTOR',
        ),
        section(
          step,
          'discrepancy',
          'Discrepancies',
          discrepancyData(snapshot, comparison),
        ),
        section(step, 'confidence', 'Agent confidence', { value: confidence }),
      ];
    }
    case 'incident.explain':
      return [
        section(step, 'alert', 'Operational disruption', {
          summary: snapshot.publicAgentSummary?.summary ?? step.description,
          details: snapshot.findings.map((finding) => finding.summary),
        }),
        section(
          step,
          'evidence',
          'Evidence and provenance',
          evidenceData(snapshot),
        ),
      ];
    case 'quote.view': {
      const artifact = artifactByShape(snapshot, ['quote', 'requote']);
      const paymentLink = artifactByShape(snapshot, ['payment-link', 'paymentlink']);
      const yuno = Object.values(snapshot.connectorStates).find((connector) =>
        connector.connectorId.toLowerCase().includes('yuno'),
      );
      return [
        section(
          step,
          'quote',
          'Commercial quote',
          {
            ...artifactData(artifact),
            fields: fieldRows(artifact?.value),
            payment: paymentLink
              ? artifactData(paymentLink)
              : yuno
                ? {
                    available: yuno.status === 'available',
                    connectorId: yuno.connectorId,
                    status: yuno.status,
                    truth: yuno.truth,
                    value: yuno.data ?? {},
                  }
                : { available: false, status: 'not-requested' },
          },
          artifact?.truth,
        ),
      ];
    }
    case 'refund.view': {
      const artifact = artifactByShape(snapshot, ['refund', 'reversal']);
      return [
        section(
          step,
          'refund',
          'Refund and reversal',
          {
            ...artifactData(artifact),
            fields: fieldRows(artifact?.value),
          },
          artifact?.truth,
        ),
      ];
    }
    case 'decision.request': {
      const decision = snapshot.pendingDecision;
      return [
        section(step, 'decision', decision?.title ?? 'Human decision', {
          decisionId: decision?.decisionId ?? null,
          explanation: decision?.explanation ?? step.description,
          expectedRevision: decision?.expectedRevision ?? snapshot.revision,
          options:
            decision?.actions.map((action) => ({
              actionId: action.actionId,
              label: action.label,
              intent: action.intent,
              requiresConfirmation: action.requiresConfirmation ?? false,
              inputSchema: action.inputSchema ?? {},
            })) ?? [],
        }),
      ];
    }
    case 'notification.view': {
      const artifact = artifactByShape(snapshot, ['notification']);
      return [
        section(
          step,
          'action-result',
          'Notification',
          {
            summary: snapshot.publicAgentSummary?.summary ?? step.description,
            details: artifactData(artifact),
          },
          artifact?.truth,
        ),
      ];
    }
    case 'delivery.confirm': {
      const artifact = artifactByShape(snapshot, ['delivery', 'receipt']);
      return [
        section(
          step,
          'action-result',
          'Delivery confirmation',
          {
            summary: snapshot.publicAgentSummary?.summary ?? step.description,
            details: artifactData(artifact),
          },
          artifact?.truth,
        ),
      ];
    }
    case 'audit.view':
      return [
        section(step, 'event-feed', 'Public run events', {
          lastSequence: snapshot.lastSequence,
          revision: snapshot.revision,
          completedStepIds: snapshot.completedStepIds,
          skippedStepIds: snapshot.skippedStepIds,
        }),
        section(
          step,
          'progress',
          'Flow progress',
          progressData(flow, snapshot),
        ),
      ];
  }
}

function genericSection(
  step: StepDefinition | undefined,
  flow: FlowDefinition,
  snapshot: RunSnapshot,
): RuntimeUISection {
  const inputs: JsonObject = {};
  for (const [name, reference] of Object.entries(step?.inputRefs ?? {})) {
    const artifactId = reference.startsWith('artifacts.')
      ? reference.slice('artifacts.'.length)
      : '';
    inputs[name] =
      artifactId && snapshot.artifacts[artifactId]
        ? snapshot.artifacts[artifactId].value
        : { reference, available: false };
  }
  return section(step, 'generic-step', step?.title ?? 'Run state', {
    stepId: step?.id ?? snapshot.currentStepId,
    description: step?.description ?? flow.description,
    kind: step?.kind ?? 'generic',
    owner: step?.owner ?? 'system',
    status: snapshot.status,
    inputs,
    outputs: Object.values(snapshot.artifacts).map((artifact) =>
      artifactData(artifact),
    ),
    findings: snapshot.findings.map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      summary: finding.summary,
      truth: finding.truth,
    })),
  });
}

export function compileRuntimeUI(
  flow: FlowDefinition,
  snapshot: RunSnapshot,
  options: { revision?: number } = {},
): RuntimeUISpec {
  const validatedFlow = flowDefinitionSchema.parse(flow) as FlowDefinition;
  const validatedSnapshot = runSnapshotSchema.parse(snapshot) as RunSnapshot;
  if (validatedSnapshot.flowId !== validatedFlow.id) {
    throw new Error(
      'Cannot compile UI from a flow and snapshot with different flow IDs',
    );
  }
  if (validatedSnapshot.flowVersion !== validatedFlow.version) {
    throw new Error('Cannot compile UI from mismatched flow versions');
  }

  const presentationStepId =
    validatedSnapshot.currentStepId ?? validatedSnapshot.completedStepIds.at(-1);
  const activeStep = presentationStepId
    ? validatedFlow.steps.find((step) => step.id === presentationStepId)
    : undefined;

  const compiledSections = activeStep
    ? activeStep.capabilities.flatMap((capability) =>
        sectionsForCapability(
          capability,
          activeStep,
          validatedFlow,
          validatedSnapshot,
        ),
      )
    : presentationStepId
      ? [genericSection(undefined, validatedFlow, validatedSnapshot)]
      : [
          section(
            undefined,
            'progress',
            'Flow progress',
            progressData(validatedFlow, validatedSnapshot),
          ),
        ];

  const deduplicatedSections = compiledSections.filter(
    (candidate, index, sections) =>
      sections.findIndex((item) => item.type === candidate.type) === index,
  );
  if (deduplicatedSections.length === 0) {
    deduplicatedSections.push(
      genericSection(activeStep, validatedFlow, validatedSnapshot),
    );
  }

  const hasBlockingFinding = validatedSnapshot.findings.some(
    (finding) => finding.severity === 'blocking',
  );
  const ownership = validatedSnapshot.pendingDecision
    ? 'human'
    : (activeStep?.owner ?? 'system');

  return runtimeUISpecSchema.parse({
    schemaVersion: '1.0',
    runId: validatedSnapshot.runId,
    revision: options.revision ?? validatedSnapshot.revision,
    flowVersion: validatedSnapshot.flowVersion,
    layout:
      activeStep?.presentation?.layout ??
      (activeStep?.capabilities.includes('document.compare') ||
      validatedSnapshot.pendingDecision
        ? 'split'
        : activeStep?.capabilities.includes('delivery.confirm')
          ? 'receipt'
          : activeStep?.capabilities.includes('audit.view')
            ? 'timeline'
            : 'focus'),
    priority:
      activeStep?.presentation?.priority ??
      (hasBlockingFinding
        ? 'critical'
        : validatedSnapshot.pendingDecision
          ? 'high'
          : 'normal'),
    ownership,
    focusTarget: deduplicatedSections[0]?.id,
    truthContext: truthContext(validatedSnapshot),
    sections: deduplicatedSections,
    allowedActions: validatedSnapshot.pendingDecision?.actions ?? [],
  }) as RuntimeUISpec;
}
