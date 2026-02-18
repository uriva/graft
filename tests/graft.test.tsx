import "global-jsdom/register";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { render, screen } from "@testing-library/react";
import { z } from "zod/v4";
import { component, compose, GraftLoading, instantiate, isGraftError, source, state, toReact, View } from "../src/index.js";
import { isSentinel, graftError } from "../src/types.js";

describe("component", () => {
  it("creates a GraftComponent with correct tag and schema", () => {
    const schema = z.object({ name: z.string() });
    const gc = component({
      input: schema,
      output: View,
      run: (props) => <div>{props.name}</div>,
    });
    assert.equal(gc._tag, "graft-component");
    assert.equal(gc.schema, schema);
  });

  it("run returns a ReactElement", () => {
    const gc = component({
      input: z.object({ x: z.number() }),
      output: View,
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
      output: View,
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
      output: View,
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
      output: View,
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
      output: View,
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
      output: View,
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

  it("embeds a View-returning component inside another View component", () => {
    const Header = component({
      input: z.object({ title: z.string() }),
      output: View,
      run: ({ title }) => <h1 data-testid="header">{title}</h1>,
    });

    const Page = component({
      input: z.object({ header: View, body: z.string() }),
      output: View,
      run: ({ header, body }) => (
        <div data-testid="page">
          {header}
          <p>{body}</p>
        </div>
      ),
    });

    const Composed = compose({ into: Page, from: Header, key: "header" });
    const ComposedReact = toReact(Composed);

    render(<ComposedReact title="Hello" body="content here" />);
    assert.equal(screen.getByTestId("header").textContent, "Hello");
    assert.equal(
      screen.getByTestId("page").textContent,
      "Hellocontent here",
    );
  });
});

describe("toReact", () => {
  it("converts a component to React.FC", () => {
    const gc = component({
      input: z.object({ who: z.string() }),
      output: View,
      run: (props) => <h1 data-testid="hello">Hello {props.who}</h1>,
    });

    const Hello = toReact(gc);
    render(<Hello who="World" />);
    assert.equal(screen.getByTestId("hello").textContent, "Hello World");
  });

  it("validates props and throws on invalid input", () => {
    const gc = component({
      input: z.object({ count: z.number() }),
      output: View,
      run: (props) => <span>{props.count}</span>,
    });

    const Counter = toReact(gc);

    assert.throws(() => {
      // @ts-expect-error — intentionally passing wrong type
      render(<Counter count="not a number" />);
    });
  });
});

describe("async", () => {
  it("async data component run returns a promise", async () => {
    const Fetch = component({
      input: z.object({ id: z.string() }),
      output: z.number(),
      run: async ({ id }) => {
        await new Promise((r) => setTimeout(r, 10));
        return id.length;
      },
    });
    const result = Fetch.run({ id: "hello" });
    assert.ok(result instanceof Promise);
    assert.equal(await result, 5);
  });

  it("compose with async from produces async run", async () => {
    const Display = component({
      input: z.object({ value: z.number() }),
      output: View,
      run: ({ value }) => <span data-testid="val">{value}</span>,
    });

    const AsyncDouble = component({
      input: z.object({ n: z.number() }),
      output: z.number(),
      run: async ({ n }) => {
        await new Promise((r) => setTimeout(r, 10));
        return n * 2;
      },
    });

    const Composed = compose({ into: Display, from: AsyncDouble, key: "value" });
    const result = Composed.run({ n: 5 });
    assert.ok(result instanceof Promise);
    // The resolved value is a ReactElement
    const el = await result;
    assert.ok(el);
  });

  it("toReact renders async composed component", async () => {
    const Display = component({
      input: z.object({ value: z.string() }),
      output: View,
      run: ({ value }) => <p data-testid="async-result">{value}</p>,
    });

    const AsyncUpper = component({
      input: z.object({ text: z.string() }),
      output: z.string(),
      run: async ({ text }) => {
        await new Promise((r) => setTimeout(r, 10));
        return text.toUpperCase();
      },
    });

    const Composed = compose({ into: Display, from: AsyncUpper, key: "value" });
    const App = toReact(Composed);

    render(<App text="hello" />);

    // Initially renders nothing (pending)
    assert.equal(screen.queryByTestId("async-result"), null);

    // Wait for async resolution
    const el = await screen.findByTestId("async-result");
    assert.equal(el.textContent, "HELLO");
  });

  it("chained async compose works", async () => {
    const Show = component({
      input: z.object({ msg: z.string() }),
      output: View,
      run: ({ msg }) => <div data-testid="chain">{msg}</div>,
    });

    const AsyncConcat = component({
      input: z.object({ a: z.string(), b: z.string() }),
      output: z.string(),
      run: async ({ a, b }) => {
        await new Promise((r) => setTimeout(r, 10));
        return `${a}-${b}`;
      },
    });

    const AsyncWrap = component({
      input: z.object({ val: z.string() }),
      output: z.string(),
      run: async ({ val }) => {
        await new Promise((r) => setTimeout(r, 10));
        return `[${val}]`;
      },
    });

    const Step1 = compose({ into: Show, from: AsyncConcat, key: "msg" });
    const Step2 = compose({ into: Step1, from: AsyncWrap, key: "a" });
    const App = toReact(Step2);

    render(<App val="x" b="y" />);
    const el = await screen.findByTestId("chain");
    assert.equal(el.textContent, "[x]-y");
  });

  it("async component error is thrown during render", async () => {
    const Display = component({
      input: z.object({ data: z.string() }),
      output: View,
      run: ({ data }) => <span>{data}</span>,
    });

    const Failing = component({
      input: z.object({}),
      output: z.string(),
      run: async () => {
        await new Promise((r) => setTimeout(r, 10));
        throw new Error("fetch failed");
      },
    });

    const Composed = compose({ into: Display, from: Failing, key: "data" });

    // The composed run returns a promise that rejects
    const result = Composed.run({});
    assert.ok(result instanceof Promise);
    await assert.rejects(result as Promise<unknown>, { message: "fetch failed" });
  });
});

describe("source", () => {
  it("creates a source with empty input schema", () => {
    const Clock = source({
      output: z.number(),
      run: (emit) => {
        emit(0);
        return () => {};
      },
    });
    assert.equal(Clock._tag, "graft-component");
    assert.deepEqual(Object.keys(Clock.schema.shape), []);
  });

  it("subscribe receives emitted values", () => {
    const values: number[] = [];
    let emitter: ((v: number) => void) | null = null;

    const Counter = source({
      output: z.number(),
      run: (emit) => {
        emitter = emit;
        emit(0);
        return () => {};
      },
    });

    const cleanup = Counter.subscribe({}, (v) => { values.push(v); });
    assert.deepEqual(values, [0]);

    emitter!(1);
    emitter!(2);
    assert.deepEqual(values, [0, 1, 2]);

    cleanup();
    // After cleanup, emissions should not be delivered
    // (source's cleanup was called, so emitter is invalid)
  });

  it("cleanup stops the source", () => {
    let cleaned = false;
    const S = source({
      output: z.number(),
      run: (emit) => {
        emit(1);
        return () => { cleaned = true; };
      },
    });

    const cleanup = S.subscribe({}, () => {});
    assert.equal(cleaned, false);
    cleanup();
    assert.equal(cleaned, true);
  });
});

describe("reactive compose", () => {
  it("source composed into a data component re-emits on source change", () => {
    let emitter: ((v: number) => void) | null = null;

    const NumSource = source({
      output: z.number(),
      run: (emit) => {
        emitter = emit;
        emit(1);
        return () => {};
      },
    });

    const Double = component({
      input: z.object({ n: z.number() }),
      output: z.number(),
      run: ({ n }) => n * 2,
    });

    const Composed = compose({ into: Double, from: NumSource, key: "n" });

    const values: number[] = [];
    const cleanup = Composed.subscribe({}, (v) => { values.push(v); });

    assert.deepEqual(values, [2]); // 1 * 2

    emitter!(5);
    assert.deepEqual(values, [2, 10]); // 5 * 2

    emitter!(10);
    assert.deepEqual(values, [2, 10, 20]);

    cleanup();
  });

  it("source composed into a View re-renders via toReact", async () => {
    let emitter: ((v: string) => void) | null = null;

    const MsgSource = source({
      output: z.string(),
      run: (emit) => {
        emitter = emit;
        emit("hello");
        return () => {};
      },
    });

    const Display = component({
      input: z.object({ text: z.string() }),
      output: View,
      run: ({ text }) => <div data-testid="reactive">{text}</div>,
    });

    const Composed = compose({ into: Display, from: MsgSource, key: "text" });
    const App = toReact(Composed);

    render(<App />);

    // Initial value
    const el = await screen.findByTestId("reactive");
    assert.equal(el.textContent, "hello");

    // Source emits a new value — should re-render
    act(() => { emitter!("world"); });
    assert.equal(screen.getByTestId("reactive").textContent, "world");

    act(() => { emitter!("graft"); });
    assert.equal(screen.getByTestId("reactive").textContent, "graft");
  });

  it("three-level reactive chain: source → data → data → view", async () => {
    let emitter: ((v: number) => void) | null = null;

    const NumSource = source({
      output: z.number(),
      run: (emit) => {
        emitter = emit;
        emit(3);
        return () => {};
      },
    });

    const Double = component({
      input: z.object({ n: z.number() }),
      output: z.number(),
      run: ({ n }) => n * 2,
    });

    const ToString = component({
      input: z.object({ value: z.number() }),
      output: z.string(),
      run: ({ value }) => `val:${value}`,
    });

    const Show = component({
      input: z.object({ msg: z.string() }),
      output: View,
      run: ({ msg }) => <span data-testid="chain-reactive">{msg}</span>,
    });

    // NumSource → Double (key: n) → ToString (key: value) → Show (key: msg)
    const Step1 = compose({ into: Double, from: NumSource, key: "n" });
    const Step2 = compose({ into: ToString, from: Step1, key: "value" });
    const Step3 = compose({ into: Show, from: Step2, key: "msg" });
    const App = toReact(Step3);

    render(<App />);
    const el = await screen.findByTestId("chain-reactive");
    assert.equal(el.textContent, "val:6"); // 3 * 2 = 6

    act(() => { emitter!(10); });
    assert.equal(screen.getByTestId("chain-reactive").textContent, "val:20"); // 10 * 2 = 20
  });

  it("cleanup from toReact unmount disposes the source", () => {
    let cleaned = false;

    const S = source({
      output: z.number(),
      run: (emit) => {
        emit(0);
        return () => { cleaned = true; };
      },
    });

    const Display = component({
      input: z.object({ n: z.number() }),
      output: View,
      run: ({ n }) => <span>{n}</span>,
    });

    const Composed = compose({ into: Display, from: S, key: "n" });
    const App = toReact(Composed);

    const { unmount } = render(<App />);
    assert.equal(cleaned, false);
    unmount();
    assert.equal(cleaned, true);
  });

  it("source with interval pattern", async () => {
    let count = 0;

    const Ticker = source({
      output: z.number(),
      run: (emit) => {
        emit(count);
        const id = setInterval(() => {
          count++;
          emit(count);
        }, 50);
        return () => clearInterval(id);
      },
    });

    const Display = component({
      input: z.object({ tick: z.number() }),
      output: View,
      run: ({ tick }) => <span data-testid="ticker">{tick}</span>,
    });

    const Composed = compose({ into: Display, from: Ticker, key: "tick" });
    const App = toReact(Composed);

    render(<App />);
    const el = await screen.findByTestId("ticker");
    assert.equal(el.textContent, "0");

    // Wait for a couple ticks
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });

    const val = Number(screen.getByTestId("ticker").textContent);
    assert.ok(val >= 1, `Expected at least 1 tick, got ${val}`);
  });
});

describe("state", () => {
  it("creates a state with correct tag and empty schema", () => {
    const [Value, _setValue] = state({
      schema: z.number(),
      initial: 0,
    });
    assert.equal(Value._tag, "graft-component");
    assert.deepEqual(Object.keys(Value.schema.shape), []);
  });

  it("subscriber receives initial value immediately", () => {
    const [Value, _setValue] = state({
      schema: z.string(),
      initial: "hello",
    });

    const values: string[] = [];
    const cleanup = Value.subscribe({}, (v) => { values.push(v); });
    assert.deepEqual(values, ["hello"]);
    cleanup();
  });

  it("setter triggers re-emission to all subscribers", () => {
    const [Value, setValue] = state({
      schema: z.number(),
      initial: 0,
    });

    const values1: number[] = [];
    const values2: number[] = [];
    const c1 = Value.subscribe({}, (v) => { values1.push(v); });
    const c2 = Value.subscribe({}, (v) => { values2.push(v); });

    assert.deepEqual(values1, [0]);
    assert.deepEqual(values2, [0]);

    setValue(10);
    assert.deepEqual(values1, [0, 10]);
    assert.deepEqual(values2, [0, 10]);

    setValue(20);
    assert.deepEqual(values1, [0, 10, 20]);
    assert.deepEqual(values2, [0, 10, 20]);

    c1();
    c2();
  });

  it("cleanup unsubscribes — no further emissions", () => {
    const [Value, setValue] = state({
      schema: z.number(),
      initial: 0,
    });

    const values: number[] = [];
    const cleanup = Value.subscribe({}, (v) => { values.push(v); });
    assert.deepEqual(values, [0]);

    cleanup();
    setValue(42);
    // Should NOT receive 42
    assert.deepEqual(values, [0]);
  });

  it("new subscriber gets current value (not initial)", () => {
    const [Value, setValue] = state({
      schema: z.string(),
      initial: "first",
    });

    setValue("second");
    setValue("third");

    const values: string[] = [];
    const cleanup = Value.subscribe({}, (v) => { values.push(v); });
    assert.deepEqual(values, ["third"]);
    cleanup();
  });

  it("compose with state: state feeds into a data component", () => {
    const [Count, setCount] = state({
      schema: z.number(),
      initial: 5,
    });

    const Double = component({
      input: z.object({ n: z.number() }),
      output: z.number(),
      run: ({ n }) => n * 2,
    });

    const Composed = compose({ into: Double, from: Count, key: "n" });

    const values: number[] = [];
    const cleanup = Composed.subscribe({}, (v) => { values.push(v); });
    assert.deepEqual(values, [10]); // 5 * 2

    setCount(7);
    assert.deepEqual(values, [10, 14]); // 7 * 2

    cleanup();
  });

  it("compose with state into a View and render via toReact", async () => {
    const [Label, setLabel] = state({
      schema: z.string(),
      initial: "initial",
    });

    const Display = component({
      input: z.object({ text: z.string() }),
      output: View,
      run: ({ text }) => <div data-testid="state-view">{text}</div>,
    });

    const Composed = compose({ into: Display, from: Label, key: "text" });
    const App = toReact(Composed);

    render(<App />);

    const el = await screen.findByTestId("state-view");
    assert.equal(el.textContent, "initial");

    act(() => { setLabel("updated"); });
    assert.equal(screen.getByTestId("state-view").textContent, "updated");

    act(() => { setLabel("final"); });
    assert.equal(screen.getByTestId("state-view").textContent, "final");
  });

  it("state in a three-level chain: state → data → data → view", async () => {
    const [Num, setNum] = state({
      schema: z.number(),
      initial: 3,
    });

    const Double = component({
      input: z.object({ n: z.number() }),
      output: z.number(),
      run: ({ n }) => n * 2,
    });

    const ToString = component({
      input: z.object({ value: z.number() }),
      output: z.string(),
      run: ({ value }) => `val:${value}`,
    });

    const Show = component({
      input: z.object({ msg: z.string() }),
      output: View,
      run: ({ msg }) => <span data-testid="state-chain">{msg}</span>,
    });

    const Step1 = compose({ into: Double, from: Num, key: "n" });
    const Step2 = compose({ into: ToString, from: Step1, key: "value" });
    const Step3 = compose({ into: Show, from: Step2, key: "msg" });
    const App = toReact(Step3);

    render(<App />);
    const el = await screen.findByTestId("state-chain");
    assert.equal(el.textContent, "val:6"); // 3 * 2

    act(() => { setNum(10); });
    assert.equal(screen.getByTestId("state-chain").textContent, "val:20"); // 10 * 2
  });

  it("run returns current value", () => {
    const [Value, setValue] = state({
      schema: z.number(),
      initial: 42,
    });
    assert.equal(Value.run({}), 42);

    setValue(99);
    assert.equal(Value.run({}), 99);
  });
});

describe("instantiate", () => {
  it("returns a GraftComponent with same schema as template", () => {
    const Template = () => component({
      input: z.object({ x: z.number() }),
      output: z.number(),
      run: ({ x }) => x * 2,
    });

    const Instance = instantiate(Template);
    assert.equal(Instance._tag, "graft-component");
    assert.deepEqual(Object.keys(Instance.schema.shape), ["x"]);
  });

  it("run delegates to a fresh template instance", () => {
    const Template = () => component({
      input: z.object({ n: z.number() }),
      output: z.number(),
      run: ({ n }) => n + 1,
    });

    const Instance = instantiate(Template);
    assert.equal(Instance.run({ n: 5 }), 6);
  });

  it("each subscribe call gets isolated state", () => {
    // This is the key test: two instantiate() calls on the same template
    // should produce independent state cells.
    const Template = () => {
      const [Value, setValue] = state({ schema: z.number(), initial: 0 });
      const Inc = component({
        input: z.object({ n: z.number() }),
        output: z.number(),
        run: ({ n }) => n + 1,
      });
      // We return both the composed component and the setter via closure
      return { gc: compose({ into: Inc, from: Value, key: "n" }), setValue };
    };

    // Two independent instances
    const inst1 = Template();
    const inst2 = Template();

    const values1: number[] = [];
    const values2: number[] = [];
    const c1 = inst1.gc.subscribe({}, (v) => { values1.push(v); });
    const c2 = inst2.gc.subscribe({}, (v) => { values2.push(v); });

    // Both start at initial (0 + 1 = 1)
    assert.deepEqual(values1, [1]);
    assert.deepEqual(values2, [1]);

    // Mutate only inst1's state
    inst1.setValue(10);
    assert.deepEqual(values1, [1, 11]); // 10 + 1
    assert.deepEqual(values2, [1]);     // unchanged

    // Mutate only inst2's state
    inst2.setValue(20);
    assert.deepEqual(values1, [1, 11]);
    assert.deepEqual(values2, [1, 21]); // 20 + 1

    c1();
    c2();
  });

  it("instantiate isolates state across two usages of same template", () => {
    const TextInput = () => {
      const [Value, setValue] = state({ schema: z.string(), initial: "" });
      return { gc: Value, setValue };
    };

    const field1 = instantiate(() => TextInput().gc);
    const field2 = instantiate(() => TextInput().gc);

    const vals1: string[] = [];
    const vals2: string[] = [];

    // Subscribe to both — each should start at ""
    const c1 = field1.subscribe({}, (v) => { vals1.push(v); });
    const c2 = field2.subscribe({}, (v) => { vals2.push(v); });

    assert.deepEqual(vals1, [""]);
    assert.deepEqual(vals2, [""]);

    c1();
    c2();
  });

  it("instantiate with state composes into a View and renders via toReact", async () => {
    // Template: a counter component with local state
    const Counter = () => {
      const [Count, _setCount] = state({ schema: z.number(), initial: 0 });
      const Display = component({
        input: z.object({ n: z.number() }),
        output: View,
        run: ({ n }) => <span data-testid="inst-count">{n}</span>,
      });
      return compose({ into: Display, from: Count, key: "n" });
    };

    const Instance = instantiate(Counter);
    const App = toReact(Instance);

    render(<App />);
    const el = await screen.findByTestId("inst-count");
    assert.equal(el.textContent, "0");
  });

  it("subscribe creates fresh instance each time (isolated lifecycle)", () => {
    let callCount = 0;

    const Template = () => {
      callCount++;
      return component({
        input: z.object({}),
        output: z.number(),
        run: () => callCount,
      });
    };

    const Instance = instantiate(Template);

    // Probe call happens at instantiate time
    assert.equal(callCount, 1);

    // Each subscribe creates a new instance
    const v1: number[] = [];
    const c1 = Instance.subscribe({}, (v) => { v1.push(v); });
    assert.equal(callCount, 2);
    assert.deepEqual(v1, [2]);
    c1();

    const v2: number[] = [];
    const c2 = Instance.subscribe({}, (v) => { v2.push(v); });
    assert.equal(callCount, 3);
    assert.deepEqual(v2, [3]);
    c2();
  });

  it("cleanup tears down the inner instance", () => {
    let cleaned = false;

    const Template = () => source({
      output: z.number(),
      run: (emit) => {
        emit(42);
        return () => { cleaned = true; };
      },
    });

    const Instance = instantiate(Template);
    const values: number[] = [];
    const cleanup = Instance.subscribe({}, (v) => { values.push(v); });

    assert.deepEqual(values, [42]);
    assert.equal(cleaned, false);

    cleanup();
    assert.equal(cleaned, true);
  });

  it("compose with instantiate — unsatisfied inputs bubble up", () => {
    const Template = () => component({
      input: z.object({ x: z.number() }),
      output: z.number(),
      run: ({ x }) => x * 3,
    });

    const Display = component({
      input: z.object({ value: z.number() }),
      output: View,
      run: ({ value }) => <span data-testid="inst-compose">{value}</span>,
    });

    const Instance = instantiate(Template);
    const Composed = compose({ into: Display, from: Instance, key: "value" });

    // x should bubble up
    assert.deepEqual(Object.keys(Composed.schema.shape), ["x"]);

    const App = toReact(Composed);
    render(<App x={7} />);
    const el = screen.getByTestId("inst-compose");
    assert.equal(el.textContent, "21");
  });

  it("two instantiated fields with state rendered together have independent state", async () => {
    // Simulates two form fields — the core use case
    const TextField = () => {
      const [Value, setValue] = state({ schema: z.string(), initial: "" });

      const Display = component({
        input: z.object({ label: z.string(), text: z.string() }),
        output: View,
        run: ({ label, text }) => <div data-testid={`field-${label}`}>{text}</div>,
      });

      const WithValue = compose({ into: Display, from: Value, key: "text" });
      return { gc: WithValue, setValue };
    };

    // We need to get the setters out, so we call the templates directly
    // but the point is each call gives isolated state
    const name = TextField();
    const email = TextField();

    const NameField = name.gc;
    const EmailField = email.gc;

    const NameReact = toReact(NameField);
    const EmailReact = toReact(EmailField);

    render(
      <>
        <NameReact label="name" />
        <EmailReact label="email" />
      </>,
    );

    const nameEl = await screen.findByTestId("field-name");
    const emailEl = await screen.findByTestId("field-email");
    assert.equal(nameEl.textContent, "");
    assert.equal(emailEl.textContent, "");

    // Update only the name field's state
    act(() => { name.setValue("Alice"); });
    assert.equal(screen.getByTestId("field-name").textContent, "Alice");
    assert.equal(screen.getByTestId("field-email").textContent, "");

    // Update only the email field's state
    act(() => { email.setValue("alice@test.com"); });
    assert.equal(screen.getByTestId("field-name").textContent, "Alice");
    assert.equal(screen.getByTestId("field-email").textContent, "alice@test.com");
  });
});

describe("GraftLoading", () => {
  it("async component subscribe emits GraftLoading then resolved value", async () => {
    const Fetch = component({
      input: z.object({ id: z.string() }),
      output: z.number(),
      run: async ({ id }) => {
        await new Promise((r) => setTimeout(r, 10));
        return id.length;
      },
    });

    const values: unknown[] = [];
    const cleanup = Fetch.subscribe({ id: "hello" }, (v) => { values.push(v); });

    // GraftLoading emitted synchronously
    assert.equal(values.length, 1);
    assert.equal(values[0], GraftLoading);

    // Wait for resolution
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(values.length, 2);
    assert.equal(values[1], 5);

    cleanup();
  });

  it("sync component subscribe does NOT emit GraftLoading", () => {
    const Add = component({
      input: z.object({ a: z.number(), b: z.number() }),
      output: z.number(),
      run: ({ a, b }) => a + b,
    });

    const values: unknown[] = [];
    const cleanup = Add.subscribe({ a: 3, b: 4 }, (v) => { values.push(v); });

    // Only the result, no GraftLoading
    assert.deepEqual(values, [7]);
    cleanup();
  });

  it("source without sync emit produces GraftLoading first", () => {
    const Delayed = source({
      output: z.number(),
      run: (emit) => {
        // Does NOT call emit synchronously
        const id = setTimeout(() => emit(42), 10);
        return () => clearTimeout(id);
      },
    });

    const values: unknown[] = [];
    const cleanup = Delayed.subscribe({}, (v) => { values.push(v); });

    // GraftLoading because no sync emit
    assert.equal(values.length, 1);
    assert.equal(values[0], GraftLoading);

    cleanup();
  });

  it("source with sync emit does NOT produce GraftLoading", () => {
    const Immediate = source({
      output: z.number(),
      run: (emit) => {
        emit(99);
        return () => {};
      },
    });

    const values: unknown[] = [];
    const cleanup = Immediate.subscribe({}, (v) => { values.push(v); });

    // Just the value, no GraftLoading
    assert.deepEqual(values, [99]);
    cleanup();
  });

  it("compose short-circuits on GraftLoading from async from", async () => {
    const Display = component({
      input: z.object({ value: z.number() }),
      output: View,
      run: ({ value }) => <span>{value}</span>,
    });

    const AsyncData = component({
      input: z.object({ n: z.number() }),
      output: z.number(),
      run: async ({ n }) => {
        await new Promise((r) => setTimeout(r, 10));
        return n * 2;
      },
    });

    const Composed = compose({ into: Display, from: AsyncData, key: "value" });

    const values: unknown[] = [];
    const cleanup = Composed.subscribe({ n: 5 }, (v) => { values.push(v); });

    // First emission is GraftLoading (short-circuit — Display.run was NOT called)
    assert.equal(values.length, 1);
    assert.equal(values[0], GraftLoading);

    // Wait for async resolution — now Display.run is called
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(values.length, 2);
    // Second value is a ReactElement (from Display), not GraftLoading
    assert.notEqual(values[1], GraftLoading);

    cleanup();
  });

  it("toReact renders null for GraftLoading then updates when value arrives", async () => {
    const Display = component({
      input: z.object({ msg: z.string() }),
      output: View,
      run: ({ msg }) => <p data-testid="loading-test">{msg}</p>,
    });

    const AsyncMsg = component({
      input: z.object({ text: z.string() }),
      output: z.string(),
      run: async ({ text }) => {
        await new Promise((r) => setTimeout(r, 10));
        return text.toUpperCase();
      },
    });

    const Composed = compose({ into: Display, from: AsyncMsg, key: "msg" });
    const App = toReact(Composed);

    render(<App text="loading" />);

    // Initially renders nothing (GraftLoading → null)
    assert.equal(screen.queryByTestId("loading-test"), null);

    // Once resolved, renders the value
    const el = await screen.findByTestId("loading-test");
    assert.equal(el.textContent, "LOADING");
  });

  it("multi-level GraftLoading propagation: async → data → view", async () => {
    const AsyncNum = component({
      input: z.object({}),
      output: z.number(),
      run: async () => {
        await new Promise((r) => setTimeout(r, 10));
        return 42;
      },
    });

    const Double = component({
      input: z.object({ n: z.number() }),
      output: z.number(),
      run: ({ n }) => n * 2,
    });

    const Show = component({
      input: z.object({ value: z.number() }),
      output: View,
      run: ({ value }) => <span data-testid="multi-loading">{value}</span>,
    });

    const Step1 = compose({ into: Double, from: AsyncNum, key: "n" });
    const Step2 = compose({ into: Show, from: Step1, key: "value" });
    const App = toReact(Step2);

    render(<App />);

    // Initially null (GraftLoading propagates through entire chain)
    assert.equal(screen.queryByTestId("multi-loading"), null);

    // Eventually resolves: 42 * 2 = 84
    const el = await screen.findByTestId("multi-loading");
    assert.equal(el.textContent, "84");
  });

  it("isSentinel correctly identifies GraftLoading", () => {
    assert.equal(isSentinel(GraftLoading), true);
    assert.equal(isSentinel(42), false);
    assert.equal(isSentinel(null), false);
    assert.equal(isSentinel("hello"), false);
    assert.equal(isSentinel(undefined), false);
  });
});

describe("deduplication", () => {
  it("source emitting same primitive value twice → into's run called only once", () => {
    let emitter: ((v: number) => void) | null = null;
    let runCount = 0;

    const Src = source({
      output: z.number(),
      run: (emit) => {
        emitter = emit;
        emit(10);
        return () => {};
      },
    });

    const Transform = component({
      input: z.object({ n: z.number() }),
      output: z.number(),
      run: ({ n }) => { runCount++; return n * 2; },
    });

    const Composed = compose({ into: Transform, from: Src, key: "n" });

    const values: number[] = [];
    const cleanup = Composed.subscribe({}, (v) => { values.push(v as number); });

    assert.equal(runCount, 1);
    assert.deepEqual(values, [20]);

    // Emit same value again — should be deduped
    emitter!(10);
    assert.equal(runCount, 1);
    assert.deepEqual(values, [20]);

    // Emit same value a third time — still deduped
    emitter!(10);
    assert.equal(runCount, 1);
    assert.deepEqual(values, [20]);

    cleanup();
  });

  it("state setter called with same value → downstream does not re-run", () => {
    const [Value, setValue] = state({
      schema: z.number(),
      initial: 5,
    });

    let runCount = 0;

    const Double = component({
      input: z.object({ n: z.number() }),
      output: z.number(),
      run: ({ n }) => { runCount++; return n * 2; },
    });

    const Composed = compose({ into: Double, from: Value, key: "n" });

    const values: number[] = [];
    const cleanup = Composed.subscribe({}, (v) => { values.push(v as number); });

    assert.equal(runCount, 1);
    assert.deepEqual(values, [10]);

    // Set same value — should be deduped
    setValue(5);
    assert.equal(runCount, 1);
    assert.deepEqual(values, [10]);

    // Set different value — should propagate
    setValue(7);
    assert.equal(runCount, 2);
    assert.deepEqual(values, [10, 14]);

    cleanup();
  });

  it("source emitting different values → all propagate (no false dedup)", () => {
    let emitter: ((v: number) => void) | null = null;

    const Src = source({
      output: z.number(),
      run: (emit) => {
        emitter = emit;
        emit(1);
        return () => {};
      },
    });

    const Identity = component({
      input: z.object({ n: z.number() }),
      output: z.number(),
      run: ({ n }) => n,
    });

    const Composed = compose({ into: Identity, from: Src, key: "n" });

    const values: number[] = [];
    const cleanup = Composed.subscribe({}, (v) => { values.push(v as number); });

    assert.deepEqual(values, [1]);

    emitter!(2);
    emitter!(3);
    emitter!(4);
    assert.deepEqual(values, [1, 2, 3, 4]);

    cleanup();
  });

  it("object reference equality: same ref deduped, different objects with same content NOT deduped", () => {
    let emitter: ((v: { x: number }) => void) | null = null;

    const Src = source({
      output: z.object({ x: z.number() }),
      run: (emit) => {
        emitter = emit;
        return () => {};
      },
    });

    let runCount = 0;

    const Reader = component({
      input: z.object({ obj: z.object({ x: z.number() }) }),
      output: z.number(),
      run: ({ obj }) => { runCount++; return obj.x; },
    });

    const Composed = compose({ into: Reader, from: Src, key: "obj" });

    const values: number[] = [];
    const cleanup = Composed.subscribe({}, (v) => {
      if (typeof v === "number") values.push(v);
    });

    // Nothing emitted yet (no sync emit), so GraftLoading
    assert.equal(runCount, 0);

    const obj1 = { x: 42 };
    emitter!(obj1);
    assert.equal(runCount, 1);
    assert.deepEqual(values, [42]);

    // Same reference — should be deduped
    emitter!(obj1);
    assert.equal(runCount, 1);
    assert.deepEqual(values, [42]);

    // Different object with same content — NOT deduped (=== fails)
    emitter!({ x: 42 });
    assert.equal(runCount, 2);
    assert.deepEqual(values, [42, 42]);

    cleanup();
  });

  it("consecutive GraftLoading emissions are deduped", async () => {
    // Two async components composed: both emit GraftLoading, but compose
    // should dedup the consecutive GraftLoading sentinels from the inner chain.
    const AsyncNum = component({
      input: z.object({}),
      output: z.number(),
      run: async () => {
        await new Promise((r) => setTimeout(r, 10));
        return 42;
      },
    });

    const Double = component({
      input: z.object({ n: z.number() }),
      output: z.number(),
      run: ({ n }) => n * 2,
    });

    const Composed = compose({ into: Double, from: AsyncNum, key: "n" });

    const values: unknown[] = [];
    const cleanup = Composed.subscribe({}, (v) => { values.push(v); });

    // Should get exactly one GraftLoading, not two
    assert.equal(values.length, 1);
    assert.equal(values[0], GraftLoading);

    // Wait for resolution
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(values.length, 2);
    assert.equal(values[1], 84); // 42 * 2

    cleanup();
  });

  it("GraftLoading then real value is NOT deduped (different values)", async () => {
    const AsyncNum = component({
      input: z.object({}),
      output: z.number(),
      run: async () => {
        await new Promise((r) => setTimeout(r, 10));
        return 7;
      },
    });

    const values: unknown[] = [];
    const cleanup = AsyncNum.subscribe({}, (v) => { values.push(v); });

    assert.equal(values.length, 1);
    assert.equal(values[0], GraftLoading);

    await new Promise((r) => setTimeout(r, 50));
    assert.equal(values.length, 2);
    assert.equal(values[1], 7);

    cleanup();
  });

  it("multi-level dedup: three-level chain, source spam → only distinct values reach view", () => {
    let emitter: ((v: number) => void) | null = null;

    const Src = source({
      output: z.number(),
      run: (emit) => {
        emitter = emit;
        emit(1);
        return () => {};
      },
    });

    let doubleCount = 0;
    const Double = component({
      input: z.object({ n: z.number() }),
      output: z.number(),
      run: ({ n }) => { doubleCount++; return n * 2; },
    });

    let toStringCount = 0;
    const ToString = component({
      input: z.object({ value: z.number() }),
      output: z.string(),
      run: ({ value }) => { toStringCount++; return `v:${value}`; },
    });

    const Step1 = compose({ into: Double, from: Src, key: "n" });
    const Step2 = compose({ into: ToString, from: Step1, key: "value" });

    const values: string[] = [];
    const cleanup = Step2.subscribe({}, (v) => { values.push(v as string); });

    assert.deepEqual(values, ["v:2"]);
    assert.equal(doubleCount, 1);
    assert.equal(toStringCount, 1);

    // Spam same value — nothing should propagate
    emitter!(1);
    emitter!(1);
    emitter!(1);
    assert.deepEqual(values, ["v:2"]);
    assert.equal(doubleCount, 1);
    assert.equal(toStringCount, 1);

    // New value — should propagate through entire chain
    emitter!(5);
    assert.deepEqual(values, ["v:2", "v:10"]);
    assert.equal(doubleCount, 2);
    assert.equal(toStringCount, 2);

    // Spam the new value — nothing
    emitter!(5);
    assert.deepEqual(values, ["v:2", "v:10"]);
    assert.equal(doubleCount, 2);
    assert.equal(toStringCount, 2);

    cleanup();
  });

  it("dedup works with toReact — same source value does not cause re-render", async () => {
    let emitter: ((v: string) => void) | null = null;
    let renderCount = 0;

    const Src = source({
      output: z.string(),
      run: (emit) => {
        emitter = emit;
        emit("hello");
        return () => {};
      },
    });

    const Display = component({
      input: z.object({ text: z.string() }),
      output: View,
      run: ({ text }) => { renderCount++; return <div data-testid="dedup-react">{text}</div>; },
    });

    const Composed = compose({ into: Display, from: Src, key: "text" });
    const App = toReact(Composed);

    render(<App />);
    const el = await screen.findByTestId("dedup-react");
    assert.equal(el.textContent, "hello");
    const initialRenderCount = renderCount;

    // Emit same value — should NOT trigger re-render
    act(() => { emitter!("hello"); });
    assert.equal(renderCount, initialRenderCount);
    assert.equal(screen.getByTestId("dedup-react").textContent, "hello");

    // Emit different value — should trigger re-render
    act(() => { emitter!("world"); });
    assert.equal(renderCount, initialRenderCount + 1);
    assert.equal(screen.getByTestId("dedup-react").textContent, "world");
  });
});

describe("multi-wire compose", () => {
  it("wires multiple inputs at once", () => {
    const Card = component({
      input: z.object({ title: z.string(), count: z.number() }),
      output: View,
      run: ({ title, count }) => (
        <div data-testid="multi-wire">
          {title}: {count}
        </div>
      ),
    });

    const Title = component({
      input: z.object({}),
      output: z.string(),
      run: () => "Hello",
    });

    const Count = component({
      input: z.object({}),
      output: z.number(),
      run: () => 42,
    });

    const Wired = compose({
      into: Card,
      from: { title: Title, count: Count },
    });

    // All inputs satisfied — no remaining props
    assert.deepEqual(Object.keys(Wired.schema.shape).sort(), []);

    // run works
    const el = Wired.run({});
    assert.ok(el);
  });

  it("multi-wire renders correctly via toReact", () => {
    const Card = component({
      input: z.object({ name: z.string(), age: z.number() }),
      output: View,
      run: ({ name, age }) => (
        <span data-testid="mw-render">
          {name} is {age}
        </span>
      ),
    });

    const Name = component({
      input: z.object({}),
      output: z.string(),
      run: () => "Alice",
    });

    const Age = component({
      input: z.object({}),
      output: z.number(),
      run: () => 30,
    });

    const Wired = compose({ into: Card, from: { name: Name, age: Age } });
    const App = toReact(Wired);

    render(<App />);
    assert.equal(screen.getByTestId("mw-render").textContent, "Alice is 30");
  });

  it("unsatisfied inputs bubble up in multi-wire", () => {
    const Card = component({
      input: z.object({ title: z.string(), count: z.number(), extra: z.boolean() }),
      output: View,
      run: ({ title, count, extra }) => (
        <span>
          {title}: {count} ({String(extra)})
        </span>
      ),
    });

    const Title = component({
      input: z.object({}),
      output: z.string(),
      run: () => "Hi",
    });

    // Only wire title — count and extra should bubble up
    const Partial = compose({ into: Card, from: { title: Title } });
    const keys = Object.keys(Partial.schema.shape).sort();
    assert.deepEqual(keys, ["count", "extra"]);
  });

  it("multi-wire with from components that have their own inputs", () => {
    const Card = component({
      input: z.object({ label: z.string(), value: z.number() }),
      output: View,
      run: ({ label, value }) => (
        <span data-testid="mw-bubble">
          {label}={value}
        </span>
      ),
    });

    const MakeLabel = component({
      input: z.object({ prefix: z.string() }),
      output: z.string(),
      run: ({ prefix }) => `${prefix}:`,
    });

    const MakeValue = component({
      input: z.object({ n: z.number() }),
      output: z.number(),
      run: ({ n }) => n * 10,
    });

    const Wired = compose({
      into: Card,
      from: { label: MakeLabel, value: MakeValue },
    });

    // prefix and n should bubble up
    const keys = Object.keys(Wired.schema.shape).sort();
    assert.deepEqual(keys, ["n", "prefix"]);

    const App = toReact(Wired);
    render(<App prefix="count" n={5} />);
    assert.equal(screen.getByTestId("mw-bubble").textContent, "count:=50");
  });

  it("multi-wire with reactive sources", async () => {
    let emitA: ((v: string) => void) | null = null;
    let emitB: ((v: number) => void) | null = null;

    const SrcA = source({
      output: z.string(),
      run: (emit) => { emitA = emit; emit("hello"); return () => {}; },
    });

    const SrcB = source({
      output: z.number(),
      run: (emit) => { emitB = emit; emit(1); return () => {}; },
    });

    const Display = component({
      input: z.object({ msg: z.string(), count: z.number() }),
      output: View,
      run: ({ msg, count }) => <div data-testid="mw-reactive">{msg}:{count}</div>,
    });

    const Wired = compose({ into: Display, from: { msg: SrcA, count: SrcB } });

    // Test via subscribe instead of toReact to avoid act() timing issues
    const values: unknown[] = [];
    const cleanup = Wired.subscribe({}, (v) => { values.push(v); });

    // Should have rendered with initial values
    assert.ok(values.length >= 1);

    // Emit new value from SrcA
    emitA!("world");
    // Emit new value from SrcB
    emitB!(99);

    cleanup();
  });

  it("empty from record returns into unchanged", () => {
    const Card = component({
      input: z.object({ x: z.number() }),
      output: View,
      run: ({ x }) => <span>{x}</span>,
    });

    const Same = compose({ into: Card, from: {} });
    assert.deepEqual(Object.keys(Same.schema.shape), ["x"]);
  });
});

describe("GraftError", () => {
  it("async component rejection produces GraftError via subscribe", async () => {
    const Failing = component({
      input: z.object({}),
      output: z.string(),
      run: async () => {
        await new Promise((r) => setTimeout(r, 10));
        throw new Error("boom");
      },
    });

    const values: unknown[] = [];
    const cleanup = Failing.subscribe({}, (v) => { values.push(v); });

    // GraftLoading first
    assert.equal(values.length, 1);
    assert.equal(values[0], GraftLoading);

    // Wait for rejection
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(values.length, 2);
    assert.equal(isGraftError(values[1]), true);
    assert.equal((values[1] as { error: unknown }).error instanceof Error, true);
    assert.equal(((values[1] as { error: Error }).error).message, "boom");

    cleanup();
  });

  it("compose short-circuits on GraftError", async () => {
    const Display = component({
      input: z.object({ data: z.string() }),
      output: View,
      run: ({ data }) => <span>{data}</span>,
    });

    const Failing = component({
      input: z.object({}),
      output: z.string(),
      run: async () => {
        await new Promise((r) => setTimeout(r, 10));
        throw new Error("fetch failed");
      },
    });

    const Composed = compose({ into: Display, from: Failing, key: "data" });

    const values: unknown[] = [];
    const cleanup = Composed.subscribe({}, (v) => { values.push(v); });

    // GraftLoading first (short-circuited)
    assert.equal(values.length, 1);
    assert.equal(values[0], GraftLoading);

    // Then GraftError (short-circuited — Display.run was NOT called)
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(values.length, 2);
    assert.equal(isGraftError(values[1]), true);

    cleanup();
  });

  it("toReact renders null for GraftError", async () => {
    const Display = component({
      input: z.object({ data: z.string() }),
      output: View,
      run: ({ data }) => <span data-testid="error-test">{data}</span>,
    });

    const Failing = component({
      input: z.object({}),
      output: z.string(),
      run: async () => {
        await new Promise((r) => setTimeout(r, 10));
        throw new Error("oops");
      },
    });

    const Composed = compose({ into: Display, from: Failing, key: "data" });
    const App = toReact(Composed);

    render(<App />);

    // GraftLoading → null
    assert.equal(screen.queryByTestId("error-test"), null);

    // Wait for error — still renders null (GraftError → null)
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(screen.queryByTestId("error-test"), null);
  });

  it("GraftError carries the original error object", () => {
    const original = new TypeError("type mismatch");
    const ge = graftError(original);
    assert.equal(isGraftError(ge), true);
    assert.equal(ge.error, original);
  });

  it("isGraftError rejects non-error values", () => {
    assert.equal(isGraftError(42), false);
    assert.equal(isGraftError("error"), false);
    assert.equal(isGraftError(null), false);
    assert.equal(isGraftError(undefined), false);
    assert.equal(isGraftError({ _tag: "wrong" }), false);
    assert.equal(isGraftError(GraftLoading), false);
  });

  it("isSentinel correctly identifies GraftError", () => {
    const ge = graftError(new Error("test"));
    assert.equal(isSentinel(ge), true);
    assert.equal(isSentinel(GraftLoading), true);
    assert.equal(isSentinel(42), false);
  });

  it("run() still throws on async rejection (subscribe gives GraftError)", async () => {
    const Failing = component({
      input: z.object({}),
      output: z.string(),
      run: async () => {
        await new Promise((r) => setTimeout(r, 10));
        throw new Error("run rejects");
      },
    });

    // run() returns the raw promise — should reject normally
    await assert.rejects(Failing.run({}) as Promise<unknown>, { message: "run rejects" });
  });

  it("multi-level GraftError propagation through compose chain", async () => {
    const Failing = component({
      input: z.object({}),
      output: z.number(),
      run: async () => {
        await new Promise((r) => setTimeout(r, 10));
        throw new Error("deep error");
      },
    });

    const Double = component({
      input: z.object({ n: z.number() }),
      output: z.number(),
      run: ({ n }) => n * 2,
    });

    const Show = component({
      input: z.object({ value: z.number() }),
      output: View,
      run: ({ value }) => <span data-testid="error-chain">{value}</span>,
    });

    const Step1 = compose({ into: Double, from: Failing, key: "n" });
    const Step2 = compose({ into: Show, from: Step1, key: "value" });

    const values: unknown[] = [];
    const cleanup = Step2.subscribe({}, (v) => { values.push(v); });

    // GraftLoading first
    assert.equal(values[0], GraftLoading);

    // Then GraftError (propagated through Double and Show without calling them)
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(values.length, 2);
    assert.equal(isGraftError(values[1]), true);
    assert.equal(((values[1] as { error: Error }).error).message, "deep error");

    cleanup();
  });
});

describe("boundary validation", () => {
  it("run path: throws ZodError when from's run returns wrong type", () => {
    // from claims to output z.string() but actually returns a number
    const Bad = component({
      input: z.object({}),
      output: z.string(),
      run: () => 42 as unknown as string,
    });

    const Consumer = component({
      input: z.object({ text: z.string() }),
      output: z.string(),
      run: ({ text }) => text.toUpperCase(),
    });

    const Composed = compose({ into: Consumer, from: Bad, key: "text" });

    assert.throws(
      () => Composed.run({}),
      (err: unknown) => err instanceof z.ZodError,
    );
  });

  it("subscribe path: throws when from emits wrong type", () => {
    // source claims z.string() but emits a number
    const Bad = source({
      output: z.string(),
      run: (emit) => {
        (emit as (v: unknown) => void)(123);
        return () => {};
      },
    });

    const Consumer = component({
      input: z.object({ text: z.string() }),
      output: z.string(),
      run: ({ text }) => text.toUpperCase(),
    });

    const Composed = compose({ into: Consumer, from: Bad, key: "text" });

    assert.throws(
      () => Composed.subscribe({}, () => {}),
      (err: unknown) => err instanceof z.ZodError,
    );
  });

  it("valid values pass through boundary without error", () => {
    const Good = component({
      input: z.object({}),
      output: z.number(),
      run: () => 42,
    });

    const Double = component({
      input: z.object({ n: z.number() }),
      output: z.number(),
      run: ({ n }) => n * 2,
    });

    const Composed = compose({ into: Double, from: Good, key: "n" });

    // run path
    assert.equal(Composed.run({}), 84);

    // subscribe path
    const values: number[] = [];
    const cleanup = Composed.subscribe({}, (v) => { values.push(v as number); });
    assert.deepEqual(values, [84]);
    cleanup();
  });

  it("boundary validates object shapes", () => {
    // from claims { x: number, y: number } but returns { x: number }
    const Bad = component({
      input: z.object({}),
      output: z.object({ x: z.number(), y: z.number() }),
      run: () => ({ x: 1 }) as unknown as { x: number; y: number },
    });

    const Consumer = component({
      input: z.object({ point: z.object({ x: z.number(), y: z.number() }) }),
      output: z.number(),
      run: ({ point }) => point.x + point.y,
    });

    const Composed = compose({ into: Consumer, from: Bad, key: "point" });

    assert.throws(
      () => Composed.run({}),
      (err: unknown) => err instanceof z.ZodError,
    );
  });
});
