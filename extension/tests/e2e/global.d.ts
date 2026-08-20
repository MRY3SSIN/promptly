import type { DriftReport } from './harness/index';

declare global {
  interface Window {
    __forge: {
      start(): void;
      stop(): void;
      baseline(): void;
      reset(): void;
      report(): DriftReport;
      setText(text: string): void;
      drive(on: boolean): void;
    };
  }
}

export {};
