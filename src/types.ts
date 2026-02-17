import { type ReactElement } from "react";
import { z } from "zod/v4";

/** A value that may or may not be a Promise. */
export type MaybePromise<T> = T | Promise<T>;

/** Cleanup function returned by subscribe. */
export type Cleanup = () => void;

/**
 * A graft component: a typed function from inputs (schema S) to output O.
 *
 * When O is ReactElement, this is a visual component.
 * When O is something else (number, string, object...), this is a data source.
 * compose() doesn't care — it just wires outputs into inputs.
 * toReact() requires O to be ReactElement.
 *
 * The run function may return O or Promise<O>. When any component in a
 * composed graph is async, the entire graph becomes async.
 *
 * subscribe() is the reactive primitive: it calls the callback whenever
 * the output changes. For regular components this fires once. For graphs
 * containing sources, it fires whenever a source emits.
 */
export interface GraftComponent<
  S extends z.ZodObject<z.ZodRawShape>,
  O,
> {
  readonly _tag: "graft-component";
  readonly schema: S;
  readonly outputSchema: z.ZodType<O>;
  readonly run: (props: z.infer<S>) => MaybePromise<O>;
  readonly subscribe: (props: z.infer<S>, cb: (value: O) => void) => Cleanup;
}

/** Output schema for components that return JSX. */
export const View: z.ZodType<ReactElement> = z.custom<ReactElement>(
  () => true,
);
