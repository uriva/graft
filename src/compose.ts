import React, { type ReactElement } from "react";
import { z } from "zod/v4";
import type { GraftComponent } from "./types.js";

/**
 * compose({ into, from, key }):
 *   - into: a component with inputs SA that produces OA
 *   - from: a component with inputs SB that produces OB
 *   - key: an input name of `into` whose type matches OB
 *   - Result: a component whose inputs are SA minus key, plus SB,
 *     and whose output is OA
 *
 * `from`'s output feeds into `into[key]`, remaining params bubble up.
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

  const run = (props: z.infer<typeof newSchema>): OA => {
    // Validate all incoming props at runtime
    const parsed = newSchema.parse(props) as Record<string, unknown>;

    // Split: from's inputs from the combined props
    const fromInput: Record<string, unknown> = {};
    for (const fromKey of Object.keys(from.schema.shape)) {
      fromInput[fromKey] = parsed[fromKey];
    }

    // Run from to get the value for key
    const fromOutput = from.run(fromInput as z.infer<SB>);

    // Assemble into's full inputs: everything except from-only keys, plus key=fromOutput
    const intoInput: Record<string, unknown> = { [key]: fromOutput };
    for (const intoKey of Object.keys(into.schema.shape)) {
      if (intoKey === key) continue;
      if (intoKey in parsed) intoInput[intoKey] = parsed[intoKey];
    }

    return into.run(intoInput as z.infer<SA>);
  };

  return {
    _tag: "graft-component",
    schema: newSchema,
    outputSchema: into.outputSchema,
    run,
  };
}

/**
 * Convert a GraftComponent that returns ReactElement into a real React.FC.
 * This is the boundary between graft and React.
 * Validates props at runtime — throws if anything is missing.
 */
export function toReact<S extends z.ZodObject<z.ZodRawShape>>(
  gc: GraftComponent<S, ReactElement>,
): React.FC<z.infer<S>> {
  const ReactComponent: React.FC<z.infer<S>> = (props: z.infer<S>) => {
    // Runtime validation — throws ZodError if props are wrong
    const validated = gc.schema.parse(props);
    return gc.run(validated);
  };
  ReactComponent.displayName = "GraftComponent";
  return ReactComponent;
}
