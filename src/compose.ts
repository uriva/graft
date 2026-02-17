import React, { type ReactElement } from "react";
import { z } from "zod/v4";
import type { GraftComponent } from "./types.js";

/**
 * compose(A, B, key):
 *   - A is a component with inputs SA that produces OA
 *   - B is a component with inputs SB that produces OB
 *   - key is an input name of A whose type matches OB
 *   - Result: a component whose inputs are SA minus key, plus SB,
 *     and whose output is OA
 *
 * B's output feeds into A[key], remaining params bubble up.
 */
export function compose<
  SA extends z.ZodObject<z.ZodRawShape>,
  SB extends z.ZodObject<z.ZodRawShape>,
  K extends string & keyof z.infer<SA>,
  OA,
  OB,
>(
  a: GraftComponent<SA, OA>,
  b: GraftComponent<SB, OB>,
  key: K,
): GraftComponent<
  z.ZodObject<Omit<SA["shape"], K> & SB["shape"]>,
  OA
> {
  // Build the new schema: A's shape minus key, plus B's shape
  const aShape = { ...a.schema.shape };
  delete (aShape as Record<string, unknown>)[key];
  const newShape = { ...aShape, ...b.schema.shape };
  const newSchema = z.object(newShape) as z.ZodObject<
    Omit<SA["shape"], K> & SB["shape"]
  >;

  const run = (props: z.infer<typeof newSchema>): OA => {
    // Validate all incoming props at runtime
    const parsed = newSchema.parse(props) as Record<string, unknown>;

    // Split: B's inputs from the combined props
    const bInput: Record<string, unknown> = {};
    for (const bKey of Object.keys(b.schema.shape)) {
      bInput[bKey] = parsed[bKey];
    }

    // Run B to get the value for key
    const bOutput = b.run(bInput as z.infer<SB>);

    // Assemble A's full inputs: everything except B-only keys, plus key=bOutput
    const aInput: Record<string, unknown> = { [key]: bOutput };
    for (const aKey of Object.keys(a.schema.shape)) {
      if (aKey === key) continue;
      if (aKey in parsed) aInput[aKey] = parsed[aKey];
    }

    return a.run(aInput as z.infer<SA>);
  };

  return {
    _tag: "graft-component",
    schema: newSchema,
    outputSchema: a.outputSchema,
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
