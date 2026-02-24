import React, { type ReactElement, useEffect, useState } from "react";
import { z } from "zod/v4";
import {
  type Cleanup,
  type GraftComponent,
  type GraftError,
  GraftLoading,
  isSentinel,
  type MaybePromise,
} from "./types.js";

/** Sentinel for "no previous value" in deduplication logic. */
const UNSET: unique symbol = Symbol("UNSET");

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
 * compose({ into, from, key }) — single-wire form:
 *   Wires `from`'s output into `into`'s input named `key`.
 *
 * compose({ into, from: { k1: A, k2: B, ... } }) — multi-wire form:
 *   Wires multiple components into `into` at once. Each key in `from`
 *   names an input of `into`, and its value is the component that provides it.
 *   Equivalent to chaining single-wire compose calls.
 *
 * In both forms, unsatisfied inputs bubble up as the composed component's props.
 *
 * subscribe() propagates reactivity: subscribes to `from`, and whenever
 * `from` emits, re-subscribes to `into` with the new value, forwarding
 * `into`'s emissions to the outer callback.
 *
 * If `from` emits GraftLoading or GraftError, compose short-circuits —
 * it passes the sentinel directly to the outer callback without calling
 * `into`'s run/subscribe.
 */

// Future-edge overload
export function compose<
  S extends z.ZodObject<z.ZodRawShape>,
  K extends string & keyof z.infer<S>,
  O,
>({ into, key, future, initial }: {
  into: GraftComponent<S, O>;
  key: K;
  future: true;
  initial: O;
}): GraftComponent<z.ZodObject<Omit<S["shape"], K>>, O>;

// Multi-wire overload
export function compose<
  SA extends z.ZodObject<z.ZodRawShape>,
  OA,
>({ into, from }: {
  into: GraftComponent<SA, OA>;
  from: Record<string, GraftComponent<z.ZodObject<z.ZodRawShape>, unknown>>;
}): GraftComponent<z.ZodObject<z.ZodRawShape>, OA>;

// Single-wire overload
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
>;

// Implementation
export function compose({ into, from, key, future, initial }: {
  into: GraftComponent<z.ZodObject<z.ZodRawShape>, unknown>;
  from?:
    | GraftComponent<z.ZodObject<z.ZodRawShape>, unknown>
    | Record<string, GraftComponent<z.ZodObject<z.ZodRawShape>, unknown>>;
  key?: string;
  future?: boolean;
  initial?: unknown;
}): GraftComponent<z.ZodObject<z.ZodRawShape>, unknown> {
  // Future-edge form: output feeds back to own input
  if (future) {
    return composeFutureImpl(into, key!, initial);
  }

  // Multi-wire form: from is a Record<string, GraftComponent>
  if (
    !key && typeof from === "object" && from !== null &&
    (from as { _tag?: string })._tag !== "graft-component"
  ) {
    const entries = Object.entries(
      from as Record<
        string,
        GraftComponent<z.ZodObject<z.ZodRawShape>, unknown>
      >,
    );
    if (entries.length === 0) return into;
    let result: GraftComponent<z.ZodObject<z.ZodRawShape>, unknown> = into;
    for (const [k, provider] of entries) {
      result = composeSingle(result, provider, k);
    }
    return result;
  }

  // Single-wire form
  return composeSingle(
    into,
    from as GraftComponent<z.ZodObject<z.ZodRawShape>, unknown>,
    key!,
  );
}

function composeSingle<
  SA extends z.ZodObject<z.ZodRawShape>,
  SB extends z.ZodObject<z.ZodRawShape>,
  OA,
  OB,
