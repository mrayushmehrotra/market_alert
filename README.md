# NIFTY/SENSEX VWAP-EMA9 Screener & Alert App

A **frontend-only** Expo app that monitors NIFTY 50 and SENSEX in real time
using the INDmoney / INDstocks API. It computes **VWAP** and **9-period EMA**
on-device from 5-minute candles and raises a distinct, loud notification
whenever **EMA9 crosses VWAP** on either index.

Everything runs on-device — there is **no backend**. It pulls live data
directly from the INDstocks API over REST + WebSocket and does all the
indicator math locally.

Runs on **Android** (native notifications, foreground service) and **Web**
(`expo start --web`) so you can watch the dashboard in your browser.

## Features

- 📊 **Live dashboard** — NIFTY & SENSEX cards showing price, day change,
  VWAP, EMA9, volume, and whether EMA9 is above/below VWAP.
- 🔔 **EMA9/VWAP cross alerts** — on Android, a distinct high-priority
  notification with a custom sound; on web, a browser notification.
- 🔁 **Persistent ticker** — Android-only Spotify-style foreground-service
  notification that keeps updating live prices in your notification shade.
- 🌐 **Dual data path** — WebSocket price feed for low-latency ticks, plus a
  REST polling fallback so alerts keep working if the WS feed is unavailable.
- 🔄 Built-in reconnection with exponential backoff.

## Architecture

```
App.js (dashboard UI)
  │
  ├── tickerService.js (orchestrator)
  │     ├── indstocksClient.js (REST + WebSocket)
  │     ├── indicators.js (VWAP + EMA9 math + cross detection)
  │     └── notifications.js (foreground service + alerts)
  │
  └── config.js / app.config.js (reads INDMONEY_API_KEY from .env)
```

**Data flow**

1. On start → fetch today's 5-minute candles for NIFTY & SENSEX from
   `GET /market/historical/5minute`.
2. Bootstrap VWAP (volume-weighted average price) and EMA9 from those candles.
3. Subscribe to the INDstocks WebSocket price feed (`wss://ws-prices.indstocks.com`)
   for real-time quote updates, with REST LTP polling every 5s as a fallback.
4. On every tick → update VWAP/EMA9 → detect a cross → fire a notification.

## Setup

### 1. Prerequisites

- [bun](https://bun.sh) (fast package manager) — or npm if you prefer
- An Expo / EAS account (for Android dev builds — see below)
- An **INDstocks access token** for the live market data

### 2. Get your API key

1. Log in at [indstocks.com](https://indstocks.com).
2. Go to **Access Tokens** → https://indstocks.com/app/api-trading/access-tokens
3. Generate your access token.

> ⚠️ Tokens expire after **24 hours** and must be regenerated.

### 3. Set the API key

Create a `.env` file in the project root (copy `.env.example`):

```env
INDMONEY_API_KEY=your_indstocks_access_token_here
```

The key is injected into the app at build/start time via `app.config.js`.
(If it's missing, the app shows an error and disables the Start button.)

### 4. Install dependencies

```bash
bun install
```

(Or `npm install` if you don't use bun.)

## Running on Web (quickest way to watch it)

No build needed — just start the web dev server and open the browser:

```bash
bun run web        # or: npm run web
```

This starts Metro on `http://localhost:8081` and opens it in your browser.
You'll see the dashboard with live prices, VWAP, and EMA9. The app uses the
**REST polling fallback** on web (browsers can't attach custom headers to the
WebSocket auth handshake), so prices and cross-detection still work live, and
you get **browser notifications** on EMA9/VWAP crosses.

> ℹ️ On web the API key is embedded in the client bundle. Use it only in a
> private/trusted context — anyone with the page's JS could read it.

## Running on Android

> ⚠️ Expo Go **cannot run a foreground service** — that requires native
> Android code, which `@notifee/react-native` provides. You need a custom dev
> build:

```bash
npm install -g eas-cli
eas login
eas build:configure
eas build --profile development --platform android
```

This produces an installable APK (or a build you can install via the EAS
dashboard/QR code) that includes the foreground-service capability. Install
that APK on your phone instead of using Expo Go.

## Running it

**On Android** (after building the EAS dev APK):
1. Install the EAS dev-build APK on your phone.
2. Open the app — confirm you've set `INDMONEY_API_KEY` in `.env`.
3. Tap **Start Monitoring** — a persistent ticker notification appears with
   live NIFTY & SENSEX prices.
4. Whenever **EMA9 crosses VWAP** on either index, you'll get a separate,
   loud notification with your custom `cross_alert` sound — distinct from the
   silent, ongoing ticker.

**On Web**:
1. Run `bun run web` and open the browser tab it launches.
2. Tap **Start Monitoring** — prices, VWAP, and EMA9 update live.
3. Allow browser notifications when prompted; crosses fire browser alerts.

## Project layout

```
App.js                  Dashboard UI (dark theme, live cards)
config.js               API base URLs, instrument tokens, EMA period, market hours
indicators.js           VWAP + EMA9 math, cross detection
indstocksClient.js      INDstocks REST client + WebSocket price feed + polling
notifications.js        Native (Android) foreground-service + cross alerts
notifications.web.js    Web shim — browser notifications, no-op for the rest
tickerService.js        Orchestrator: bootstrap, live updates, cross detection
plugins/withNotifee.js  Local Expo config plugin (Android foreground service)
app.config.js           Reads .env and injects INDMONEY_API_KEY into Expo config
app.json                Expo native configuration (web, plugins, permissions)
.env                    Your INDstocks API key (gitignored, not committed)
```

## Configuration reference

| Instrument | REST scrip      | WebSocket id |
|------------|-----------------|--------------|
| NIFTY 50   | `NSE_40000001`  | `NIDX:26000` |
| SENSEX     | `BSE_40000006`  | `BIDX:1`     |

- **Indicator timeframe**: 5-minute candles (`CANDLE_INTERVAL = "5minute"`)
- **EMA period**: 9 (`EMA_PERIOD`)
- **REST polling interval**: 5,000 ms (fallback for prices/EMA9)
- **Market hours** (IST, for VWAP reset context): 9:15 AM – 3:30 PM

## Notes on reliability

- Android may kill the foreground service under aggressive battery
  optimization (some OEMs like Xiaomi/Oppo are notorious for this). If alerts
  stop coming through, check your phone's battery settings and exempt this
  app from optimization ("Unrestricted" battery usage).
- On **web**, the app relies on the REST polling fallback because browsers
  cannot attach a custom `Authorization` header to the WebSocket open
  handshake. Keep the tab open to keep monitoring; browser notifications
  require you to allow them.
- The INDstocks API rate limits data requests
  (5 req/s for quotes, 100,000/day). The 5s polling here stays well under
  these limits, but avoid starting multiple instances at once.
- The app uses both a WebSocket feed and REST polling, so a flaky WebSocket
  won't stop price/alert updates entirely.
- Indicator results are computed from the day's 5-minute candles and reset
  each market session.

## Disclaimer

For personal/educational use. Indicators are computed from live market data
but this is **not** investment advice. Always do your own research before
trading.
# market_alert
