import { z } from "zod/v4";
import {
  type Cleanup,
  type GraftComponent,
  type GraftError,
  GraftLoading,
  type MaybePromise,
} from "./types.js";

function isPromise<T>(value: MaybePromise<T>): value is Promise<T> {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as Promise<T>).then === "function"
  );
}

/**
 * Create an isolated instance of a subgraph template.
 *
 * The template is a function that builds and returns a GraftComponent.
 * Each call to subscribe() invokes the template fresh, so any state()
 * or emitter() calls inside produce independent cells/subscriptions.
 *
 * This is the mechanism for local state. Without instantiate(), all
 * usages of a component that contains state() would share the same
 * global cells. With instantiate(), each usage gets its own.
 *
 * The template is lazy — it is not called until subscribe() is called.
 *
 * To get the schema, the template is called once eagerly (at instantiate
 * time) to inspect the returned component's schema. This "probe" instance
 * is not used for subscriptions — each subscribe() creates a fresh one.
 *
 * Example:
 *   const TextInput = () => {
 *     const [Value, setValue] = state({ schema: z.string(), initial: "" });
 *     // ... wire into a View
 *     return InputView;
 *   };
 *
 *   const Name = instantiate(TextInput);   // isolated state
 *   const Email = instantiate(TextInput);  // isolated state
 */
export function instantiate<
  S extends z.ZodObject<z.ZodRawShape>,
  O,
>(template: () => GraftComponent<S, O>): GraftComponent<S, O> {
  // Probe the template once to get schema and outputSchema.
  const probe = template();

  const run = (props: z.infer<S>): MaybePromise<O> => {
    const instance = template();
    return instance.run(props);
  };

  const subscribe = (
    props: z.infer<S>,
    cb: (value: O | typeof GraftLoading | GraftError) => void,
  ): Cleanup => {
    const instance = template();
    return instance.subscribe(props, cb);
  };

  return {
    _tag: "graft-component",
    schema: probe.schema,
    outputSchema: probe.outputSchema,
    statusKeys: probe.statusKeys,
    run,
    subscribe,
  };
}
