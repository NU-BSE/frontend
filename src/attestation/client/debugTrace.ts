import type { ClassifierTrace } from '@attestation/shared/wire';

let lastTrace: ClassifierTrace | null = null;
const subscribers = new Set<(trace: ClassifierTrace | null) => void>();

export const setLastClassifierTrace = (
  trace: ClassifierTrace | undefined,
): void => {
  if (!trace) return;
  lastTrace = trace;
  subscribers.forEach((subscriber) => subscriber(lastTrace));
};

export const getLastClassifierTrace = (): ClassifierTrace | null => lastTrace;

export const subscribeClassifierTrace = (
  subscriber: (trace: ClassifierTrace | null) => void,
): (() => void) => {
  subscribers.add(subscriber);
  subscriber(lastTrace);
  return () => {
    subscribers.delete(subscriber);
  };
};
