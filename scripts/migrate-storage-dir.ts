#!/usr/bin/env node

/**
 * Migrates the default storage directory from .ts-runit-data to .ts-workflow-engine-data.
 *
 * Usage:
 *   npx tsx scripts/migrate-storage-dir.ts [old-dir] [new-dir]
 *
 * Defaults:
 *   old-dir = .ts-runit-data
 *   new-dir = .ts-workflow-engine-data
 */

import * as fs from "node:fs";

const oldDir = process.argv[2] || ".ts-runit-data";
const newDir = process.argv[3] || ".ts-workflow-engine-data";

if (!fs.existsSync(oldDir)) {
  console.log(`Old directory "${oldDir}" does not exist. Nothing to migrate.`);
  process.exit(0);
}

if (fs.existsSync(newDir)) {
  console.error(
    `Target directory "${newDir}" already exists. ` +
      `Remove it first or specify a different target.`,
  );
  process.exit(1);
}

console.log(`Migrating ${oldDir} → ${newDir}...`);
fs.renameSync(oldDir, newDir);
console.log("Done. Update STORAGE_DIR in your .env file if you override it.");
