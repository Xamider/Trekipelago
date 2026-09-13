import { useEffect, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from './ui';
import { getTreasureMinigame, getEffectDetails, getTreasureReward } from '../game/engine';
import type { TreasureBox } from '../game/types';
import { theme } from '../theme';

type Props = {
  box: TreasureBox;
  anchor: { x: number; y: number };
  viewport: { width: number; height: number };
  canCollect: boolean;
  rewardAvailable: boolean;
  collectionHint: string;
  disabled: boolean;
  onClose: () => void;
  onCollect: () => Promise<boolean>;
  onRemove: () => Promise<void>;
};

export function TreasurePopup({ box, anchor, viewport, canCollect, rewardAvailable, collectionHint, disabled,
  onClose, onCollect, onRemove }: Props) {
  const game = getTreasureMinigame(box);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [height, setHeight] = useState(0);
  const insets = useSafeAreaInsets();
  const reward = getTreasureReward(box);
  const details = getEffectDetails(reward.type);
  const width = Math.min(320, Math.max(0, viewport.width - 24));
  const topEdge = insets.top + 12;
  const bottomEdge = viewport.height - insets.bottom - 12;
  const maxHeight = Math.max(0, bottomEdge - topEdge - 2);
  const above = anchor.y - height - 30 >= topEdge;
  const desiredTop = above ? anchor.y - height - 30 : anchor.y + 30;
  const top = Math.max(topEdge, Math.min(desiredTop, bottomEdge - height));
  const left = Math.max(12, Math.min(anchor.x - width / 2, viewport.width - width - 12));
  const arrowLeft = Math.max(20, Math.min(anchor.x - left - 7, width - 34));
  const pending = disabled || working;

  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => listener.remove();
  }, [onClose]);

  const run = async (action: () => Promise<void | boolean>) => {
    if (pending) return;
    setWorking(true);
    setActionError(null);
    try {
      const result = await action();
      if (result === false) setActionError('Check tracking and GPS, then try again.');
      else onClose();
    }
    finally { setWorking(false); }
  };

  return <View style={styles.overlay} accessibilityViewIsModal>
    <Pressable style={StyleSheet.absoluteFill} onPress={onClose}
      accessibilityRole="button" accessibilityLabel="Close treasure information" />
    <View style={[styles.bubble, { width, top, left, opacity: height ? 1 : 0 }]}
      onLayout={event => setHeight(event.nativeEvent.layout.height)}>
      <View pointerEvents="none" style={[styles.arrow, { left: arrowLeft }, above ? styles.arrowBelow : styles.arrowAbove]} />
      <ScrollView style={{ maxHeight }} contentContainerStyle={styles.content} bounces={false}>
        <View style={styles.heading}>
          <View style={styles.icon}><Feather name="package" size={22} color={theme.colors.primary} /></View>
          <AppText style={styles.title}>Treasure box</AppText>
          <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close treasure information">
            <Feather name="x" size={20} color={theme.colors.secondary} />
          </Pressable>
        </View>
        <View style={styles.reward}>
          <AppText style={styles.rewardTitle}>{rewardAvailable ? details.name : 'Reward limit reached'}</AppText>
          {rewardAvailable && <View style={styles.duration}><Feather name="clock" size={13} color={theme.colors.primary} />
            <AppText style={styles.durationText}>{(reward.durationMs ?? 0) / 60000} minutes</AppText></View>}
          <AppText style={styles.description}>{rewardAvailable ? details.description : 'You can still play a minigame. The box will count as collected, but no item will be awarded.'}</AppText>
        </View>
        {actionError && <AppText style={styles.removeText}>{actionError}</AppText>}
        {confirmRemove ? <>
          <AppText style={styles.confirmTitle} accessibilityLiveRegion="polite">Remove this box?</AppText>
          <AppText style={styles.description}>No reward will be collected. New boxes will only appear at the next scheduled spawn, even if you collect the remaining boxes.</AppText>
          <View style={styles.actions}>
            <Pressable style={styles.secondaryButton} disabled={working} onPress={() => setConfirmRemove(false)} accessibilityRole="button">
              <AppText style={styles.secondaryText}>Keep box</AppText>
            </Pressable>
            <Pressable style={[styles.removeButton, pending && styles.disabled]} disabled={pending}
              onPress={() => { void run(onRemove); }} accessibilityRole="button" accessibilityLabel="Confirm removal of treasure box">
              <Feather name="trash-2" size={15} color={theme.colors.danger} />
              <AppText style={styles.removeText}>Remove</AppText>
            </Pressable>
          </View>
        </> : <>
          <AppText style={styles.hint}>{collectionHint}</AppText>
          <AppText style={styles.secondaryText}>{game.kind === 'maze' ? 'Labyrinth' : 'Tower defense'}</AppText>
          <View style={styles.actions}>
            <Pressable style={[styles.secondaryButton, pending && styles.disabled]} disabled={pending}
              onPress={() => setConfirmRemove(true)} accessibilityRole="button" accessibilityLabel="Remove treasure box">
              <Feather name="trash-2" size={15} color={theme.colors.danger} />
              <AppText style={styles.removeText}>Remove</AppText>
            </Pressable>
            <Pressable style={[styles.collectButton, (!canCollect || pending) && styles.disabled]} disabled={!canCollect || pending}
              onPress={() => { void run(onCollect); }} accessibilityRole="button" accessibilityLabel="Start treasure minigame">
              <AppText style={styles.collectText}>Play</AppText>
            </Pressable>
          </View>
        </>}
      </ScrollView>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, zIndex: 30 },
  bubble: { position: 'absolute', backgroundColor: theme.colors.surface, borderWidth: 1,
    borderColor: theme.colors.subtle, borderRadius: 18, elevation: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 12 },
  arrow: { position: 'absolute', width: 14, height: 14, backgroundColor: theme.colors.surface,
    transform: [{ rotate: '45deg' }], borderColor: theme.colors.subtle },
  arrowBelow: { bottom: -8, borderBottomWidth: 1, borderRightWidth: 1 },
  arrowAbove: { top: -8, borderTopWidth: 1, borderLeftWidth: 1 },
  content: { padding: 16, gap: 12 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { padding: 8, borderRadius: 10, backgroundColor: theme.colors.background },
  title: { flex: 1, fontFamily: theme.fonts.display, fontSize: 19, color: theme.colors.text },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  reward: { gap: 8, padding: 12, borderRadius: 12, backgroundColor: theme.colors.background },
  rewardTitle: { fontFamily: theme.fonts.bold, fontSize: 16, color: theme.colors.primary },
  duration: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  durationText: { fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.secondary },
  description: { fontSize: 13, lineHeight: 19, color: theme.colors.text },
  hint: { minHeight: 36, fontSize: 12, lineHeight: 18, color: theme.colors.muted },
  confirmTitle: { fontFamily: theme.fonts.bold, fontSize: 15, color: theme.colors.danger },
  actions: { flexDirection: 'row', gap: 10 },
  secondaryButton: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border },
  secondaryText: { fontFamily: theme.fonts.bold, color: theme.colors.text, fontSize: 13 },
  removeButton: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: 10, borderWidth: 1, borderColor: theme.colors.danger },
  removeText: { fontFamily: theme.fonts.bold, color: theme.colors.danger, fontSize: 13 },
  collectButton: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: theme.colors.primary },
  collectText: { fontFamily: theme.fonts.bold, color: theme.colors.background, fontSize: 13 },
  disabled: { opacity: 0.4 },
});
