import { z } from "zod/v4";
import type { Cleanup, GraftComponent } from "./types.js";

/**
 * Create a push-based data source with no inputs that emits values over time.
 *
 * This is the only way to introduce reactivity into a graft graph.
 * The `run` function receives an `emit` callback; call it whenever
 * you have a new value. Return a cleanup function to tear down
 * subscriptions / intervals / etc.
 *
 * Example:
 *   const Clock = source({
 *     output: z.number(),
 *     run: (emit) => {
 *       const id = setInterval(() => emit(Date.now()), 1000);
 *       return () => clearInterval(id);
 *     },
 *   });
 */
export function source<O>({ output, run }: {
  output: z.ZodType<O>;
  run: (emit: (value: O) => void) => Cleanup;
}): GraftComponent<z.ZodObject<{}>, O> {
  const emptySchema = z.object({}) as z.ZodObject<{}>;

  const subscribe = (_props: z.infer<typeof emptySchema>, cb: (value: O) => void): Cleanup => {
    return run(cb);
  };

  return {
    _tag: "graft-component",
    schema: emptySchema,
    outputSchema: output,
    // run() returns the first emitted value (useful for non-reactive contexts).
    // For true reactivity, use subscribe().
    run: (_props?: z.infer<typeof emptySchema>) => {
      return new Promise<O>((resolve) => {
        const cleanup = run((value: O) => {
          cleanup();
          resolve(value);
        });
      });
    },
    subscribe,
  };
}
