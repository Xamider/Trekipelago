import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppButton, AppHeader, AppScreen, AppText, Field, Notice } from '../components/ui';
import { theme } from '../theme';

export function ArchipelagoScreen() {
  const [address, setAddress] = useState('');
  const [port, setPort] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [attempted, setAttempted] = useState(false);

  return <AppScreen>
    <AppHeader title="Archipelago Connect" />
    <View style={styles.hero}><View style={styles.pill}><View style={styles.dot} /><AppText style={styles.pillText}>Disconnected</AppText></View></View>
    <View style={styles.form}>
      <Field label="Server address" value={address} onChangeText={setAddress} placeholder="archipelago.gg" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
      <Field label="Port" value={port} onChangeText={setPort} placeholder="38290" keyboardType="number-pad" />
      <Field label="Username" value={username} onChangeText={setUsername} placeholder="Your slot name" autoCapitalize="none" autoCorrect={false} />
      <Field label="Password" value={password} onChangeText={setPassword} placeholder="Optional server password" autoCapitalize="none" autoCorrect={false} secureTextEntry />
    </View>
    <View style={styles.actions}>
      <AppButton title="Connect to server" onPress={() => setAttempted(true)} />
      {attempted ? <Notice danger><AppText style={styles.noticeTitle}>Connection unavailable{'\n'}</AppText>Connection is not available in this version.</Notice>
        : <AppText style={styles.hint}>Archipelago connections are coming in a future version.</AppText>}
    </View>
  </AppScreen>;
}

const styles = StyleSheet.create({
  hero: { height: 100, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  pill: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 20, backgroundColor: theme.colors.surface, paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.subtle },
  pillText: { fontFamily: theme.fonts.medium, fontSize: 12, lineHeight: 16, textTransform: 'uppercase' },
  form: { paddingHorizontal: 20, gap: 16 },
  actions: { padding: 20, gap: 20 },
  noticeTitle: { fontFamily: theme.fonts.display, fontSize: 14, color: theme.colors.danger },
  hint: { color: theme.colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
