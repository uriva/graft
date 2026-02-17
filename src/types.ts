import { type ReactElement } from "react";
import { z } from "zod/v4";

// A graft component: knows its props schema and its render function.
// The schema is the source of truth for both runtime validation and types.
export interface GraftComponent<
  S extends z.ZodObject<z.ZodRawShape>,
> {
  readonly _tag: "graft-component";
  readonly schema: S;
  readonly render: (props: z.infer<S>) => ReactElement;
}

// A graft provider: a function that takes some inputs and produces an output.
// Used as the "B" in compose(A, B, key) — B's output feeds into A's key param.
export interface GraftProvider<
  S extends z.ZodObject<z.ZodRawShape>,
  O,
> {
  readonly _tag: "graft-provider";
  readonly schema: S;
  readonly outputSchema: z.ZodType<O>;
  readonly run: (inputs: z.infer<S>) => O;
}
