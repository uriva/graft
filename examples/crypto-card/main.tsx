import React from "react";
import { createRoot } from "react-dom/client";
import { z } from "zod/v4";
import { component, compose, emitter, toReact, View } from "../../src/index.js";

// A live price feed — pushes new values over a public WebSocket.
const PriceFeed = emitter({
  output: z.number(),
  run: (emit) => {
    const ws = new WebSocket("wss://stream.binance.com:9443/ws/btcusdt@trade");
    ws.onmessage = (e) => emit(Number(JSON.parse(e.data).p));
    return () => ws.close();
  },
});

// An async data component — fetches the coin name from CoinGecko.
const CoinName = component({
  input: z.object({ coinId: z.string() }),
  output: z.string(),
  run: async ({ coinId }) => {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false`,
    );
    return (await res.json()).name;
  },
});

// A pure data component — formats a number into a display string.
const FormatPrice = component({
  input: z.object({ price: z.number() }),
  output: z.string(),
  run: ({ price }) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
      .format(price),
});

// A header component — returns a View.
const Header = component({
  input: z.object({ name: z.string() }),
  output: View,
  run: ({ name }) => <h1>{name}</h1>,
});

// The page layout — accepts a View for the header slot and a string for the price.
const PriceCard = component({
  input: z.object({ header: View, displayPrice: z.string() }),
  output: View,
  run: ({ header, displayPrice }) => (
    <div className="card">
      {header}
      <span className="price">{displayPrice}</span>
    </div>
  ),
});

// --- Wiring ---

const LivePrice = compose({ into: FormatPrice, from: PriceFeed, key: "price" });
const WithPrice = compose({
  into: PriceCard,
  from: LivePrice,
  key: "displayPrice",
});

const NamedHeader = compose({ into: Header, from: CoinName, key: "name" });
const App = toReact(
  compose({ into: WithPrice, from: NamedHeader, key: "header" }),
);

// --- Mount ---

createRoot(document.getElementById("root")!).render(<App coinId="bitcoin" />);
