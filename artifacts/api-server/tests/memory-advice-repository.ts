import type { DemoState } from "../src/lib/receivables/model";
import type { AdviceRepository } from "../src/lib/receivables/ai-coordination";
import { assertSnapshotsAppendOnly } from "../src/lib/receivables/advice-snapshots";

// One shared transactional store, multiple independently created repositories.
// Every commit is serialized and rollback restores the complete aggregate.
export function sharedMemoryStore(initial: DemoState, clock = Date.now) {
  let state = structuredClone(initial);
  let queue = Promise.resolve();
  return {
    repository(): AdviceRepository {
      return {
        workspaceId: initial.workspaceId,
        async readState() { await queue; return structuredClone(state); },
        async changeState<T>(operation: (state: DemoState, nowMs?: number) => T): Promise<T> {
          const run = queue.then(() => {
            const draft = structuredClone(state);
            const result = operation(draft, clock());
            assertSnapshotsAppendOnly(state.adviceSnapshots ?? [], draft.adviceSnapshots ?? []);
            state = structuredClone(draft);
            return structuredClone(result);
          });
          queue = run.then(() => {}, () => {});
          return run;
        },
      };
    },
  };
}
