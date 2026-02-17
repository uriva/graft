import { z } from "zod/v4";

/**
 * A graft component: a typed function from inputs (schema S) to output O.
 *
 * When O is ReactElement, this is a visual component.
 * When O is something else (number, string, object...), this is a data source.
 * compose() doesn't care — it just wires outputs into inputs.
 * toReact() requires O to be ReactElement.
 */
export interface GraftComponent<
  S extends z.ZodObject<z.ZodRawShape>,
  O,
> {
  readonly _tag: "graft-component";
  readonly schema: S;
  readonly outputSchema: z.ZodType<O>;
  readonly run: (props: z.infer<S>) => O;
}
