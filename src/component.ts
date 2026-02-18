import { z } from "zod/v4";
import {
  type Cleanup,
  type GraftComponent,
  type GraftError,
  graftError,
  GraftLoading,
  isSentinel,
  type MaybePromise,
  type WithStatus,
} from "./types.js";

function isPromise<T>(value: MaybePromise<T>): value is Promise<T> {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as Promise<T>).then === "function"
  );
}

/**
 * Define a graft component from an input schema, output schema, and a function.
 *
 * If the function returns JSX, this is a visual component.
 * If it returns data, this is a data source.
 * The run function may be sync or async — compose handles both.
 *
 * The optional `status` array lists input keys for which the component
 * wants to receive loading/error sentinels instead of having compose
 * short-circuit. For those keys, `run` receives `T | GraftLoading | GraftError`.
 */
export function component<
  S extends z.ZodObject<z.ZodRawShape>,
  O,
  R extends string & keyof z.infer<S> = never,
>({ input, output, run, status }: {
  input: S;
  output: z.ZodType<O>;
  status?: readonly R[];
  run: (props: WithStatus<z.infer<S>, R>) => MaybePromise<O>;
}): GraftComponent<S, O> {
  const statusSet = new Set<string>(status ?? []);

  const subscribe = (
    props: z.infer<S>,
    cb: (value: O | typeof GraftLoading | GraftError) => void,
  ): Cleanup => {
    // If any non-status key has a sentinel value, short-circuit.
    for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
      if (!statusSet.has(k) && isSentinel(v)) {
        cb(v);
        return () => {};
      }
    }
    let cancelled = false;
    const result = (run as (props: z.infer<S>) => MaybePromise<O>)(props);
    if (isPromise(result)) {
      cb(GraftLoading);
      result.then(
        (v) => {
          if (!cancelled) cb(v);
        },
        (err) => {
          if (!cancelled) cb(graftError(err));
        },
      );
    } else {
      cb(result);
    }
    return () => {
      cancelled = true;
    };
  };

  return {
    _tag: "graft-component",
    schema: input,
    outputSchema: output,
    statusKeys: statusSet,
    run: run as (props: z.infer<S>) => MaybePromise<O>,
    subscribe,
  };
}
