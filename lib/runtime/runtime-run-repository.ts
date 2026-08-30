import { z } from 'zod';

import hostingConfig from '@/.openai/hosting.json';
import {
  routeRunsBootstrapIndexSql,
  routeRunsSessionIndexSql,
  routeRunsTableSql,
} from '@/db/schema';
import type { FlowMutation, HumanAction, RunEvent } from './contracts';
import {
  InMemoryRunStore,
  RunConflictError,
  RunNotFoundError,
  runStore as memoryRunStore,
  type CreateRunInput,
  type RunListItem,
  type StoredRun,
} from './run-store';
import {
  flowDefinitionSchema,
  runEventSchema,
  runSnapshotSchema,
} from './schemas';

export type RuntimePersistence = 'D1_DURABLE' | 'IN_MEMORY_NON_DURABLE';

type DurableRunRow = {
  run_id: string;
  session_id: string;
  bootstrap_id: string | null;
  label: string;
  flow_json: string;
  snapshot_json: string;
  events_json: string;
  revision: number;
  updated_at: string;
};

type DurableRunListRow = Pick<
  DurableRunRow,
  'run_id' | 'label' | 'snapshot_json' | 'revision' | 'updated_at'
>;

const eventsSchema = z.array(runEventSchema).max(4_096);
let schemaReady: Promise<void> | null = null;

async function resolveDatabase(): Promise<D1Database | null> {
  const explicitLocalFallback = typeof process !== 'undefined'
    && (process.env.ROUTESHIFT_DISABLE_D1 === '1' || process.env.ROUTESHIFT_NODE_PREVIEW === '1');
  if (explicitLocalFallback) return null;
  try {
    const workerRuntime = await import('cloudflare:workers');
    const database = (workerRuntime.env as unknown as { DB?: D1Database }).DB;
    if (database && typeof database.prepare === 'function') return database;
    if (hostingConfig.d1 && typeof process !== 'undefined' && process.env.NODE_ENV === 'production') {
      throw new Error('Durable run storage is configured but unavailable.');
    }
    return null;
  } catch (error) {
    if (hostingConfig.d1 && typeof process !== 'undefined' && process.env.NODE_ENV === 'production') {
      throw new Error('Durable run storage is configured but unavailable.', { cause: error });
    }
    return null;
  }
}

