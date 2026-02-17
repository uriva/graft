import "global-jsdom/register";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { render, screen } from "@testing-library/react";
import { z } from "zod/v4";
import { component, compose, toReact, ReactOutput } from "../src/index.js";

describe("component", () => {
  it("creates a GraftComponent with correct tag and schema", () => {
    const schema = z.object({ name: z.string() });
    const gc = component({
      input: schema,
      output: ReactOutput,
      run: (props) => <div>{props.name}</div>,
    });
    assert.equal(gc._tag, "graft-component");
    assert.equal(gc.schema, schema);
  });

  it("run returns a ReactElement", () => {
    const gc = component({
      input: z.object({ x: z.number() }),
      output: ReactOutput,
      run: (props) => <span>{props.x}</span>,
    });
    const el = gc.run({ x: 42 });
    assert.ok(el);
  });

  it("works as a data component (returns a value, not JSX)", () => {
    const gc = component({
      input: z.object({ a: z.number(), b: z.number() }),
      output: z.number(),
      run: ({ a, b }) => a + b,
    });
    assert.equal(gc._tag, "graft-component");
    assert.equal(gc.run({ a: 3, b: 4 }), 7);
  });
});

describe("compose", () => {
  it("wires data component output into visual component prop", () => {
    const Display = component({
      input: z.object({ label: z.string(), sum: z.number() }),
      output: ReactOutput,
      run: (props) => (
        <div>
          {props.label}: {props.sum}
        </div>
      ),
    });

    const Add = component({
      input: z.object({ a: z.number(), b: z.number() }),
      output: z.number(),
      run: ({ a, b }) => a + b,
    });

    // Compose: Add's output feeds into Display's "sum" prop
    const Composed = compose({ into: Display, from: Add, key: "sum" });

    assert.equal(Composed._tag, "graft-component");

    // The composed schema should have: label (from Display), a, b (from Add)
    // "sum" should be removed (it's wired internally)
    const shapeKeys = Object.keys(Composed.schema.shape).sort();
    assert.deepEqual(shapeKeys, ["a", "b", "label"]);
  });

  it("composed component renders correctly via toReact", () => {
    const Display = component({
      input: z.object({ label: z.string(), sum: z.number() }),
      output: ReactOutput,
      run: (props) => (
        <span data-testid="result">
          {props.label}: {props.sum}
        </span>
      ),
    });

    const Add = component({
      input: z.object({ a: z.number(), b: z.number() }),
      output: z.number(),
      run: ({ a, b }) => a + b,
    });

    const Composed = compose({ into: Display, from: Add, key: "sum" });
    const ComposedReact = toReact(Composed);

    render(<ComposedReact label="Total" a={10} b={20} />);
    const el = screen.getByTestId("result");
    assert.equal(el.textContent, "Total: 30");
  });

  it("throws at runtime if a required prop is missing", () => {
    const Display = component({
      input: z.object({ value: z.string() }),
      output: ReactOutput,
      run: (props) => <div>{props.value}</div>,
    });

    const Upper = component({
      input: z.object({ text: z.string() }),
      output: z.string(),
      run: ({ text }) => text.toUpperCase(),
    });

    const Composed = compose({ into: Display, from: Upper, key: "value" });
    const ComposedReact = toReact(Composed);

    assert.throws(() => {
      render(<ComposedReact />);
    });
  });

  it("chained compose works (three-level composition)", () => {
    const C = component({
      input: z.object({ msg: z.string() }),
      output: ReactOutput,
      run: (props) => <p data-testid="msg">{props.msg}</p>,
    });

    const B = component({
      input: z.object({ greeting: z.string(), name: z.string() }),
      output: z.string(),
      run: ({ greeting, name }) => `${greeting}, ${name}!`,
    });

    const A = component({
      input: z.object({ prefix: z.string() }),
      output: z.string(),
      run: ({ prefix }) => `${prefix} says`,
    });

    // First compose: B feeds into C's "msg"
    // Result needs: { greeting, name }
    const Step1 = compose({ into: C, from: B, key: "msg" });
    assert.deepEqual(
      Object.keys(Step1.schema.shape).sort(),
      ["greeting", "name"],
    );

    // Second compose: A feeds into Step1's "greeting"
    // Result needs: { prefix, name }
    const Step2 = compose({ into: Step1, from: A, key: "greeting" });
    assert.deepEqual(Object.keys(Step2.schema.shape).sort(), [
      "name",
      "prefix",
    ]);

    const Final = toReact(Step2);
    render(<Final prefix="Alice" name="Bob" />);
    assert.equal(screen.getByTestId("msg").textContent, "Alice says, Bob!");
  });

  it("handles shared parameter names between components", () => {
    const A = component({
      input: z.object({ x: z.string(), result: z.number() }),
      output: ReactOutput,
      run: (props) => (
        <span data-testid="out">
          {props.x}-{props.result}
        </span>
      ),
    });

    const B = component({
      input: z.object({ x: z.number() }),
      output: z.number(),
      run: ({ x }) => x * 2,
    });

    // Compose: B feeds into A's "result"
    // Both have "x" — B's x (number) overwrites A's x (string) in the merged shape
    const Composed = compose({ into: A, from: B, key: "result" });
    const shapeKeys = Object.keys(Composed.schema.shape).sort();
    assert.deepEqual(shapeKeys, ["x"]);
  });
});

describe("toReact", () => {
  it("converts a component to React.FC", () => {
    const gc = component({
      input: z.object({ who: z.string() }),
      output: ReactOutput,
      run: (props) => <h1 data-testid="hello">Hello {props.who}</h1>,
    });

    const Hello = toReact(gc);
    render(<Hello who="World" />);
    assert.equal(screen.getByTestId("hello").textContent, "Hello World");
  });

  it("validates props and throws on invalid input", () => {
    const gc = component({
      input: z.object({ count: z.number() }),
      output: ReactOutput,
      run: (props) => <span>{props.count}</span>,
    });

    const Counter = toReact(gc);

    assert.throws(() => {
      // @ts-expect-error — intentionally passing wrong type
      render(<Counter count="not a number" />);
    });
  });
});
