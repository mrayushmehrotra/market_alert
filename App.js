import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  LogBox,
  Platform,
} from "react-native";
import { API_TOKEN } from "./config";
import {
  startTicker,
  stopTicker,
  getData,
  onData,
  onCross,
  onStatus,
  updateIndstocksToken,
} from "./tickerService";
import { playAlertSound } from "./notifications";

LogBox.ignoreLogs([
  "[Ticker]",
  "[CoinDCX Poll]",
  "[Poll]",
  "[WS]",
  "Historical data fetch failed",
  "notifee",
]);

function formatNum(n, isCurrency = false) {
  if (!n || n === 0) return "--";
  return n.toLocaleString("en-US", { maximumFractionDigits: isCurrency ? 2 : 1 });
}

function formatVol(v) {
  if (!v) return "--";
  if (v >= 1e7) return (v / 1e7).toFixed(1) + "Cr";
  if (v >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (v >= 1e5) return (v / 1e5).toFixed(1) + "L";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return v.toFixed(2);
}

// Market card for Indian indices (NIFTY, SENSEX) — shows VWAP + EMA9
function IndexCard({ label, data }) {
  if (!data) return null;
  const isUp = data.direction === "above";
  const changeColor = isUp ? "#00c853" : "#ff1744";
  const arrow = isUp ? "▲" : "▼";
  const changeVal = data.change || 0;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardLabel}>{label}</Text>
        <Text style={[styles.cardArrow, { color: changeColor }]}>{arrow}</Text>
      </View>

      <Text style={[styles.cardPrice, { color: changeColor }]}>
        {formatNum(data.price)}
      </Text>
      <Text style={[styles.cardChange, { color: changeVal >= 0 ? "#00c853" : "#ff1744" }]}>
        {changeVal >= 0 ? "+" : ""}
        {changeVal.toFixed(2)}%
      </Text>

      <View style={styles.divider} />

      <View style={styles.indicatorRow}>
        <Text style={styles.indicatorLabel}>VWAP</Text>
        <Text style={styles.indicatorValue}>{formatNum(data.vwap)}</Text>
      </View>

      <View style={styles.indicatorRow}>
        <Text style={styles.indicatorLabel}>EMA9</Text>
        <Text style={styles.indicatorValue}>{formatNum(data.ema9)}</Text>
      </View>

      <View style={styles.indicatorRow}>
        <Text style={styles.indicatorLabel}>Vol</Text>
        <Text style={styles.indicatorValue}>{formatVol(data.volume)}</Text>
      </View>

      {data.vwap > 0 && data.ema9 > 0 && (
        <View
          style={[
            styles.crossBadge,
            {
              backgroundColor:
                data.ema9 > data.vwap
                  ? "rgba(0,200,83,0.15)"
                  : "rgba(255,23,68,0.15)",
            },
          ]}
        >
          <Text
            style={[
              styles.crossBadgeText,
              { color: data.ema9 > data.vwap ? "#00c853" : "#ff1744" },
            ]}
          >
            EMA9 {data.ema9 > data.vwap ? "above" : "below"} VWAP
          </Text>
        </View>
      )}
    </View>
  );
}

