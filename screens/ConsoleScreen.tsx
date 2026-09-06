import { FlatList, StyleSheet, View } from 'react-native';

import { AppHeader, AppScreen, AppText, AssetIcon } from '../components/ui';
import { useGame } from '../state/GameProvider';
import { theme } from '../theme';

export function ConsoleScreen() {
  const { save } = useGame();
  const entries = [...(save?.activity ?? [])].sort((left, right) => right.timestamp - left.timestamp);
  return <AppScreen scroll={false}>
    <AppHeader title="Expedition Console" />
    <View style={styles.intro}>
      <AssetIcon name="console" size={24} color={theme.colors.primary} />
      <View style={styles.introText}><AppText style={styles.heading}>Your journey, as it happens</AppText><AppText style={styles.subtitle}>Latest 100 events · saved on this device</AppText></View>
    </View>
    <FlatList data={entries} keyExtractor={item => item.id} contentContainerStyle={styles.list}
      ListEmptyComponent={<View style={styles.empty}><AppText style={styles.subtitle}>Your expedition activity will appear here.</AppText></View>}
      renderItem={({ item }) => <View style={styles.entry}>
        <View style={styles.entryHeader}><AppText style={[styles.kind, item.kind === 'collection' && { color: theme.colors.primary }]}>{item.kind}</AppText>
          <AppText style={styles.timestamp}>{new Date(item.timestamp).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</AppText></View>
        <AppText style={styles.message}>{item.message}</AppText>
      </View>} />
  </AppScreen>;
}

const styles = StyleSheet.create({
  intro: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingVertical: 24, alignItems: 'center' },
  introText: { flex: 1, gap: 4 },
  heading: { fontFamily: theme.fonts.display, fontSize: 18 },
  subtitle: { fontSize: 12, color: theme.colors.muted, lineHeight: 18 },
  list: { paddingHorizontal: 20, paddingBottom: 24, gap: 10, flexGrow: 1 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  entry: { backgroundColor: theme.colors.background, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, padding: 14, gap: 8 },
  entryHeader: { flexDirection: 'row', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' },
  kind: { color: theme.colors.secondary, fontFamily: theme.fonts.mono, fontSize: 10, lineHeight: 15, textTransform: 'uppercase' },
  timestamp: { color: theme.colors.muted, fontFamily: theme.fonts.mono, fontSize: 10, lineHeight: 15 },
  message: { fontSize: 13, lineHeight: 19 },
});
