import { PropsWithChildren, ReactNode, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleProp, StyleSheet, Text, TextInput, TextInputProps, TextProps, View, ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';

import { designAssets, theme } from '../theme';
import type { RootStackParamList } from '../navigation/AppNavigator';

export function AppText({ style, ...props }: TextProps) {
  return <Text {...props} style={[styles.text, style]} />;
}

export function AssetIcon({ name, size = 24, color }: {
  name: keyof typeof designAssets; size?: number; color?: string;
}) {
  return <Image source={designAssets[name]} style={{ width: size, height: size }} contentFit="contain" tintColor={color} accessibilityIgnoresInvertColors />;
}

export function AppScreen({ children, scroll = true, topo = false, contentStyle }: PropsWithChildren<{
  scroll?: boolean; topo?: boolean; contentStyle?: StyleProp<ViewStyle>;
}>) {
  return (
    <LinearGradient colors={['#0d1703', '#162b07']} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={styles.fill}>
      {topo && <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Image source={designAssets.topo} style={StyleSheet.absoluteFill} contentFit="cover" />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(13,23,3,0.9)' }]} />
      </View>}
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.fill}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
          {scroll ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.scrollContent, contentStyle]}>{children}</ScrollView>
            : <View style={[styles.fill, contentStyle]}>{children}</View>}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

export function AppHeader({ title, onBack, onAction, actionLabel = 'Home' }: {
  title: string; onBack?: () => void; onAction?: () => void; actionLabel?: string;
}) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return <View style={styles.header}>
    <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={4} style={styles.iconButton} onPress={onBack ?? (() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Home'))}>
      <AssetIcon name="back" size={20} />
    </Pressable>
    <AppText style={styles.headerTitle}>{title}</AppText>
    <Pressable accessibilityRole="button" accessibilityLabel={actionLabel} hitSlop={4} style={styles.iconButton} onPress={onAction ?? (() => navigation.navigate('Home'))}>
      <AssetIcon name="compass" size={20} />
    </Pressable>
  </View>;
}

export function AppButton({ title, onPress, disabled = false, loading = false, secondary = false, style }: {
  title: string; onPress: () => void; disabled?: boolean; loading?: boolean; secondary?: boolean; style?: StyleProp<ViewStyle>;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: disabled || loading, busy: loading }} disabled={disabled || loading} onPress={onPress}
    style={({ pressed }) => [styles.button, secondary && styles.secondaryButton, (disabled || loading) && styles.disabled, pressed && styles.pressed, style]}>
    {loading && <ActivityIndicator size="small" color={secondary ? theme.colors.primary : theme.colors.background} />}
    <AppText style={[styles.buttonText, secondary && { color: theme.colors.primary }]}>{title}</AppText>
  </Pressable>;
}

export function Card({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Field({ label, hint, secureTextEntry, style, ...props }: TextInputProps & { label: string; hint?: string }) {
  const [revealed, setRevealed] = useState(false);
  return <View style={styles.field}>
    <AppText style={styles.label}>{label}</AppText>
    <View style={styles.inputContainer}>
      <TextInput {...props} accessibilityLabel={label} secureTextEntry={secureTextEntry && !revealed} placeholderTextColor={theme.colors.muted}
        selectionColor={theme.colors.primary} style={[styles.input, style]} />
      {secureTextEntry && <Pressable accessibilityRole="button" accessibilityLabel={revealed ? 'Hide password' : 'Show password'} accessibilityState={{ selected: revealed }} onPress={() => setRevealed(!revealed)} style={styles.reveal}>
        <AssetIcon name="eyeOff" size={20} color={revealed ? theme.colors.primary : undefined} />
      </Pressable>}
    </View>
    {hint && <AppText style={styles.hint}>{hint}</AppText>}
  </View>;
}

export function SectionLabel({ children }: PropsWithChildren) {
  return <AppText style={styles.label}>{children}</AppText>;
}

export function SettingRow({ label, children, divider = false }: { label: string; children: ReactNode; divider?: boolean }) {
  return <View style={[styles.settingRow, divider && styles.divider]}>
    <AppText style={styles.settingLabel}>{label}</AppText>{children}
  </View>;
}

export function Toggle({ label, value, onChange, disabled = false }: { label: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value, disabled }} onPress={() => onChange(!value)} disabled={disabled}
    style={[styles.toggle, disabled && styles.disabled]}>
    <Image source={value ? designAssets.toggleOn : designAssets.toggleOff} style={{ width: 44, height: 24 }} contentFit="contain" />
  </Pressable>;
}

export function Notice({ children, danger = false }: PropsWithChildren<{ danger?: boolean }>) {
  return <View accessibilityLiveRegion="polite" style={[styles.notice, danger && styles.errorNotice]}>
    {danger && <AssetIcon name="alert" size={20} />}
    <AppText style={[styles.noticeText, danger && { color: '#ffd2d2' }]}>{children}</AppText>
  </View>;
}

export function formatDistance(meters: number, unit: 'km' | 'mi') {
  return `${(meters / (unit === 'mi' ? 1609.344 : 1000)).toFixed(2)} ${unit}`;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  text: { color: theme.colors.text, fontFamily: theme.fonts.body, fontSize: 15, lineHeight: 21 },
  scrollContent: { flexGrow: 1, paddingBottom: 24 },
  header: { minHeight: 56, flexDirection: 'row', gap: 16, alignItems: 'center', paddingHorizontal: 20, paddingVertical: 6 },
  headerTitle: { flex: 1, fontFamily: theme.fonts.display, fontSize: 22, lineHeight: 27 },
  iconButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, justifyContent: 'center', alignItems: 'center' },
  button: { minHeight: 52, borderRadius: 10, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 12, flexDirection: 'row', gap: 8 },
  secondaryButton: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1 },
  buttonText: { fontFamily: theme.fonts.display, fontSize: 16, color: theme.colors.background, textTransform: 'uppercase', textAlign: 'center' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.75 },
  card: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 12, padding: 16 },
  field: { gap: 8 },
  label: { color: theme.colors.secondary, fontFamily: theme.fonts.semibold, textTransform: 'uppercase', fontSize: 13, lineHeight: 17 },
  inputContainer: { minHeight: 48, backgroundColor: theme.colors.background, borderColor: '#1a2e05', borderWidth: 1, borderRadius: 8, flexDirection: 'row', alignItems: 'center' },
  input: { flex: 1, minWidth: 0, paddingHorizontal: 16, paddingVertical: 12, color: theme.colors.text, fontFamily: theme.fonts.body, fontSize: 15 },
  reveal: { width: 44, minHeight: 48, justifyContent: 'center', alignItems: 'center' },
  hint: { color: theme.colors.muted, fontSize: 12, lineHeight: 17 },
  settingRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 4 },
  settingLabel: { flex: 1, fontFamily: theme.fonts.medium },
  divider: { borderTopWidth: 1, borderTopColor: theme.colors.border },
  toggle: { minWidth: 48, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  notice: { flexDirection: 'row', gap: 12, padding: 16, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: 'rgba(20,36,5,0.6)' },
  errorNotice: { backgroundColor: 'rgba(229,9,20,0.08)', borderColor: 'rgba(229,9,20,0.3)' },
  noticeText: { flex: 1, color: theme.colors.secondary, fontSize: 12, lineHeight: 18 },
});
