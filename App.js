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
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
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
import {
  setCustomSound,
  getCustomSoundInfo,
  playAlertSound,
} from "./notifications";

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

function MarketCard({ label, data, isCrypto = false }) {
  if (!data) return null;
  const isUp = data.direction === "above";
  const changeColor = isUp ? "#00c853" : "#ff1744";
  const arrow = isUp ? "▲" : "▼";
  const changeVal = data.change || 0;
  const prefix = isCrypto ? "$" : "";

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardLabel}>{label}</Text>
        <Text style={[styles.cardArrow, { color: changeColor }]}>{arrow}</Text>
      </View>

      <Text style={[styles.cardPrice, { color: changeColor }]}>
        {prefix}{formatNum(data.price, isCrypto)}
      </Text>
      <Text style={[styles.cardChange, { color: changeVal >= 0 ? "#00c853" : "#ff1744" }]}>
        {changeVal >= 0 ? "+" : ""}
        {changeVal.toFixed(2)}%
      </Text>

      <View style={styles.divider} />

      <View style={styles.indicatorRow}>
        <Text style={styles.indicatorLabel}>VWAP</Text>
        <Text style={styles.indicatorValue}>{prefix}{formatNum(data.vwap, isCrypto)}</Text>
      </View>

      <View style={styles.indicatorRow}>
        <Text style={styles.indicatorLabel}>EMA9</Text>
        <Text style={styles.indicatorValue}>{prefix}{formatNum(data.ema9, isCrypto)}</Text>
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
  const [sol, setSol] = useState(initialData.SOL);
  const [session, setSession] = useState(initialData.session);
  const [lastCross, setLastCross] = useState(null);
  const [tokenInput, setTokenInput] = useState("");
  const [showTokenBox, setShowTokenBox] = useState(false);
  const [soundInfo, setSoundInfo] = useState(getCustomSoundInfo());

  useEffect(() => {
    setSoundInfo(getCustomSoundInfo());
    onData((d) => {
      setNifty(d.NIFTY);
      setSensex(d.SENSEX);
      setSol(d.SOL);
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
    setSol(current.SOL);
    setSession(current.session);
  }

  async function handleTokenSave() {
    if (!tokenInput.trim()) return;
    await updateIndstocksToken(tokenInput.trim());
    setShowTokenBox(false);
    setTokenInput("");
  }

  async function handlePickSound() {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: "audio/*",
        copyToCacheDirectory: true,
      });

      if (!res.canceled && res.assets && res.assets.length > 0) {
        const file = res.assets[0];
        await setCustomSound(file.uri, file.name);
        setSoundInfo(getCustomSoundInfo());
      }
    } catch (err) {
      console.warn("[App] Custom sound pick error:", err.message);
    }
  }

  async function handleResetSound() {
    await setCustomSound(null, null);
    setSoundInfo(getCustomSoundInfo());
  }

  function handleTestSound() {
    playAlertSound();
  }

  const isTokenExpired = status.includes("403") || status.includes("expired");

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Multi-Asset Screener</Text>
        <Text style={styles.subtitle}>NIFTY • SENSEX • SOL/USDT Crossover Alert</Text>

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
              <Text style={styles.sessionLabel}>Crossovers</Text>
              <Text style={styles.sessionValueCount}>⚡ {session.crossCount}</Text>
            </View>
          </View>
        )}

        <View style={styles.cardsRow}>
          <MarketCard label="NIFTY 50" data={nifty} />
          <MarketCard label="SENSEX" data={sensex} />
        </View>

        <View style={styles.singleCardRow}>
          <MarketCard label="SOL / USDT" data={sol} isCrypto={true} />
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
              Price {lastCross.label.includes("SOL") ? "$" : ""}{formatNum(lastCross.price, lastCross.label.includes("SOL"))} | VWAP {lastCross.label.includes("SOL") ? "$" : ""}{formatNum(lastCross.vwap, lastCross.label.includes("SOL"))} | EMA9 {lastCross.label.includes("SOL") ? "$" : ""}{formatNum(lastCross.ema, lastCross.label.includes("SOL"))}
            </Text>
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
          Tracks NIFTY 50, SENSEX, and SOL/USDT in real-time for 6 hours.
          Computes VWAP and EMA9 on 5-minute candles. Plays instant sound alerts when any asset's EMA9 crosses
          VWAP and tracks total crossover count in the persistent top notification panel.
        </Text>

        <View style={styles.soundCard}>
          <Text style={styles.soundCardTitle}>🔔 Alarm Sound Settings</Text>
          <Text style={styles.soundCardStatus}>
            Current Sound: {soundInfo.name}
          </Text>

          <View style={styles.soundButtonsRow}>
            <TouchableOpacity style={styles.soundPickButton} onPress={handlePickSound}>
              <Text style={styles.soundPickButtonText}>📁 Pick Custom Sound (MP3)</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.soundTestButton} onPress={handleTestSound}>
              <Text style={styles.soundTestButtonText}>▶️ Test Sound</Text>
            </TouchableOpacity>
          </View>

          {!soundInfo.isDefault && (
            <TouchableOpacity style={styles.soundResetButton} onPress={handleResetSound}>
              <Text style={styles.soundResetButtonText}>🔄 Reset to Default (notify.mp3)</Text>
            </TouchableOpacity>
          )}
        </View>
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
  singleCardRow: {
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
  soundCard: {
    width: "100%",
    backgroundColor: "#161b22",
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#30363d",
    alignItems: "center",
  },
  soundCardTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#f0f6fc",
    marginBottom: 4,
  },
  soundCardStatus: {
    fontSize: 12,
    color: "#8b949e",
    marginBottom: 12,
  },
  soundButtonsRow: {
    flexDirection: "row",
    gap: 10,
    width: "100%",
    justifyContent: "center",
  },
  soundPickButton: {
    flex: 1,
    backgroundColor: "#1f6feb",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  soundPickButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
  },
  soundTestButton: {
    backgroundColor: "#238636",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  soundTestButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
  },
  soundResetButton: {
    marginTop: 10,
    paddingVertical: 6,
  },
  soundResetButtonText: {
    color: "#f85149",
    fontSize: 12,
  },
});
