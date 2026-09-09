import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AppText } from './ui';
import { getEffectDetails } from '../game/engine';
import { theme } from '../theme';

interface EffectTooltipProps {
  effectType: string | null;
  level?: number;
  expiresAt?: number;
  onClose: () => void;
}

export function EffectTooltip({ effectType, level = 0, expiresAt, onClose }: EffectTooltipProps) {
  if (!effectType) return null;

  const info = getEffectDetails(effectType, level);
  const remainingSec = expiresAt ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)) : null;
  const remainingStr = remainingSec !== null
    ? `${Math.floor(remainingSec / 60)}:${String(remainingSec % 60).padStart(2, '0')}`
    : null;

  const isTrap = info.isTrap || effectType.startsWith('trap_');
  const isPermanent = effectType === 'unlock_background' || effectType === 'passive_collector' || effectType === 'progressive_speed';

  const accentColor = isTrap
    ? '#ef4444'
    : isPermanent
      ? (effectType === 'unlock_background' ? '#34d399' : effectType === 'passive_collector' ? '#c084fc' : '#38bdf8')
      : '#70F40B';

  const getIconName = (): keyof typeof Feather.glyphMap => {
    if (isTrap) {
      if (effectType === 'trap_blind') return 'eye-off';
      if (effectType === 'trap_slow') return 'activity';
      if (effectType === 'trap_distance_half' || effectType === 'trap_distance') return 'trending-down';
      if (effectType === 'trap_drop_half' || effectType === 'trap_orbs') return 'zap-off';
      return 'alert-triangle';
    }
    if (effectType === 'unlock_background') return 'check-circle';
    if (effectType === 'passive_collector') return 'cpu';
    if (effectType === 'progressive_speed') return 'trending-up';
    if (effectType === 'speed_up') return 'activity';
    if (effectType === 'boost_distance_2x') return 'trending-up';
    if (effectType === 'boost_drop_2x') return 'zap';
    return 'info';
  };

  const tagLabel = isTrap
    ? 'TRAP'
    : isPermanent
      ? 'PERMANENT PERK'
      : 'TEMPORARY BOOST';

  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.bubble, { borderColor: accentColor }]}>
        <View style={styles.header}>
          <View style={[styles.iconContainer, { backgroundColor: `${accentColor}25` }]}>
            <Feather name={getIconName()} size={16} color={accentColor} />
          </View>
          <View style={styles.titleArea}>
            <View style={styles.tagRow}>
              <View style={[styles.tagBadge, { backgroundColor: `${accentColor}20`, borderColor: accentColor }]}>
                <AppText style={[styles.tagText, { color: accentColor }]}>{tagLabel}</AppText>
              </View>
              {remainingStr && (
                <View style={styles.timerBadge}>
                  <Feather name="clock" size={10} color={theme.colors.muted} />
                  <AppText style={styles.timerText}>{remainingStr}</AppText>
                </View>
              )}
            </View>
            <AppText style={styles.title}>{info.name}</AppText>
          </View>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            style={styles.closeButton}
            accessibilityRole="button"
            accessibilityLabel="Close tooltip">
            <Feather name="x" size={18} color={theme.colors.muted} />
          </Pressable>
        </View>

        <AppText style={styles.description}>{info.description}</AppText>

        <Pressable onPress={onClose} style={styles.dismissHint}>
          <AppText style={styles.dismissHintText}>Tap anywhere to dismiss</AppText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    ...StyleSheet.absoluteFill,
    zIndex: 99,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(5, 12, 2, 0.65)',
  },
  bubble: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: 'rgba(13, 23, 3, 0.96)',
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 16,
    gap: 12,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleArea: {
    flex: 1,
    gap: 4,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tagBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 0.5,
  },
  tagText: {
    fontSize: 9,
    fontWeight: 'bold',
    fontFamily: theme.fonts.mono,
    letterSpacing: 0.5,
  },
  timerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  timerText: {
    fontSize: 10,
    fontFamily: theme.fonts.mono,
    color: theme.colors.muted,
  },
  title: {
    fontSize: 15,
    fontWeight: 'bold',
    color: theme.colors.text,
  },
  closeButton: {
    padding: 4,
  },
  description: {
    fontSize: 13,
    lineHeight: 19,
    color: '#e2e8f0',
  },
  dismissHint: {
    alignSelf: 'center',
    paddingTop: 4,
  },
  dismissHintText: {
    fontSize: 11,
    color: theme.colors.muted,
  },
});