>(
  into: GraftComponent<SA, OA>,
  from: GraftComponent<SB, OB>,
  key: string,
): GraftComponent<z.ZodObject<z.ZodRawShape>, OA> {
  // Build the new schema: into's shape minus key, plus from's shape
  const intoShape = { ...into.schema.shape };
  delete (intoShape as Record<string, unknown>)[key];

  // Check for overlapping keys with incompatible types.
  // When both `into` and `from` have a remaining input with the same name,
  // the value is provided once and routed to both sides. This only works
  // if both schemas accept the same type for that key.
  for (const k of Object.keys(from.schema.shape)) {
    if (!(k in intoShape)) continue;
    const intoType = intoShape[k as keyof typeof intoShape];
    const fromType = from.schema.shape[k];
    // Compare the underlying zod type constructors as a fast compatibility check.
    if (
      intoType.constructor !== fromType.constructor ||
      intoType._zod.def.type !== fromType._zod.def.type
    ) {
      throw new Error(
        `compose: overlapping input key "${k}" has incompatible types in ` +
          `"into" and "from". Both components expose "${k}" as a remaining ` +
          `input, but their schemas differ. Rename one to disambiguate.`,
      );
    }
  }

  const newShape = { ...intoShape, ...from.schema.shape };
  const newSchema = z.object(newShape) as z.ZodObject<z.ZodRawShape>;

  const run = (props: z.infer<typeof newSchema>): MaybePromise<OA> => {
    const parsed = newSchema.parse(props) as Record<string, unknown>;
    const { fromInput, buildIntoInput } = splitProps(parsed, into, from, key);

    const fromOutput = from.run(fromInput as z.infer<SB>);

    const runInto = (resolvedFromOutput: OB): MaybePromise<OA> => {
      const validated = from.outputSchema.parse(resolvedFromOutput);
      return into.run(buildIntoInput(validated) as z.infer<SA>);
    };

    if (isPromise(fromOutput)) {
      return fromOutput.then((v) => runInto(v as OB));
    }
    return runInto(fromOutput);
  };

  const subscribe = (
    props: z.infer<typeof newSchema>,
    cb: (value: OA | typeof GraftLoading | GraftError) => void,
  ): Cleanup => {
    const parsed = newSchema.parse(props) as Record<string, unknown>;
    const { fromInput, buildIntoInput } = splitProps(parsed, into, from, key);

    // Track the current inner (into) subscription so we can tear it down
    // when from emits a new value.
    let intoCleanup: Cleanup | null = null;
    let disposed = false;

    // Deduplication: skip re-subscription when from emits the same value.
    let lastFromValue: OB | typeof GraftLoading | GraftError | typeof UNSET =
      UNSET;

    const fromCleanup = from.subscribe(
      fromInput as z.infer<SB>,
      (fromValue: OB | typeof GraftLoading | GraftError) => {
        if (disposed) return;

        // Reference equality dedup — skip if same value as last time.
        if (fromValue === lastFromValue) return;
        lastFromValue = fromValue;

        // Tear down previous into subscription
        if (intoCleanup) intoCleanup();
        intoCleanup = null;

        // If from emitted a sentinel:
        // - If this key is in into's statusKeys, pass it through as the value
        // - Otherwise, short-circuit (don't call into's run/subscribe)
        if (isSentinel(fromValue)) {
          if (!into.statusKeys.has(key)) {
            cb(fromValue);
            return;
          }
          // Pass sentinel as the key's value — into's subscribe handles it
          intoCleanup = into.subscribe(
            buildIntoInput(fromValue as unknown) as z.infer<SA>,
            (intoValue: OA | typeof GraftLoading | GraftError) => {
              if (!disposed) cb(intoValue);
            },
          );
          return;
        }

        // Validate from's output at the boundary
        const validated = from.outputSchema.parse(fromValue);

        // Subscribe to into with the validated from value
        intoCleanup = into.subscribe(
          buildIntoInput(validated) as z.infer<SA>,
          (intoValue: OA | typeof GraftLoading | GraftError) => {
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
    statusKeys: new Set<string>(),
    run,
    subscribe,
  };
}

/**
 * composeFutureImpl — feedback edge implementation.
 *
 * Connects `from`'s output back to its own input named `key`, delayed
 * by one step. The first invocation uses `initial`. Each subsequent
 * invocation uses the output of the previous run.
 *
 * A change in the feedback value does NOT trigger a re-run. Only
 * upstream changes (new props or emitter emissions) cause re-runs.
 * The feedback value is read passively at the start of each invocation.
 * This makes loops impossible by construction.
 *
 * The `key` input is removed from the composed component's schema.
 * `initial` is validated against the output schema at construction time.
 */
function composeFutureImpl<O>(
  from: GraftComponent<z.ZodObject<z.ZodRawShape>, O>,
  key: string,
  initial: unknown,
): GraftComponent<z.ZodObject<z.ZodRawShape>, O> {
  // Validate initial against the output schema.
  from.outputSchema.parse(initial);

  // Build new schema: from's shape minus the feedback key.
  const newShape = { ...from.schema.shape };
  delete (newShape as Record<string, unknown>)[key];
  const newSchema = z.object(newShape) as z.ZodObject<z.ZodRawShape>;

  let acc: O = initial as O;

  const run = (
    props: z.infer<typeof newSchema>,
  ): MaybePromise<O> => {
    const fullProps = { ...props, [key]: acc };
    const result = from.run(fullProps);
    if (isPromise(result)) {
      return result.then((v) => {
        acc = v;
        return v;
      });
    }
    acc = result;
    return result;
  };

  const subscribe = (
    props: z.infer<typeof newSchema>,
    cb: (value: O | typeof GraftLoading | GraftError) => void,
  ): Cleanup => {
    const fullProps = { ...props, [key]: acc };
    return from.subscribe(
      fullProps,
      (value: O | typeof GraftLoading | GraftError) => {
        if (!isSentinel(value)) {
          acc = value;
        }
        cb(value);
      },
    );
  };

  return {
    _tag: "graft-component",
    schema: newSchema,
    outputSchema: from.outputSchema,
    statusKeys: new Set<string>(),
    run,
    subscribe,
  };
}

/**
 * Convert a GraftComponent that returns ReactElement into a real React.FC.
 * This is the boundary between graft and React.
 *
 * Uses subscribe() internally so that reactive emitters automatically
 * cause re-renders. For non-reactive graphs this fires once.
 *
 * GraftLoading and GraftError values are rendered as null.
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
        (value: ReactElement | typeof GraftLoading | GraftError) => {
          if (cancelled) return;
          if (isSentinel(value)) {
            setElement(null);
          } else {
            setElement(value);
          }
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
