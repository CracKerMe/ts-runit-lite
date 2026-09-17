/**
 * @deprecated This module has moved to `./StickyExecutionPolicy`. Import
 * `StickyExecutionPolicy` (class) and `stickyExecutionPolicy` (singleton)
 * instead. This re-export will be removed in a future major version.
 */
export {
  StickyExecutionPolicy as StickyExecutionManager,
  stickyExecutionPolicy as stickyExecutionManager,
  type StickyOptions,
  type StickyWorker,
} from "./StickyExecutionPolicy";