// Market card for crypto (SOL, XAU) — shows Supertrend + SMA
function CryptoCard({ label, data }) {
  if (!data) return null;
  const isBullish = data.supertrendDirection === 1;
  const changeColor = isBullish ? "#00c853" : "#ff1744";
  const arrow = isBullish ? "▲" : "▼";
  const changeVal = data.change || 0;

  // SMA status: is latest daily close above or below SMA?
  const smaAbove = data.lastDailyClose > data.sma;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardLabel}>{label}</Text>
        <Text style={[styles.cardArrow, { color: changeColor }]}>{arrow}</Text>
      </View>

      <Text style={[styles.cardPrice, { color: changeColor }]}>
        ${formatNum(data.price, true)}
      </Text>
      <Text style={[styles.cardChange, { color: changeVal >= 0 ? "#00c853" : "#ff1744" }]}>
        {changeVal >= 0 ? "+" : ""}
        {changeVal.toFixed(2)}%
      </Text>

      <View style={styles.divider} />

      <View style={styles.indicatorRow}>
        <Text style={styles.indicatorLabel}>Supertrend (4H)</Text>
        <Text style={[styles.indicatorValue, { color: isBullish ? "#00c853" : "#ff1744" }]}>
          ${formatNum(data.supertrend, true)}
        </Text>
      </View>

      <View style={styles.indicatorRow}>
        <Text style={styles.indicatorLabel}>SMA 18 (1D)</Text>
        <Text style={styles.indicatorValue}>${formatNum(data.sma, true)}</Text>
      </View>

      <View style={styles.indicatorRow}>
        <Text style={styles.indicatorLabel}>Vol</Text>
        <Text style={styles.indicatorValue}>{formatVol(data.volume)}</Text>
      </View>

      {/* Supertrend direction badge */}
      <View
        style={[
          styles.crossBadge,
          {
            backgroundColor: isBullish
              ? "rgba(0,200,83,0.15)"
              : "rgba(255,23,68,0.15)",
          },
        ]}
      >
        <Text
          style={[
            styles.crossBadgeText,
            { color: isBullish ? "#00c853" : "#ff1744" },
          ]}
        >
          {isBullish ? "🟢 Supertrend Bullish" : "🔴 Supertrend Bearish"}
        </Text>
      </View>

      {/* SMA status badge */}
      {data.sma > 0 && (
        <View
          style={[
            styles.crossBadge,
            {
              backgroundColor: smaAbove
                ? "rgba(88,166,255,0.15)"
                : "rgba(139,148,158,0.15)",
              marginTop: 4,
            },
          ]}
        >
          <Text
            style={[
              styles.crossBadgeText,
              { color: smaAbove ? "#58a6ff" : "#8b949e" },
            ]}
          >
            1D Close {smaAbove ? "above" : "below"} SMA
          </Text>
        </View>
      )}
    </View>
  );
}

