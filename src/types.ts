import { type ReactElement } from "react";
import { z } from "zod/v4";

/** A value that may or may not be a Promise. */
export type MaybePromise<T> = T | Promise<T>;

/** Cleanup function returned by subscribe. */
export type Cleanup = () => void;

/** Sentinel value indicating a value is not yet available. */
export const GraftLoading: unique symbol = Symbol("GraftLoading");

/** Sentinel tag for error values propagating through the graph. */
const GraftErrorTag: unique symbol = Symbol("GraftError");

/** An error value that propagates through the graph instead of throwing. */
export type GraftError = {
  readonly _tag: typeof GraftErrorTag;
  readonly error: unknown;
};

/** Create a GraftError from a caught error. */
export const graftError = (error: unknown): GraftError => ({
  _tag: GraftErrorTag,
  error,
});

/** Check if a value is GraftLoading. */
export const isGraftLoading = (
  value: unknown,
): value is typeof GraftLoading => value === GraftLoading;

/** Check if a value is a GraftError. */
export const isGraftError = (value: unknown): value is GraftError =>
  value !== null && typeof value === "object" && "_tag" in value &&
  (value as GraftError)._tag === GraftErrorTag;

/** Check if a value is a sentinel (GraftLoading or GraftError) that should short-circuit. */
export const isSentinel = (
  value: unknown,
): value is typeof GraftLoading | GraftError =>
  isGraftLoading(value) || isGraftError(value);

/**
 * Widen specific keys of T to include loading/error sentinels.
 * Used by `component({ status: [...] })` to type the `run` function.
 */
export type WithStatus<T, R extends keyof T> = {
  [K in keyof T]: K extends R ? T[K] | typeof GraftLoading | GraftError : T[K];
};

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
 *
 * statusKeys lists input keys that accept loading/error sentinels
 * instead of short-circuiting. For those keys, the run function receives
 * `T | GraftLoading | GraftError` instead of just `T`.
 */
export interface GraftComponent<
  S extends z.ZodObject<z.ZodRawShape>,
  O,
> {
  readonly _tag: "graft-component";
  readonly schema: S;
  readonly outputSchema: z.ZodType<O>;
  readonly statusKeys: ReadonlySet<string>;
  readonly run: (props: z.infer<S>) => MaybePromise<O>;
  readonly subscribe: (
    props: z.infer<S>,
    cb: (value: O | typeof GraftLoading | GraftError) => void,
  ) => Cleanup;
}

/** Output schema for components that return JSX. */
export const View: z.ZodType<ReactElement> = z.custom<ReactElement>(
  () => true,
);
