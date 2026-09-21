export type OperationTraceLevel = 'success' | 'error' | 'info';

export interface OperationTraceEntry {
  level: OperationTraceLevel;
  source: string;
  message: string;
  detail?: string;
  operationId?: string;
  phase?: 'start' | 'retry' | 'response' | 'result';
}

export const OPERATION_TRACE_EVENT = 'zhuiyi:operation-trace';

/**
 * Emits a browser-only event so transport helpers can report progress without
 * importing React or coupling themselves to a particular screen.
 */
export const reportOperationTrace = (entry: OperationTraceEntry) => {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new CustomEvent<OperationTraceEntry>(OPERATION_TRACE_EVENT, {
    detail: entry,
  }));
};
