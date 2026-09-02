import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
} from "react-native";
import { API_TOKEN } from "./config";
import {
  startTicker,
  stopTicker,
  getData,
  onData,
  onCross,
  onStatus,
} from "./tickerService";

function formatNum(n) {
  if (!n || n === 0) return "--";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 1 });
}

function formatVol(v) {
  if (!v) return "--";
  if (v >= 1e7) return (v / 1e7).toFixed(1) + "Cr";
  if (v >= 1e5) return (v / 1e5).toFixed(1) + "L";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return v.toString();
}

function IndexCard({ label, data }) {
  const isUp = data.direction === "above";
  const changeColor = isUp ? "#00c853" : "#ff1744";
  const arrow = isUp ? "^" : "v";

  const dayChange =
    data.open > 0 ? (((data.price - data.open) / data.open) * 100).toFixed(2) : "0.00";

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardLabel}>{label}</Text>
        <Text style={[styles.cardArrow, { color: changeColor }]}>{arrow}</Text>
      </View>

      <Text style={[styles.cardPrice, { color: changeColor }]}>
        {formatNum(data.price)}
      </Text>
      <Text style={[styles.cardChange, { color: changeColor }]}>
        {dayChange > 0 ? "+" : ""}
        {dayChange}%
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

export default function App() {
  const [status, setStatus] = useState("Not started");
  const [running, setRunning] = useState(false);
  const initialData = getData();
  const [nifty, setNifty] = useState(initialData.NIFTY);
  const [sensex, setSensex] = useState(initialData.SENSEX);
  const [session, setSession] = useState(initialData.session);
  const [lastCross, setLastCross] = useState(null);
  const [hasApiKey, setHasApiKey] = useState(true);

  useEffect(() => {
    if (!API_TOKEN) {
      setHasApiKey(false);
      setStatus("Missing INDMONEY_API_KEY in .env");
    }
  }, []);

  useEffect(() => {
    onData((d) => {
      setNifty(d.NIFTY);
      setSensex(d.SENSEX);
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
    });

    onStatus((s) => setStatus(s));
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
    setSession(current.session);
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>NIFTY / SENSEX Screener</Text>
        <Text style={styles.subtitle}>VWAP + EMA9 Cross Detector</Text>

        {!hasApiKey && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>
              Set INDMONEY_API_KEY in your .env file{"\n"}
              (INDstocks access token from indstocks.com)
            </Text>
          </View>
        )}

        {running && session && (
          <View style={styles.sessionBar}>
            <View style={styles.sessionBox}>
              <Text style={styles.sessionLabel}>6H Session Timer</Text>
              <Text style={styles.sessionValue}>⏱️ {session.formattedTime}</Text>
            </View>
            <View style={styles.sessionBox}>
              <Text style={styles.sessionLabel}>Crossovers</Text>
              <Text style={styles.sessionValueCount}>⚡ {session.crossCount}</Text>
            </View>
          </View>
        )}

        <View style={styles.cardsRow}>
          <IndexCard label="NIFTY 50" data={nifty} />
          <IndexCard label="SENSEX" data={sensex} />
        </View>

        {lastCross && (
          <View style={styles.crossAlert}>
            <Text style={styles.crossAlertTitle}>Last Cross Detected</Text>
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
              Price {formatNum(lastCross.price)} | VWAP {formatNum(lastCross.vwap)} | EMA9{" "}
              {formatNum(lastCross.ema)}
            </Text>
            <Text style={styles.crossAlertTime}>{lastCross.time}</Text>
          </View>
        )}

        {!running ? (
          <TouchableOpacity
            style={[styles.button, styles.startButton]}
            onPress={handleStart}
            disabled={!hasApiKey}
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

        <Text style={styles.status}>{status}</Text>

        <Text style={styles.hint}>
          Tracks NIFTY 50 and SENSEX in real-time using INDstocks WebSocket for 6 hours.
          Computes VWAP and EMA9 on 5-minute candles. Plays instant sound alerts when EMA9 crosses
          VWAP and tracks total crossover count in the persistent top notification panel.
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
    marginBottom: 16,
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
  },
  hint: {
    fontSize: 11,
    color: "#484f58",
    textAlign: "center",
    lineHeight: 16,
  },
});
