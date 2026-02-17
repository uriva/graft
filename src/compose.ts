import React, { type ReactElement, useState, useEffect } from "react";
import { z } from "zod/v4";
import type { Cleanup, GraftComponent, MaybePromise } from "./types.js";

function isPromise<T>(value: MaybePromise<T>): value is Promise<T> {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as Promise<T>).then === "function"
  );
}

/**
 * Helper: split combined props into from's inputs and into's remaining inputs.
 */
function splitProps<
  SA extends z.ZodObject<z.ZodRawShape>,
  SB extends z.ZodObject<z.ZodRawShape>,
  K extends string,
>(
  parsed: Record<string, unknown>,
  into: GraftComponent<SA, unknown>,
  from: GraftComponent<SB, unknown>,
  key: K,
) {
  const fromInput: Record<string, unknown> = {};
  for (const fromKey of Object.keys(from.schema.shape)) {
    fromInput[fromKey] = parsed[fromKey];
  }
  const buildIntoInput = (fromOutput: unknown) => {
    const intoInput: Record<string, unknown> = { [key]: fromOutput };
    for (const intoKey of Object.keys(into.schema.shape)) {
      if (intoKey === key) continue;
      if (intoKey in parsed) intoInput[intoKey] = parsed[intoKey];
    }
    return intoInput;
  };
  return { fromInput, buildIntoInput };
}

/**
 * compose({ into, from, key }):
 *   - into: a component with inputs SA that produces OA
 *   - from: a component with inputs SB that produces OB
 *   - key: an input name of `into` whose type matches OB
 *   - Result: a component whose inputs are SA minus key, plus SB,
 *     and whose output is OA
 *
 * If either `from` or `into` is async, the composed run is async.
 * `from`'s output feeds into `into[key]`, remaining params bubble up.
 *
 * subscribe() propagates reactivity: subscribes to `from`, and whenever
 * `from` emits, re-subscribes to `into` with the new value, forwarding
 * `into`'s emissions to the outer callback.
 */
export function compose<
  SA extends z.ZodObject<z.ZodRawShape>,
  SB extends z.ZodObject<z.ZodRawShape>,
  K extends string & keyof z.infer<SA>,
  OA,
  OB,
>({ into, from, key }: {
  into: GraftComponent<SA, OA>;
  from: GraftComponent<SB, OB>;
  key: K;
}): GraftComponent<
  z.ZodObject<Omit<SA["shape"], K> & SB["shape"]>,
  OA
> {
  // Build the new schema: into's shape minus key, plus from's shape
  const intoShape = { ...into.schema.shape };
  delete (intoShape as Record<string, unknown>)[key];
  const newShape = { ...intoShape, ...from.schema.shape };
  const newSchema = z.object(newShape) as z.ZodObject<
    Omit<SA["shape"], K> & SB["shape"]
  >;

  const run = (props: z.infer<typeof newSchema>): MaybePromise<OA> => {
    const parsed = newSchema.parse(props) as Record<string, unknown>;
    const { fromInput, buildIntoInput } = splitProps(parsed, into, from, key);

    const fromOutput = from.run(fromInput as z.infer<SB>);

    const runInto = (resolvedFromOutput: OB): MaybePromise<OA> => {
      return into.run(buildIntoInput(resolvedFromOutput) as z.infer<SA>);
    };

    if (isPromise(fromOutput)) {
      return fromOutput.then((v) => runInto(v as OB));
    }
    return runInto(fromOutput);
  };

  const subscribe = (
    props: z.infer<typeof newSchema>,
    cb: (value: OA) => void,
  ): Cleanup => {
    const parsed = newSchema.parse(props) as Record<string, unknown>;
    const { fromInput, buildIntoInput } = splitProps(parsed, into, from, key);

    // Track the current inner (into) subscription so we can tear it down
    // when from emits a new value.
    let intoCleanup: Cleanup | null = null;
    let disposed = false;

    const fromCleanup = from.subscribe(
      fromInput as z.infer<SB>,
      (fromValue: OB) => {
        if (disposed) return;
        // Tear down previous into subscription
        if (intoCleanup) intoCleanup();
        // Subscribe to into with the new from value
        intoCleanup = into.subscribe(
          buildIntoInput(fromValue) as z.infer<SA>,
          (intoValue: OA) => {
            if (!disposed) cb(intoValue);
          },
        );
      },
    );

    return () => {
      disposed = true;
      fromCleanup();
      if (intoCleanup) intoCleanup();
    };
  };

  return {
    _tag: "graft-component",
    schema: newSchema,
    outputSchema: into.outputSchema,
    run,
    subscribe,
  };
}

/**
 * Convert a GraftComponent that returns ReactElement into a real React.FC.
 * This is the boundary between graft and React.
 *
 * Uses subscribe() internally so that reactive sources automatically
 * cause re-renders. For non-reactive graphs this fires once.
 */
export function toReact<S extends z.ZodObject<z.ZodRawShape>>(
  gc: GraftComponent<S, ReactElement>,
): React.FC<z.infer<S>> {
  const ReactComponent: React.FC<z.infer<S>> = (props: z.infer<S>) => {
    const [element, setElement] = useState<ReactElement | null>(null);

    useEffect(() => {
      let cancelled = false;

      const cleanup = gc.subscribe(
        gc.schema.parse(props),
        (value: ReactElement) => {
          if (!cancelled) setElement(value);
        },
      );

      return () => {
        cancelled = true;
        cleanup();
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gc, ...Object.values(props as Record<string, unknown>)]);

    return element;
  };
  ReactComponent.displayName = "GraftComponent";
  return ReactComponent;
}
