import { z } from "zod/v4";
import { GraftLoading, type Cleanup, type GraftError, type GraftComponent } from "./types.js";

/**
 * Create a global mutable state cell.
 *
 * Returns a tuple: [Component, setter].
 * - Component is a source-like GraftComponent (no inputs) that emits
 *   the current value whenever the setter is called.
 * - setter is a plain function you can call from anywhere.
 *
 * Example:
 *   const [CurrentUser, setCurrentUser] = state({
 *     schema: z.string(),
 *     initial: "anonymous",
 *   });
 *
 *   setCurrentUser("alice"); // every subscriber re-runs
 */
export function state<O>({ schema, initial }: {
  schema: z.ZodType<O>;
  initial: O;
}): [GraftComponent<z.ZodObject<{}>, O>, (value: O) => void] {
  let current: O = initial;
  const listeners = new Set<(value: O | typeof GraftLoading | GraftError) => void>();

  const setter = (value: O) => {
    current = value;
    for (const cb of listeners) {
      cb(current);
    }
  };

  const emptySchema = z.object({}) as z.ZodObject<{}>;

  const subscribe = (
    _props: z.infer<typeof emptySchema>,
    cb: (value: O | typeof GraftLoading | GraftError) => void,
  ): Cleanup => {
    listeners.add(cb);
    // Immediately emit the current value so subscribers don't start empty.
    cb(current);
    return () => {
      listeners.delete(cb);
    };
  };

  const gc: GraftComponent<z.ZodObject<{}>, O> = {
    _tag: "graft-component",
    schema: emptySchema,
    outputSchema: schema,
    run: () => current,
    subscribe,
  };

  return [gc, setter];
}
