import { Pressable, StyleSheet, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { AppScreen, AppText, AssetIcon } from '../components/ui';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { theme } from '../theme';

export function HomeScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Home'>) {
  return <AppScreen topo>
    <View style={styles.brand}>
      <View style={styles.badge}><AssetIcon name="homeCompass" size={32} /></View>
      <AppText style={styles.title}>Trekipelago</AppText>
      <View style={styles.tagline}>
        {['Walk.', 'Explore.', 'Connect.'].map((word, index) => <View key={word} style={styles.taglineWord}>
          {index > 0 && <View style={styles.dot} />}
          <AppText style={styles.word}>{word}</AppText>
        </View>)}
      </View>
    </View>
    <View style={styles.menu}>
      {([
        { title: 'Solo', route: 'Solo', icon: 'pin' },
        { title: 'Archipelago', route: 'Archipelago', icon: 'archipelago' },
        { title: 'Settings', route: 'Settings', icon: 'settings' },
      ] as const).map(({ title, route, icon }) => <Pressable key={route} accessibilityRole="button" onPress={() => navigation.navigate(route)}
        style={({ pressed }) => [styles.tile, route === 'Archipelago' && styles.highlighted, pressed && { opacity: 0.75 }]}>
        <View style={styles.tileIcon}><AssetIcon name={icon} size={24} /></View>
        <AppText style={styles.tileTitle}>{title}</AppText>
        <AssetIcon name="chevron" size={18} />
      </Pressable>)}
    </View>
  </AppScreen>;
}

const styles = StyleSheet.create({
  brand: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 20, paddingBottom: 8, gap: 8 },
  badge: { width: 64, height: 64, borderRadius: 20, borderWidth: 2, borderColor: theme.colors.primary, backgroundColor: '#0c2e2d', alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: theme.fonts.black, fontSize: 36, lineHeight: 44, textAlign: 'center' },
  tagline: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  taglineWord: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  word: { fontFamily: theme.fonts.bold, color: theme.colors.primary, textTransform: 'uppercase', fontSize: 12, lineHeight: 17 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: theme.colors.border },
  menu: { paddingHorizontal: 24, paddingBottom: 32, gap: 14 },
  tile: { backgroundColor: theme.colors.background, minHeight: 76, borderWidth: 1.5, borderColor: '#1a2e05', padding: 14, borderRadius: 16, flexDirection: 'row', gap: 12, alignItems: 'center', elevation: 2 },
  highlighted: { borderColor: theme.colors.primary },
  tileIcon: { width: 48, height: 48, borderWidth: 1, borderColor: '#14504e', backgroundColor: '#0d2c2b', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tileTitle: { flex: 1, fontFamily: theme.fonts.display, fontSize: 18, lineHeight: 24 },
});
