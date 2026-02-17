import { type ReactElement } from "react";
import { z } from "zod/v4";
import type { GraftComponent } from "./types.js";

/**
 * Define a graft component from a zod schema and a render function.
 * The schema declares what props this component needs.
 */
export function component<S extends z.ZodObject<z.ZodRawShape>>(
  schema: S,
  render: (props: z.infer<S>) => ReactElement,
): GraftComponent<S> {
  return { _tag: "graft-component", schema, render };
}