export default function App() {
  const [status, setStatus] = useState("Not started");
  const [running, setRunning] = useState(false);
  const initialData = getData();
  const [nifty, setNifty] = useState(initialData.NIFTY);
  const [sensex, setSensex] = useState(initialData.SENSEX);
  const [sol, setSol] = useState(initialData.SOL);
  const [xau, setXau] = useState(initialData.XAU);
  const [session, setSession] = useState(initialData.session);
  const [lastCross, setLastCross] = useState(null);
  const [tokenInput, setTokenInput] = useState("");
  const [showTokenBox, setShowTokenBox] = useState(false);

  useEffect(() => {
    onData((d) => {
      setNifty(d.NIFTY);
      setSensex(d.SENSEX);
      setSol(d.SOL);
      setXau(d.XAU);
      setSession(d.session);
      if (d.session) {
        setRunning(d.session.running);
      }
    });

    onCross((crossEvent) => {
      setLastCross({
        ...crossEvent,
        time: new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }),
      });
      playAlertSound();
    });

    onStatus((s) => {
      setStatus(s);
      if (typeof s === "string" && s.includes("Token Expired")) {
        setShowTokenBox(true);
      }
    });
  }, []);

  async function handleStart() {
    setRunning(true);
    await startTicker();
  }

  async function handleStop() {
    await stopTicker();
    setRunning(false);
    setStatus("Stopped");
    const current = getData();
    setNifty(current.NIFTY);
    setSensex(current.SENSEX);
    setSol(current.SOL);
    setXau(current.XAU);
    setSession(current.session);
  }

  async function handleTokenSave() {
    if (!tokenInput.trim()) return;
    await updateIndstocksToken(tokenInput.trim());
    setShowTokenBox(false);
    setTokenInput("");
  }

  const isTokenExpired = status.includes("403") || status.includes("expired");

  // Format cross alert detail text based on type
  function renderCrossDetails() {
    if (!lastCross) return null;
    const isCrypto = lastCross.label?.includes("SOL") || lastCross.label?.includes("XAU");
    const prefix = isCrypto ? "$" : "";

    if (lastCross.type === "supertrend") {
      return (
        <>
          <Text
            style={[
              styles.crossAlertBody,
              { color: lastCross.cross === "bullish" ? "#00c853" : "#ff1744" },
            ]}
          >
            {lastCross.label}: Supertrend flipped{" "}
            {lastCross.cross === "bullish" ? "BULLISH 🟢" : "BEARISH 🔴"}
          </Text>
          <Text style={styles.crossAlertDetails}>
            Price {prefix}{formatNum(lastCross.price, isCrypto)} | Supertrend {prefix}{formatNum(lastCross.supertrend, isCrypto)}
          </Text>
        </>
      );
    }

    if (lastCross.type === "sma") {
      return (
        <>
          <Text
            style={[
              styles.crossAlertBody,
              { color: lastCross.cross === "bullish" ? "#00c853" : "#ff1744" },
            ]}
          >
            {lastCross.label}: 1D Candle closed{" "}
            {lastCross.cross === "bullish" ? "ABOVE" : "below"} SMA
          </Text>
          <Text style={styles.crossAlertDetails}>
            Close {prefix}{formatNum(lastCross.price, isCrypto)} | SMA {prefix}{formatNum(lastCross.sma, isCrypto)}
          </Text>
        </>
      );
    }

    // Default: EMA/VWAP cross (Indian stocks)
    return (
      <>
        <Text
          style={[
            styles.crossAlertBody,
            { color: lastCross.cross === "bullish" ? "#00c853" : "#ff1744" },
          ]}
        >
          {lastCross.label}: EMA9 crossed{" "}
          {lastCross.cross === "bullish" ? "ABOVE" : "below"} VWAP
        </Text>
        <Text style={styles.crossAlertDetails}>
          Price {formatNum(lastCross.price)} | VWAP {formatNum(lastCross.vwap)} | EMA9 {formatNum(lastCross.ema)}
        </Text>
      </>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Multi-Asset Screener</Text>
        <Text style={styles.subtitle}>NIFTY • SENSEX • SOL/USDT • XAU/USDT</Text>

        {(isTokenExpired || showTokenBox) && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>
              INDstocks Token Expired or Invalid (HTTP 403){"\n"}
              Paste a fresh token from indstocks.com below:
            </Text>
            <TextInput
              style={styles.tokenInput}
              placeholder="Paste INDstocks Access Token"
              placeholderTextColor="#8b949e"
              value={tokenInput}
              onChangeText={setTokenInput}
              autoCapitalize="none"
              autoCorrect={false}
              multiline={false}
            />
            <TouchableOpacity style={styles.saveTokenButton} onPress={handleTokenSave}>
              <Text style={styles.saveTokenButtonText}>Update Token & Connect</Text>
            </TouchableOpacity>
          </View>
        )}

        {running && session && (
          <View style={styles.sessionBar}>
            <View style={styles.sessionBox}>
              <Text style={styles.sessionLabel}>6H Session Timer</Text>
              <Text style={styles.sessionValue}>⏱️ {session.formattedTime}</Text>
            </View>
            <View style={styles.sessionBox}>
              <Text style={styles.sessionLabel}>Signals</Text>
              <Text style={styles.sessionValueCount}>⚡ {session.crossCount}</Text>
            </View>
          </View>
        )}

        {/* Indian Indices Row */}
        <View style={styles.cardsRow}>
          <IndexCard label="NIFTY 50" data={nifty} />
          <IndexCard label="SENSEX" data={sensex} />
        </View>

        {/* Crypto Row */}
        <View style={styles.cardsRow}>
          <CryptoCard label="SOL / USDT" data={sol} />
          <CryptoCard label="XAU / USDT" data={xau} />
        </View>

        {lastCross && (
          <View style={styles.crossAlert}>
            <Text style={styles.crossAlertTitle}>Last Signal Detected</Text>
            {renderCrossDetails()}
            <Text style={styles.crossAlertTime}>{lastCross.time}</Text>
          </View>
        )}

        {!running ? (
          <TouchableOpacity
            style={[styles.button, styles.startButton]}
            onPress={handleStart}
          >
            <Text style={styles.buttonText}>Start 6-Hour Monitoring</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.button, styles.stopButton]}
            onPress={handleStop}
          >
            <Text style={styles.buttonText}>Stop Monitoring</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity onPress={() => setShowTokenBox(!showTokenBox)}>
          <Text style={styles.updateTokenLink}>
            {showTokenBox ? "Hide Token Input" : "🔑 Change / Update INDstocks Token"}
          </Text>
        </TouchableOpacity>

        <Text style={styles.status}>{status}</Text>

        <Text style={styles.hint}>
          Tracks NIFTY 50 & SENSEX (EMA9/VWAP on 5m candles) and SOL/USDT & XAU/USDT
          (Supertrend on 4H + SMA 20 on 1D). Plays instant sound alerts on crossovers,
          Supertrend flips, and SMA crosses. 6-hour monitoring session with persistent
          notification panel.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0d1117",
  },
  scroll: {
    padding: 20,
    alignItems: "center",
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#e6edf3",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: "#7d8590",
    marginBottom: 20,
  },
  sessionBar: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
    marginBottom: 16,
  },
  sessionBox: {
    flex: 1,
    backgroundColor: "#161b22",
    borderColor: "#238636",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
  },
  sessionLabel: {
    fontSize: 11,
    color: "#8b949e",
    marginBottom: 4,
    textTransform: "uppercase",
    fontWeight: "600",
  },
  sessionValue: {
    fontSize: 16,
    fontWeight: "700",
    color: "#58a6ff",
  },
  sessionValueCount: {
    fontSize: 16,
    fontWeight: "700",
    color: "#2ea043",
  },
  cardsRow: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
    marginBottom: 12,
  },
  card: {
    flex: 1,
    backgroundColor: "#161b22",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#30363d",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  cardLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#7d8590",
  },
  cardArrow: {
    fontSize: 16,
    fontWeight: "700",
  },
  cardPrice: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 2,
  },
  cardChange: {
    fontSize: 13,
    marginBottom: 10,
  },
  divider: {
    height: 1,
    backgroundColor: "#30363d",
    marginBottom: 10,
  },
  indicatorRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  indicatorLabel: {
    fontSize: 12,
    color: "#7d8590",
  },
  indicatorValue: {
    fontSize: 12,
    color: "#e6edf3",
    fontWeight: "500",
  },
  crossBadge: {
    marginTop: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    alignItems: "center",
  },
  crossBadgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  crossAlert: {
    width: "100%",
    backgroundColor: "#161b22",
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#30363d",
  },
  crossAlertTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "#7d8590",
    marginBottom: 4,
  },
  crossAlertBody: {
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 4,
  },
  crossAlertDetails: {
    fontSize: 12,
    color: "#7d8590",
  },
  crossAlertTime: {
    fontSize: 11,
    color: "#484f58",
    marginTop: 4,
  },
  button: {
    width: "100%",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    marginBottom: 12,
  },
  startButton: {
    backgroundColor: "#238636",
  },
  stopButton: {
    backgroundColor: "#da3633",
  },
  buttonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  status: {
    fontSize: 12,
    color: "#7d8590",
    marginBottom: 16,
    textAlign: "center",
  },
  errorBox: {
    width: "100%",
    backgroundColor: "rgba(218,54,51,0.15)",
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(218,54,51,0.4)",
  },
  errorText: {
    color: "#f85149",
    fontSize: 13,
    textAlign: "center",
    marginBottom: 8,
  },
  tokenInput: {
    backgroundColor: "#0d1117",
    color: "#e6edf3",
    borderColor: "#30363d",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 12,
    marginBottom: 8,
  },
  saveTokenButton: {
    backgroundColor: "#238636",
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: "center",
  },
  saveTokenButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
  },
  updateTokenLink: {
    color: "#58a6ff",
    fontSize: 12,
    marginBottom: 12,
    textAlign: "center",
  },
  hint: {
    fontSize: 11,
    color: "#484f58",
    textAlign: "center",
    lineHeight: 16,
    marginBottom: 20,
  },
});
