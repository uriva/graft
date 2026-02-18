import { z } from "zod/v4";
import {
  type Cleanup,
  type GraftComponent,
  type GraftError,
  graftError,
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
 * Define a graft component from an input schema, output schema, and a function.
 *
 * If the function returns JSX, this is a visual component.
 * If it returns data, this is a data source.
 * The run function may be sync or async — compose handles both.
 */
export function component<
  S extends z.ZodObject<z.ZodRawShape>,
  O,
>({ input, output, run }: {
  input: S;
  output: z.ZodType<O>;
  run: (props: z.infer<S>) => MaybePromise<O>;
}): GraftComponent<S, O> {
  const subscribe = (
    props: z.infer<S>,
    cb: (value: O | typeof GraftLoading | GraftError) => void,
  ): Cleanup => {
    let cancelled = false;
    const result = run(props);
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
    run,
    subscribe,
  };
}
