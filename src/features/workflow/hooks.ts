/**
 * Integration hooks that other modules fill in. The workflow engine never imports their code.
 *
 * `requestBump` — the `queue_bump` action. The listings/bump background module should call
 * `registerBumpHandler(fn)` once at startup; `fn` receives the request below and should queue a
 * normal (policy-checked, cooldown-respecting) raise. If it emits domain events, it MUST pass
 * `origin: 'workflow'` and `workflowDepth: req.depth` in their payload so workflows ignore them
 * (loop prevention). Without a registered handler the action is reported as skipped.
 */
export interface BumpRequest {
  ruleId: string;
  eventId: string;
  origin: 'workflow';
  depth: number;
  gameId: string | null;
  nodeId: string | null;
}

export type BumpHandler = (req: BumpRequest) => Promise<void> | void;

let bumpHandler: BumpHandler | null = null;

export function registerBumpHandler(handler: BumpHandler | null): void {
  bumpHandler = handler;
}

export function hasBumpHandler(): boolean {
  return bumpHandler !== null;
}

/** Returns false when no module registered a handler. */
export async function requestBump(req: BumpRequest): Promise<boolean> {
  if (!bumpHandler) return false;
  await bumpHandler(req);
  return true;
}

/** Payload marker for events produced (directly or indirectly) by workflow actions. */
export function isWorkflowOrigin(payload: Record<string, unknown>): boolean {
  return (
    payload['origin'] === 'workflow' ||
    (typeof payload['workflowDepth'] === 'number' && payload['workflowDepth'] >= 1)
  );
}