async function prepareDatabase(database: D1Database) {
  schemaReady ??= (async () => {
    await database.prepare(routeRunsTableSql).run();
    await database.prepare(routeRunsSessionIndexSql).run();
    await database.prepare(routeRunsBootstrapIndexSql).run();
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  await schemaReady;
}

function parseStoredRun(row: DurableRunRow): StoredRun {
  const flow = flowDefinitionSchema.parse(JSON.parse(row.flow_json));
  const snapshot = runSnapshotSchema.parse(JSON.parse(row.snapshot_json));
  const events = eventsSchema.parse(JSON.parse(row.events_json)) as RunEvent[];
  if (snapshot.runId !== row.run_id) {
    throw new RunConflictError('The durable run identity does not match its materialized snapshot.');
  }
  return {
    flow,
    snapshot,
    events,
    label: row.label.slice(0, 160),
  };
}

function listItemFromRow(row: DurableRunListRow): RunListItem {
  const snapshot = runSnapshotSchema.parse(JSON.parse(row.snapshot_json));
  return {
    runId: row.run_id,
    label: row.label,
    flowId: snapshot.flowId,
    flowVersion: snapshot.flowVersion,
    status: snapshot.status,
    revision: row.revision,
    currentStepId: snapshot.currentStepId,
    updatedAt: row.updated_at,
  };
}

export class RuntimeRunRepository {
  private readonly localIdempotency = new Map<string, string>();

  constructor(private readonly memory: InMemoryRunStore = memoryRunStore) {}

  async persistence(): Promise<RuntimePersistence> {
    return (await resolveDatabase()) ? 'D1_DURABLE' : 'IN_MEMORY_NON_DURABLE';
  }

  private async database() {
    const database = await resolveDatabase();
    if (database) await prepareDatabase(database);
    return database;
  }

  private async durableRun(
    database: D1Database,
    runId: string,
    sessionId: string,
    forceRestore = false,
  ) {
    const row = await database
      .prepare(
        `SELECT run_id, session_id, bootstrap_id, label, flow_json, snapshot_json, events_json, revision, updated_at
         FROM route_runs
         WHERE run_id = ?1 AND session_id = ?2`,
      )
      .bind(runId, sessionId)
      .first<DurableRunRow>();
    if (!row) throw new RunNotFoundError(`Run ${runId} was not found.`);
    const stored = parseStoredRun(row);
    this.memory.restoreRun(stored, forceRestore);
    return stored;
  }

  private async insertDurable(
    database: D1Database,
    run: StoredRun,
    sessionId: string,
    bootstrapId: string | null,
  ) {
    try {
      await database
      .prepare(
        `INSERT INTO route_runs
         (run_id, session_id, bootstrap_id, label, flow_json, snapshot_json, events_json, revision, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      )
      .bind(
        run.snapshot.runId,
        sessionId,
        bootstrapId,
        run.label,
        JSON.stringify(run.flow),
        JSON.stringify(run.snapshot),
        JSON.stringify(run.events),
        run.snapshot.revision,
        run.snapshot.timestamps.updatedAt,
      )
      .run();
      return run;
    } catch (error) {
      if (!bootstrapId) throw error;
      const existing = await database
        .prepare(
          `SELECT run_id, session_id, bootstrap_id, label, flow_json, snapshot_json, events_json, revision, updated_at
           FROM route_runs
           WHERE session_id = ?1 AND bootstrap_id = ?2`,
        )
        .bind(sessionId, bootstrapId)
        .first<DurableRunRow>();
      if (!existing) throw error;
      const stored = parseStoredRun(existing);
      this.memory.restoreRun(stored, true);
      return stored;
    }
  }

  private async acquireLease(database: D1Database, runId: string, sessionId: string) {
    const owner = `lease-${crypto.randomUUID()}`;
    const now = Date.now();
    const result = await database
      .prepare(
        `UPDATE route_runs
         SET mutation_owner = ?1, mutation_expires_at = ?2
         WHERE run_id = ?3 AND session_id = ?4
           AND (mutation_owner IS NULL OR mutation_expires_at < ?5)`,
      )
      .bind(owner, now + 120_000, runId, sessionId, now)
      .run();
    if ((result.meta.changes ?? 0) !== 1) {
      throw new RunConflictError('This run is already changing in another request. Try again in a moment.');
    }
    return owner;
  }

  private async releaseLease(database: D1Database, runId: string, sessionId: string, owner: string) {
    await database
      .prepare(
        `UPDATE route_runs
         SET mutation_owner = NULL, mutation_expires_at = NULL
         WHERE run_id = ?1 AND session_id = ?2 AND mutation_owner = ?3`,
      )
      .bind(runId, sessionId, owner)
      .run();
  }

  private async updateDurable(
    database: D1Database,
    run: StoredRun,
    sessionId: string,
    expectedRevision: number,
    owner: string,
  ) {
    const result = await database
      .prepare(
        `UPDATE route_runs
         SET label = ?1, flow_json = ?2, snapshot_json = ?3, events_json = ?4,
             revision = ?5, updated_at = ?6, mutation_owner = NULL, mutation_expires_at = NULL
         WHERE run_id = ?7 AND session_id = ?8 AND revision = ?9 AND mutation_owner = ?10`,
      )
      .bind(
        run.label,
        JSON.stringify(run.flow),
        JSON.stringify(run.snapshot),
        JSON.stringify(run.events),
        run.snapshot.revision,
        run.snapshot.timestamps.updatedAt,
        run.snapshot.runId,
        sessionId,
        expectedRevision,
        owner,
      )
      .run();
    if ((result.meta.changes ?? 0) !== 1) {
      throw new RunConflictError('The run changed in another request. Refresh it and try again.');
    }
  }

  async createRun(input: CreateRunInput & { bootstrapId?: string }, sessionId: string) {
    const database = await this.database();
    const localKey = input.bootstrapId ? `${sessionId}:${input.bootstrapId}` : null;
    if (!database && localKey) {
      const existingRunId = this.localIdempotency.get(localKey);
      if (existingRunId) return this.memory.getRun(existingRunId);
    }
    const run = await this.memory.createRun(input);
    if (database) return this.insertDurable(database, run, sessionId, input.bootstrapId ?? null);
    if (localKey) this.localIdempotency.set(localKey, run.snapshot.runId);
    return run;
  }

  async listRuns(sessionId: string) {
    const database = await this.database();
    if (!database) return this.memory.listRuns();
    const result = await database
      .prepare(
        `SELECT run_id, label, snapshot_json, revision, updated_at
         FROM route_runs
         WHERE session_id = ?1
         ORDER BY updated_at DESC
         LIMIT 100`,
      )
      .bind(sessionId)
      .all<DurableRunListRow>();
    return result.results.map(listItemFromRow);
  }

  async getRun(runId: string, sessionId: string) {
    const database = await this.database();
    return database
      ? this.durableRun(database, runId, sessionId)
      : this.memory.getRun(runId);
  }

  async getEventsAfter(runId: string, sequence: number, sessionId: string) {
    const run = await this.getRun(runId, sessionId);
    return run.events
      .filter((event) => event.sequence > Math.max(0, sequence))
      .map((event) => structuredClone(event));
  }

  async subscribe(runId: string, listener: (event: RunEvent) => void) {
    // D1 is the commit authority in hosted execution. The in-memory engine
    // produces candidate events before the conditional D1 update commits, so
    // forwarding its listener here could expose events that later roll back.
    // Hosted streams therefore use ordered D1 polling; local memory keeps the
    // immediate listener for a responsive preview.
    if (await this.database()) return () => {};
    return this.memory.subscribe(runId, listener);
  }

  async mutateFlow(runId: string, mutation: FlowMutation, sessionId: string) {
    const database = await this.database();
    if (!database) return this.memory.mutateFlow(runId, mutation);
    const owner = await this.acquireLease(database, runId, sessionId);
    try {
      const before = await this.durableRun(database, runId, sessionId);
      const run = await this.memory.mutateFlow(runId, mutation);
      await this.updateDurable(database, run, sessionId, before.snapshot.revision, owner);
      return run;
    } catch (error) {
      await this.releaseLease(database, runId, sessionId, owner).catch(() => undefined);
      await this.durableRun(database, runId, sessionId, true).catch(() => undefined);
      throw error;
    }
  }

  async submitAction(runId: string, action: HumanAction, sessionId: string) {
    const database = await this.database();
    if (!database) return this.memory.submitAction(runId, action);
    const owner = await this.acquireLease(database, runId, sessionId);
    try {
      const before = await this.durableRun(database, runId, sessionId);
      const run = await this.memory.submitAction(runId, action);
      await this.updateDurable(database, run, sessionId, before.snapshot.revision, owner);
      return run;
    } catch (error) {
      await this.releaseLease(database, runId, sessionId, owner).catch(() => undefined);
      await this.durableRun(database, runId, sessionId, true).catch(() => undefined);
      throw error;
    }
  }
}

const globalRepository = globalThis as typeof globalThis & {
  __routeShiftRuntimeRepository?: RuntimeRunRepository;
};

export const runtimeRunRepository =
  globalRepository.__routeShiftRuntimeRepository ??
  (globalRepository.__routeShiftRuntimeRepository = new RuntimeRunRepository());
