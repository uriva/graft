# graft

Compose React components by wiring named parameters together.

`compose({ into, from, key })` feeds `from`'s output into `into`'s input named `key`. The remaining unsatisfied inputs bubble up as the composed component's props. The result is always a standard React component.

No prop drilling. No Context. No useState. No useEffect.

```
npm install graft
```

## Why

React components are functions with named parameters (props). When you build a UI, you're really building a graph of data dependencies between those functions. But React forces you to wire that graph imperatively — passing props down, lifting state up, wrapping in Context providers, sprinkling hooks everywhere.

Graft lets you describe the wiring directly. You say *what* feeds into *what*, and the library builds the component for you. The unsatisfied inputs become the new component's props. This is [graph programming](https://uriva.github.io/blog/graph-programming.html) applied to React.

## Core concepts

There are only two things: **components** and **compose**.

A **component** is a typed function from inputs to an output. If the output is a `ReactElement`, it renders UI. If the output is a `number`, `string`, `object`, etc., it's a data source. There is no separate "provider" concept — everything is a component.

**`compose({ into, from, key })`** wires `from`'s output into `into`'s input named `key`. Returns a new component whose inputs are `into`'s remaining inputs plus `from`'s inputs.

When you're done composing, **`toReact`** converts the result into a regular `React.FC` (requires the output to be `ReactElement`).

## Quick example

```tsx
import { z } from "zod/v4";
import { component, compose, toReact, ReactOutput } from "graft";

// A visual component that displays a greeting
const Greeting = component({
  input: z.object({ message: z.string() }),
  output: ReactOutput,
  run: ({ message }) => <h1>{message}</h1>,
});

// A data component that builds a greeting string from a name
const MakeGreeting = component({
  input: z.object({ name: z.string() }),
  output: z.string(),
  run: ({ name }) => `Hello, ${name}!`,
});

// Wire MakeGreeting's output into Greeting's "message" input
const HelloApp = compose({ into: Greeting, from: MakeGreeting, key: "message" });

// Convert to a React component — only "name" remains as a prop
const App = toReact(HelloApp);

// Use it like any React component
<App name="Alice" />
// Renders: <h1>Hello, Alice!</h1>
```

## API

### `component({ input, output, run })`

Define a component from a zod input schema, a zod output schema, and a function.

```tsx
import { z } from "zod/v4";
import { component, ReactOutput } from "graft";

// A visual component (output is ReactElement)
const UserCard = component({
  input: z.object({
    name: z.string(),
    email: z.string(),
    age: z.number(),
  }),
  output: ReactOutput,
  run: ({ name, email, age }) => (
    <div>
      <h2>{name}</h2>
      <p>{email}</p>
      <p>{age} years old</p>
    </div>
  ),
});

// A data component (output is a number)
const FetchAge = component({
  input: z.object({ userId: z.string() }),
  output: z.number(),
  run: ({ userId }) => lookupAge(userId),
});
```

The input schema is the source of truth for both TypeScript types and runtime validation. The output schema declares the type of value the component produces. Use `ReactOutput` for components that return JSX.

### `compose({ into, from, key })`

Wire `from`'s output into `into`'s input named `key`. Returns a new component.

```tsx
import { compose } from "graft";

// UserCard needs { name, email, age }
// FetchAge needs { userId } and produces a number
// After composing on "age":
//   → new component needs { name, email, userId }
const UserCardWithAge = compose({ into: UserCard, from: FetchAge, key: "age" });
```

The key insight: `"age"` disappears from the inputs because it's now satisfied internally. `"userId"` appears because FetchAge needs it and nobody provides it yet.

### `toReact(graftComponent)`

Convert a graft component into a standard `React.FC`. This is the boundary between graft and React. The component must produce a `ReactElement`. Props are validated at runtime — a `ZodError` is thrown if anything is missing or has the wrong type.

```tsx
import { toReact } from "graft";

const UserCardReact = toReact(UserCardWithAge);

// TypeScript knows the props are { name: string, email: string, userId: string }
<UserCardReact name="Alice" email="alice@example.com" userId="u123" />
```

### `ReactOutput`

A pre-built zod schema for `ReactElement` output. Use it as the `output` for any component that returns JSX.

```tsx
import { ReactOutput } from "graft";

const MyComponent = component({
  input: z.object({ text: z.string() }),
  output: ReactOutput,
  run: ({ text }) => <p>{text}</p>,
});
```

## Chaining compositions

`compose` returns a graft component, so you can compose again. Each step satisfies one more input, and the unsatisfied inputs keep bubbling up.

