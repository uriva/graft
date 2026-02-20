import React from "react";
import { z } from "zod/v4";
import { component } from "./component.js";
import { type GraftComponent, View } from "./types.js";

/**
 * Wrap an existing React component as a GraftComponent.
 *
 * Takes a standard React component and a zod schema describing its props,
 * returns a GraftComponent that renders it. This lets you drop any React
 * component into a graft graph without writing the component() boilerplate.
 *
 * @example
 * const GraftDatePicker = fromReact(DatePicker, z.object({ value: z.string() }))
 */
export function fromReact<S extends z.ZodObject<z.ZodRawShape>>(
  Component: React.ComponentType<z.infer<S>>,
  schema: S,
): GraftComponent<S, React.ReactElement> {
  return component({
    input: schema,
    output: View,
    run: (props: z.infer<S>) => <Component {...props} />,
  });
}
