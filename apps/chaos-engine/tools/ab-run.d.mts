// Types du déroulé A/B (ab-run.mjs), pour les tests de Studio écrits en TypeScript.
export interface AbApi {
  get(path: string): Promise<{ status: number; body: any }>;
  post(path: string, body: unknown): Promise<{ status: number; body: any }>;
}
export interface AbResult {
  done: number;
  results: { effect: string; at: string }[];
  failed: null | ({ effect: string; reason: string } & Record<string, unknown>);
  clean: boolean;
}
export declare const AB_PLAN: string[];
export declare const AB_PHASES: {
  reference_s: number;
  effect_s: number;
  after_s: number;
};
export declare function abRun(
  api: AbApi,
  o?: {
    plan?: string[];
    phases?: { reference_s: number; effect_s: number; after_s: number };
    pollMs?: number;
    readyMs?: number;
    mark?: (step: string) => void;
    note?: (o: Record<string, unknown>) => void;
    say?: (text: string) => void;
    shouldStop?: () => boolean;
  },
): Promise<AbResult>;
