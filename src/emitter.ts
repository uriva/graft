import { z } from "zod/v4";
import {
  type Cleanup,
  type GraftComponent,
  type GraftError,
  GraftLoading,
} from "./types.js";

/**
 * Create a push-based component that emits values over time.
 *
 * This is the only way to introduce reactivity into a graft graph.
 * The `run` function receives an `emit` callback and (optionally) the input props;
 * call it whenever you have a new value. Return a cleanup function to
 * tear down subscriptions / intervals / etc.
 *
 * Before the first emit(), subscribers receive GraftLoading.
 *
 * The input schema is optional — omit it for a zero-input emitter.
 *
 * Example (no inputs):
 *   const Clock = emitter({
 *     output: z.number(),
 *     run: (emit) => {
 *       const id = setInterval(() => emit(Date.now()), 1000);
 *       return () => clearInterval(id);
 *     },
 *   });
 *
 * Example (with inputs):
 *   const PriceFeed = emitter({
 *     input: z.object({ symbol: z.string() }),
 *     output: z.number(),
 *     run: (emit, { symbol }) => {
 *       const ws = new WebSocket(`wss://stream.example.com/${symbol}`);
 *       ws.onmessage = (e) => emit(Number(JSON.parse(e.data).p));
 *       return () => ws.close();
 *     },
 *   });
 */
export function emitter<
  S extends z.ZodObject<z.ZodRawShape>,
  O,
>({ input, output, run }: {
  input?: S;
  output: z.ZodType<O>;
  run: (
    emit: (value: O) => void,
    props: z.infer<S extends undefined ? z.ZodObject<{}> : S>,
  ) => Cleanup;
}): GraftComponent<S extends undefined ? z.ZodObject<{}> : S, O> {
  type Schema = S extends undefined ? z.ZodObject<{}> : S;
  const schema = (input ?? z.object({})) as Schema;

  const subscribe = (
    props: z.infer<Schema>,
    cb: (value: O | typeof GraftLoading | GraftError) => void,
  ): Cleanup => {
    let emitted = false;
    const cleanup = run((value: O) => {
      emitted = true;
      cb(value);
    }, props);
    if (!emitted) cb(GraftLoading);
    return cleanup;
  };

  return {
    _tag: "graft-component",
    schema,
    outputSchema: output,
    run: (props: z.infer<Schema>) => {
      return new Promise<O>((resolve) => {
        const cleanup = run((value: O) => {
          cleanup();
          resolve(value);
        }, props);
      });
    },
    subscribe,
  } as GraftComponent<Schema, O>;
}
