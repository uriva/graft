import "global-jsdom/register";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React, { type ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { z } from "zod/v4";
import { component, compose, toReact } from "../src/index.js";

// Helper: z.custom for ReactElement (no runtime validation needed for JSX)
const reactElement = z.custom<ReactElement>(() => true);

describe("component", () => {
  it("creates a GraftComponent with correct tag and schema", () => {
    const schema = z.object({ name: z.string() });
    const gc = component(schema, reactElement, (props) => (
      <div>{props.name}</div>
    ));
    assert.equal(gc._tag, "graft-component");
    assert.equal(gc.schema, schema);
  });

  it("run returns a ReactElement", () => {
    const gc = component(z.object({ x: z.number() }), reactElement, (props) => (
      <span>{props.x}</span>
    ));
    const el = gc.run({ x: 42 });
    assert.ok(el);
  });

  it("works as a data component (returns a value, not JSX)", () => {
    const gc = component(
      z.object({ a: z.number(), b: z.number() }),
      z.number(),
      ({ a, b }) => a + b,
    );
    assert.equal(gc._tag, "graft-component");
    assert.equal(gc.run({ a: 3, b: 4 }), 7);
  });
});

describe("compose", () => {
  it("wires data component output into visual component prop", () => {
    const Display = component(
      z.object({ label: z.string(), sum: z.number() }),
      reactElement,
      (props) => (
        <div>
          {props.label}: {props.sum}
        </div>
      ),
    );

    const Add = component(
      z.object({ a: z.number(), b: z.number() }),
      z.number(),
      ({ a, b }) => a + b,
    );

    // Compose: Add's output feeds into Display's "sum" prop
    const Composed = compose(Display, Add, "sum");

    assert.equal(Composed._tag, "graft-component");

    // The composed schema should have: label (from Display), a, b (from Add)
    // "sum" should be removed (it's wired internally)
    const shapeKeys = Object.keys(Composed.schema.shape).sort();
    assert.deepEqual(shapeKeys, ["a", "b", "label"]);
  });

  it("composed component renders correctly via toReact", () => {
    const Display = component(
      z.object({ label: z.string(), sum: z.number() }),
      reactElement,
      (props) => (
        <span data-testid="result">
          {props.label}: {props.sum}
        </span>
      ),
    );

    const Add = component(
      z.object({ a: z.number(), b: z.number() }),
      z.number(),
      ({ a, b }) => a + b,
    );

    const Composed = compose(Display, Add, "sum");
    const ComposedReact = toReact(Composed);

    render(<ComposedReact label="Total" a={10} b={20} />);
    const el = screen.getByTestId("result");
    assert.equal(el.textContent, "Total: 30");
  });

  it("throws at runtime if a required prop is missing", () => {
    const Display = component(
      z.object({ value: z.string() }),
      reactElement,
      (props) => <div>{props.value}</div>,
    );

    const Upper = component(
      z.object({ text: z.string() }),
      z.string(),
      ({ text }) => text.toUpperCase(),
    );

    const Composed = compose(Display, Upper, "value");
    const ComposedReact = toReact(Composed);

    assert.throws(() => {
      render(<ComposedReact />);
    });
  });

  it("chained compose works (three-level composition)", () => {
    const C = component(
      z.object({ msg: z.string() }),
      reactElement,
      (props) => <p data-testid="msg">{props.msg}</p>,
    );

    const B = component(
      z.object({ greeting: z.string(), name: z.string() }),
      z.string(),
      ({ greeting, name }) => `${greeting}, ${name}!`,
    );

    const A = component(
      z.object({ prefix: z.string() }),
      z.string(),
      ({ prefix }) => `${prefix} says`,
    );

    // First compose: B feeds into C's "msg"
    // Result needs: { greeting, name }
    const Step1 = compose(C, B, "msg");
    assert.deepEqual(
      Object.keys(Step1.schema.shape).sort(),
      ["greeting", "name"],
    );

    // Second compose: A feeds into Step1's "greeting"
    // Result needs: { prefix, name }
    const Step2 = compose(Step1, A, "greeting");
    assert.deepEqual(Object.keys(Step2.schema.shape).sort(), [
      "name",
      "prefix",
    ]);

    const Final = toReact(Step2);
    render(<Final prefix="Alice" name="Bob" />);
    assert.equal(screen.getByTestId("msg").textContent, "Alice says, Bob!");
  });

  it("handles shared parameter names between components", () => {
    const A = component(
      z.object({ x: z.string(), result: z.number() }),
      reactElement,
      (props) => (
        <span data-testid="out">
          {props.x}-{props.result}
        </span>
      ),
    );

    const B = component(
      z.object({ x: z.number() }),
      z.number(),
      ({ x }) => x * 2,
    );

    // Compose: B feeds into A's "result"
    // Both have "x" — B's x (number) overwrites A's x (string) in the merged shape
    const Composed = compose(A, B, "result");
    const shapeKeys = Object.keys(Composed.schema.shape).sort();
    assert.deepEqual(shapeKeys, ["x"]);
  });
});

describe("toReact", () => {
  it("converts a component to React.FC", () => {
    const gc = component(
      z.object({ who: z.string() }),
      reactElement,
      (props) => <h1 data-testid="hello">Hello {props.who}</h1>,
    );

    const Hello = toReact(gc);
    render(<Hello who="World" />);
    assert.equal(screen.getByTestId("hello").textContent, "Hello World");
  });

  it("validates props and throws on invalid input", () => {
    const gc = component(
      z.object({ count: z.number() }),
      reactElement,
      (props) => <span>{props.count}</span>,
    );

    const Counter = toReact(gc);

    assert.throws(() => {
      // @ts-expect-error — intentionally passing wrong type
      render(<Counter count="not a number" />);
    });
  });
});
