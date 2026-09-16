# Changelog

All notable changes to ts-workflow-engine-lite will be documented in this file.

## [3.0.0] - 2026-09-16

### Breaking Changes

- **Default storage directory** changed from `.ts-runit-data/` to `.ts-workflow-engine-data/`. Run `npx tsx scripts/migrate-storage-dir.ts` to migrate existing data.
- **`WorkflowEngineV2`** renamed to `WorkflowEngine`. The old name is available as a deprecated alias and will be removed in v5.0.0.
- **Project name** unified to `ts-workflow-engine-lite` across all code, docs, and internal references.

### New Features

- **Pluggable storage adapter registry**: `registerStorageAdapter()`, `createStorageFromRegistry()`, `listStorageAdapters()`. Add custom storage backends without modifying engine internals.
- **Storage interface decomposition**: `StorageCore` (15 required methods) + 7 optional capability interfaces (`MetricsStorage`, `EventHistoryStorage`, `WorkflowMetadataStorage`, `HeartbeatStorage`, `CleanupStorage`, `DlqStorage`, `WebhookStorage`). Custom backends only need `StorageCore`.
- **8 new production examples**:
  - `multi-tenant-workflow.ts` — Tenant-isolated workflows with condition routing
  - `approval-pipeline.ts` — Long-running approval with timeout handling
  - `http-orchestration.ts` — HTTP integration with conditional routing
  - `parallel-fan-out.ts` — Parallel processing with multiple branches
  - `graceful-degradation.ts` — Fallback paths and dead letter queues
  - `headless-engine.ts` — Pure programmatic usage without API
  - `worker-pool.ts` — CPU-intensive tasks with worker threads
  - `cron-data-sync.ts` — Scheduled data synchronization

### Improvements

- All naming unified to `ts-workflow-engine-lite` (Logger Symbol, Schema ID, test tmpdir prefixes, docs, comments)
- Internal Logger Symbol updated to `ts-workflow-engine-lite.logger.exitListener`
- Schema ID updated to `https://ts-workflow-engine.local/workflow.schema.json`
- Test tmpdir prefixes shortened to `tswe-`
- Migration script provided: `scripts/migrate-storage-dir.ts`

### Migration Guide

1. **Storage directory**: Run `npx tsx scripts/migrate-storage-dir.ts` to rename `.ts-runit-data` to `.ts-workflow-engine-data`
2. **Class imports**: Replace `WorkflowEngineV2` with `WorkflowEngine` (old name still works but shows deprecation warning)
3. **Custom storage**: If you implemented `StorageProvider`, no changes needed — the interface is backward compatible. For new implementations, consider implementing only `StorageCore`.

---

## [2.2.0] - 2026-09-15

- Added `join` and `transform` node types
- Added `config.durationMs` / `config.until` for `wait` nodes
- Added `FSYNC_ON_WRITE` for crash-safe persistence
- Added `createWorkflowRouter()` / `createWorkflowRouterBundle()` for host app embedding
- Added named error classes (`WorkflowNotFoundError`, etc.)

## [2.1.0] - 2026-08-xx

- Added default local file persistence
- Added corrupt JSON isolation
- Added terminal instance archiving

## [2.0.0] - 2026-04-xx

- CAS concurrency control, Lease auto-renewal, Heartbeat persistence
- 13 core node types, Signal/Query/Update mechanisms
- EnhancedCronScheduler, full OpenAPI docs