```tsx
const Display = component({
  input: z.object({ msg: z.string() }),
  output: ReactOutput,
  run: ({ msg }) => <p>{msg}</p>,
});

const Format = component({
  input: z.object({ greeting: z.string(), name: z.string() }),
  output: z.string(),
  run: ({ greeting, name }) => `${greeting}, ${name}!`,
});

const MakeGreeting = component({
  input: z.object({ prefix: z.string() }),
  output: z.string(),
  run: ({ prefix }) => `${prefix} says`,
});

// Step 1: Format feeds into Display's "msg"
// Remaining inputs: { greeting, name }
const Step1 = compose({ into: Display, from: Format, key: "msg" });

// Step 2: MakeGreeting feeds into Step1's "greeting"
// Remaining inputs: { prefix, name }
const Step2 = compose({ into: Step1, from: MakeGreeting, key: "greeting" });

const App = toReact(Step2);

<App prefix="Alice" name="Bob" />
// Renders: <p>Alice says, Bob!</p>
```

Each `compose` call is like drawing one edge in a dependency graph. The final component is the whole graph, with only the unconnected inputs exposed as props.

## A more realistic example

Consider a user profile page that needs data from multiple sources:

```tsx
// --- Visual component ---

const ProfilePage = component({
  input: z.object({
    name: z.string(),
    email: z.string(),
    postCount: z.number(),
    avatarUrl: z.string(),
  }),
  output: ReactOutput,
  run: ({ name, email, postCount, avatarUrl }) => (
    <div>
      <img src={avatarUrl} alt={name} />
      <h1>{name}</h1>
      <p>{email}</p>
      <p>{postCount} posts</p>
    </div>
  ),
});

// --- Data components ---

const UserInfo = component({
  input: z.object({ userId: z.string() }),
  output: z.object({ name: z.string(), email: z.string() }),
  run: ({ userId }) => db.getUser(userId),
});

const PostCount = component({
  input: z.object({ userId: z.string() }),
  output: z.number(),
  run: ({ userId }) => db.countPosts(userId),
});

const Avatar = component({
  input: z.object({ email: z.string() }),
  output: z.string(),
  run: ({ email }) => `https://gravatar.com/avatar/${hash(email)}`,
});

const ExtractName = component({
  input: z.object({ userInfo: z.object({ name: z.string(), email: z.string() }) }),
  output: z.string(),
  run: ({ userInfo }) => userInfo.name,
});

const ExtractEmail = component({
  input: z.object({ userInfo: z.object({ name: z.string(), email: z.string() }) }),
  output: z.string(),
  run: ({ userInfo }) => userInfo.email,
});

// --- Wiring ---

const WithPostCount = compose({ into: ProfilePage, from: PostCount, key: "postCount" });
// Inputs: { name, email, avatarUrl, userId }

const WithAvatar = compose({ into: WithPostCount, from: Avatar, key: "avatarUrl" });
// Inputs: { name, userId, email }

const WithName = compose({ into: WithAvatar, from: ExtractName, key: "name" });
// Inputs: { userId, email, userInfo }

const WithEmail = compose({ into: WithName, from: ExtractEmail, key: "email" });
// Inputs: { userId, userInfo }

const WithUserInfo = compose({ into: WithEmail, from: UserInfo, key: "userInfo" });
// Inputs: { userId }

const ProfilePageReact = toReact(WithUserInfo);

// The only input left is userId — everything else is wired internally
<ProfilePageReact userId="u123" />
```

## Runtime validation

Every input is validated at runtime using the zod schemas you defined. If an input is missing or has the wrong type, you get a clear `ZodError` at render time — not a silent `undefined` propagating through your component tree.

```tsx
const App = toReact(
  component({
    input: z.object({ count: z.number() }),
    output: ReactOutput,
    run: ({ count }) => <span>{count}</span>,
  }),
);

// This throws a ZodError at runtime:
<App count="not a number" />
// ZodError: Invalid input: expected number, received string
```

## How it works

Graft is a runtime library, not a compiler plugin. `compose()` is a regular function call that:

1. Takes `into`'s input schema and removes the key being wired
2. Merges the remaining shape with `from`'s input schema
3. Returns a new graft component with the merged schema
4. At render time, splits the incoming props, runs `from`, and passes the result to `into`

The type-level generics ensure TypeScript knows exactly what inputs the composed component needs. The runtime zod validation ensures the types are enforced even in JavaScript or at module boundaries.

## Install

```
npm install graft
```

Requires React 18+ as a peer dependency. Uses [zod v4](https://zod.dev) (`zod/v4` import) for schemas.

## License

MIT
