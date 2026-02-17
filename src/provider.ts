import { z } from "zod/v4";
import type { GraftProvider } from "./types.js";

/**
 * Define a graft provider: takes inputs (defined by schema) and produces an output.
 * The output schema validates what this provider returns.
 */
export function provider<
  S extends z.ZodObject<z.ZodRawShape>,
  O,
>(
  inputSchema: S,
  outputSchema: z.ZodType<O>,
  run: (inputs: z.infer<S>) => O,
): GraftProvider<S, O> {
  return { _tag: "graft-provider", schema: inputSchema, outputSchema, run };
}
