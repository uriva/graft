import { z } from "zod/v4";
import type { GraftComponent } from "./types.js";

/**
 * Define a graft component from an input schema, output schema, and a function.
 *
 * If the function returns JSX, this is a visual component.
 * If it returns data, this is a data source.
 * compose() treats them the same.
 */
export function component<
  S extends z.ZodObject<z.ZodRawShape>,
  O,
>({ input, output, run }: {
  input: S;
  output: z.ZodType<O>;
  run: (props: z.infer<S>) => O;
}): GraftComponent<S, O> {
  return { _tag: "graft-component", schema: input, outputSchema: output, run };
}
