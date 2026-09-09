import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { archipelagoClient, ArchipelagoConnectionStatus } from '../archipelago';
import { AppButton, AppHeader, AppScreen, AppText, Card, Field, Notice } from '../components/ui';
import { repository } from '../storage/database';
import { theme } from '../theme';

export function ArchipelagoScreen() {
  const [address, setAddress] = useState('archipelago.gg');
  const [port, setPort] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<ArchipelagoConnectionStatus>(archipelagoClient.getStatus());
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [savedStats, setSavedStats] = useState<{
    seed?: string;
    checkedCount: number;
    receivedCount: number;
    slot?: number;
  } | null>(null);

  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    // Load persisted configuration and state from SQLite database
    void archipelagoClient.loadPersistedState().then((state) => {
      if (state) {
        if (state.config.host) setAddress(state.config.host);
        if (state.config.port) setPort(state.config.port);
        if (state.config.slotName) setUsername(state.config.slotName);
        if (state.config.password) setPassword(state.config.password);
        setSavedStats({
          seed: state.roomSeed,
          checkedCount: state.checkedLocations?.length || 0,
          receivedCount: state.receivedItems?.length || 0,
          slot: state.slotNumber,
        });
      }
    });

    const unsubStatus = archipelagoClient.onStatusChange((newStatus, detail) => {
      setStatus(newStatus);
      setStatusDetail(detail || null);
      // Refresh stats on status changes
      void repository.readArchipelagoState().then((s) => {
        if (s) {
          setSavedStats({
            seed: s.roomSeed,
            checkedCount: s.checkedLocations?.length || 0,
            receivedCount: s.receivedItems?.length || 0,
            slot: s.slotNumber,
          });
        }
      });
    });

    const unsubLog = archipelagoClient.onLog((msg) => {
      setLogs((prev) => [...prev.slice(-40), msg]);
    });

    const unsubItems = archipelagoClient.onItemReceived(() => {
      void repository.readArchipelagoState().then((s) => {
        if (s) {
          setSavedStats({
            seed: s.roomSeed,
            checkedCount: s.checkedLocations?.length || 0,
            receivedCount: s.receivedItems?.length || 0,
            slot: s.slotNumber,
          });
        }
      });
    });

    return () => {
      unsubStatus();
      unsubLog();
      unsubItems();
    };
  }, []);

  const handleConnect = () => {
    if (!address.trim() || !username.trim()) {
      setStatusDetail('Please enter server address and player slot name.');
      return;
    }
    archipelagoClient.connect({
      host: address.trim(),
      port: port.trim(),
      slotName: username.trim(),
      password: password.trim() || undefined,
    });
  };

  const handleDisconnect = () => {
    archipelagoClient.disconnect();
  };

  const isConnected = status === 'authenticated' || status === 'connected';
  const isConnecting = status === 'connecting';

  const getStatusColor = () => {
    switch (status) {
      case 'authenticated':
        return '#70F40B';
      case 'connected':
        return '#38bdf8';
      case 'connecting':
        return '#facc15';
      case 'error':
        return '#ef4444';
      default:
        return theme.colors.subtle;
    }
  };

  const getStatusLabel = () => {
    switch (status) {
      case 'authenticated':
        return 'Connected & Authenticated';
      case 'connected':
        return 'Connected to server';
      case 'connecting':
        return 'Connecting...';
      case 'error':
        return 'Connection error';
      default:
        return 'Disconnected';
    }
  };

  return (
    <AppScreen>
      <AppHeader title="Archipelago Multiworld" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {/* Status Pill */}
        <View style={styles.hero}>
          <View style={[styles.pill, { borderColor: getStatusColor() }]}>
            <View style={[styles.dot, { backgroundColor: getStatusColor() }]} />
            <AppText style={[styles.pillText, { color: getStatusColor() }]}>{getStatusLabel()}</AppText>
          </View>
        </View>

        {statusDetail && status === 'error' && (
          <Notice danger>
            <AppText style={styles.noticeTitle}>Error: </AppText>
            {statusDetail}
          </Notice>
        )}

        {/* Database Saved Session Card */}
        {savedStats && (savedStats.checkedCount > 0 || savedStats.receivedCount > 0 || savedStats.seed) && (
          <Card style={styles.card}>
            <View style={styles.statsHeader}>
              <Feather name="database" size={14} color={theme.colors.accent} />
              <AppText style={styles.statsTitle}>Saved Database Session</AppText>
            </View>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <AppText style={styles.statLabel}>CHECKS</AppText>
                <AppText style={styles.statValue}>{savedStats.checkedCount}</AppText>
              </View>
              <View style={styles.statItem}>
                <AppText style={styles.statLabel}>RECEIVED ITEMS</AppText>
                <AppText style={styles.statValue}>{savedStats.receivedCount}</AppText>
              </View>
              {savedStats.seed && (
                <View style={styles.statItem}>
                  <AppText style={styles.statLabel}>SEED</AppText>
                  <AppText numberOfLines={1} style={[styles.statValue, styles.seedValue]}>
                    {savedStats.seed}
                  </AppText>
                </View>
              )}
            </View>
          </Card>
        )}

        {/* Connection Form */}
        <Card style={styles.card}>
          <View style={styles.form}>
            <Field
              label="Server address"
              value={address}
              onChangeText={setAddress}
              placeholder="archipelago.gg"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              editable={!isConnected && !isConnecting}
            />
            <Field
              label="Port"
              value={port}
              onChangeText={setPort}
              placeholder="38290"
              keyboardType="number-pad"
              editable={!isConnected && !isConnecting}
            />
            <Field
              label="Slot Name"
              value={username}
              onChangeText={setUsername}
              placeholder="Your player slot name in YAML"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isConnected && !isConnecting}
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder="Optional room password"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              editable={!isConnected && !isConnecting}
            />
          </View>

          <View style={styles.actions}>
            {isConnected || isConnecting ? (
              <AppButton title="Disconnect from server" secondary onPress={handleDisconnect} />
            ) : (
              <AppButton title="Connect to Archipelago" loading={isConnecting} onPress={handleConnect} />
            )}
          </View>
        </Card>

        {/* Live Logs & Server Messages */}
        <Card style={styles.card}>
          <View style={styles.logHeader}>
            <Feather name="terminal" size={14} color={theme.colors.muted} />
            <AppText style={styles.logTitle}>Archipelago Console</AppText>
          </View>
          <ScrollView
            ref={scrollViewRef}
            style={styles.logContainer}
            nestedScrollEnabled
            onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}>
            {logs.length === 0 ? (
              <AppText style={styles.logPlaceholder}>No console logs. Connect to a server.</AppText>
            ) : (
              logs.map((log, i) => (
                <AppText key={i} style={styles.logText}>
                  {log}
                </AppText>
              ))
            )}
          </ScrollView>
        </Card>
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16, paddingBottom: 40 },
  hero: { alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  pill: {
    borderWidth: 1,
    borderRadius: 20,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { fontFamily: theme.fonts.medium, fontSize: 12, lineHeight: 16, textTransform: 'uppercase' },
  card: { gap: 12 },
  form: { gap: 12 },
  actions: { marginTop: 4 },
  noticeTitle: { fontFamily: theme.fonts.display, fontSize: 14, color: theme.colors.danger },
  statsHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statsTitle: { fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.accent, textTransform: 'uppercase' },
  statsRow: { flexDirection: 'row', gap: 16, flexWrap: 'wrap' },
  statItem: { minWidth: 80 },
  statLabel: { fontSize: 10, color: theme.colors.muted, fontFamily: theme.fonts.mono },
  statValue: { fontSize: 16, fontFamily: theme.fonts.display, color: theme.colors.text },
  seedValue: { fontSize: 12, maxWidth: 140 },
  logHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  logTitle: { fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.muted, textTransform: 'uppercase' },
  logContainer: {
    maxHeight: 200,
    minHeight: 100,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderRadius: 8,
    padding: 10,
  },
  logPlaceholder: { fontSize: 11, fontFamily: theme.fonts.mono, color: theme.colors.muted },
  logText: { fontSize: 11, fontFamily: theme.fonts.mono, color: '#e2e8f0', marginBottom: 4 },
});
