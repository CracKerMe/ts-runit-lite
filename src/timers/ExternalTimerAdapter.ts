export interface ExternalTimerScheduleRequest {
  timerKey: string;
  instanceId: string;
  nodeId: string;
  workflowId: string;
  eventType: string;
  triggerAt: number;
  payload: Record<string, unknown>;
}

export interface ExternalTimerAdapter {
  name: string;
  schedule(request: ExternalTimerScheduleRequest): Promise<void>;
  cancel?(timerKey: string): Promise<void>;
}

let externalTimerAdapter: ExternalTimerAdapter | null = null;

export function setExternalTimerAdapter(
  adapter: ExternalTimerAdapter | null,
): void {
  externalTimerAdapter = adapter;
}

export function getExternalTimerAdapter(): ExternalTimerAdapter | null {
  return externalTimerAdapter;
}
