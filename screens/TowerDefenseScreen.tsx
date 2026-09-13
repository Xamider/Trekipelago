import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Feather } from '@expo/vector-icons';
import { AppButton, AppHeader, AppScreen, AppText, Card } from '../components/ui';
import { getEffectDetails, getTreasureReward, isTreasureAvailable, treasureProgress } from '../game/engine';
import { DEFENSE_STEP_MS, TOWERS, TOWER_LIMIT, enemyPosition, startDefense, stepDefense,
  type DefenseState, type TowerPlacement, type TowerType } from '../game/towerDefense';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useGame } from '../state/GameProvider';
import { theme } from '../theme';

const icons = { pulse: 'zap', cannon: 'target', frost: 'wind', sniper: 'crosshair' } as const;

export function TowerDefenseScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'TowerDefense'>) {
  const { save, completeDefenseChallenge } = useGame();
  const challenge = save?.treasureChallenge?.id === route.params.challengeId && save.treasureChallenge.kind === 'tower_defense'
    ? save.treasureChallenge : null;
  const level = challenge?.defense;
  const initialId = useRef(challenge?.treasureId);
  const box = save?.treasures.find(box => box.id === (challenge?.treasureId ?? initialId.current));
  const [selected, setSelected] = useState<TowerType>('pulse');
  const [towers, setTowers] = useState<TowerPlacement[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  const touchCell = useRef<number | null>(null);
  const [battle, setBattle] = useState<DefenseState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const claimingRef = useRef(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const focused = useIsFocused();
  const { width } = useWindowDimensions();
  const boardSize = Math.max(160, Math.min(width - 40, 400));
  const cellSize = boardSize / 16;
  const running = battle?.status === 'running';
  const progress = save ? treasureProgress(save) : null;
  const back = () => navigation.goBack();

  useEffect(() => {
    const listener = AppState.addEventListener('change', state => setAppActive(state === 'active'));
    return () => listener.remove();
  }, []);

  useEffect(() => {
    if (!running || !level || !focused || !appActive) return;
    const timer = setInterval(() => setBattle(previous => previous ? stepDefense(level, towers, previous) : previous), DEFENSE_STEP_MS);
    return () => clearInterval(timer);
  }, [running, level, towers, focused, appActive]);

  const claim = async () => {
    if (claimingRef.current || battle?.status !== 'won') return;
    claimingRef.current = true;
    setClaiming(true);
    setNotice(null);
    try {
      if (await completeDefenseChallenge(route.params.challengeId, towers)) setFinished(true);
      else setNotice('Stay within collection range with tracking active. Wait for fresh GPS, then try opening the treasure again.');
    } finally { claimingRef.current = false; setClaiming(false); }
  };

  useEffect(() => {
    if (battle?.status === 'won') void claim();
  }, [battle?.status]);

  const pointToCell = (x: number, y: number) => x < 0 || y < 0 || x >= boardSize || y >= boardSize
    ? null : Math.floor(y / cellSize) * 16 + Math.floor(x / cellSize);
  const preview = (x: number, y: number) => {
    touchCell.current = pointToCell(x, y);
    setHover(touchCell.current);
  };
  const place = (cell: number | null) => {
    if (cell === null || !level || battle) return;
    if (level.path.includes(cell)) { setNotice('Place towers beside the path.'); return; }
    const existing = towers.find(tower => tower.cell === cell);
    if (existing) {
      setTowers(existing.type === selected ? towers.filter(tower => tower.cell !== cell)
        : towers.map(tower => tower.cell === cell ? { cell, type: selected } : tower));
    } else {
      if (towers.length === TOWER_LIMIT) { setNotice('Three towers placed. Tap one to remove or replace it.'); return; }
      setTowers([...towers, { cell, type: selected }]);
    }
    setNotice(null);
  };

  return <AppScreen topo>
    <AppHeader title="Treasure defense" onBack={back} />
    <View style={styles.content}>
      {finished ? <Card style={styles.result}>
        <Feather name="shield" size={42} color={theme.colors.primary} />
        <AppText style={styles.title}>Treasure defended!</AppText>
        <AppText style={styles.description}>{box && box.rewardGranted !== false
          ? `${getEffectDetails(getTreasureReward(box).type).name} collected.`
          : 'Reward limit reached. This treasure counts as collected without an item.'}</AppText>
        <AppText style={styles.counter}>{progress?.collected ?? 0} treasures collected</AppText>
        <AppButton title="Return to map" onPress={back} />
      </Card> : !level || !box || !isTreasureAvailable(box) || challenge?.sessionId !== save?.sessionId ? <Card style={styles.result}>
        <AppText style={styles.title}>This defense is no longer active</AppText>
        <AppButton title="Return to map" onPress={back} />
      </Card> : <>
        <View style={styles.intro}>
          <AppText style={styles.title}>Hold the path</AppText>
          <AppText style={styles.description}>Stop {level.enemyCount} enemies and one boss. Let none reach the exit.</AppText>
          <AppText style={styles.counter}>{towers.length}/{TOWER_LIMIT} towers · {battle?.defeated ?? 0}/{level.enemyCount + 1} defeated</AppText>
        </View>
        <View style={styles.palette}>
          {(Object.keys(TOWERS) as TowerType[]).map(type => <Pressable key={type} disabled={!!battle} onPress={() => { setSelected(type); setNotice(null); }}
            accessibilityRole="button" accessibilityLabel={`${TOWERS[type].name}. ${TOWERS[type].description}`}
            accessibilityState={{ selected: selected === type, disabled: !!battle }}
            style={[styles.towerOption, selected === type && { borderColor: TOWERS[type].color }]}>
            <Feather name={icons[type]} size={23} color={TOWERS[type].color} />
            <AppText style={styles.towerName}>{TOWERS[type].name}</AppText>
          </Pressable>)}
        </View>
        <AppText style={styles.description}>{TOWERS[selected].description}. {battle ? 'Watch your defense.' : 'Tap a tower type, then touch a tile to place it. Drag to preview, release to place.'}</AppText>
        <View style={[styles.board, { width: boardSize, height: boardSize }]} accessibilityLabel="16 by 16 tower defense grid"
          onStartShouldSetResponder={() => !battle} onMoveShouldSetResponder={() => !battle}
          onResponderGrant={event => preview(event.nativeEvent.locationX, event.nativeEvent.locationY)}
          onResponderMove={event => preview(event.nativeEvent.locationX, event.nativeEvent.locationY)}
          onResponderRelease={() => { place(touchCell.current); touchCell.current = null; setHover(null); }}
          onResponderTerminate={() => { touchCell.current = null; setHover(null); }} onResponderTerminationRequest={() => false}>
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {Array.from({ length: 256 }, (_, cell) => <View key={cell} style={[styles.tile, {
              left: cell % 16 * cellSize, top: Math.floor(cell / 16) * cellSize, width: cellSize, height: cellSize,
              backgroundColor: level.path.includes(cell) ? '#355019' : theme.colors.background,
              borderColor: hover === cell ? TOWERS[selected].color : theme.colors.border,
              borderWidth: hover === cell ? 2 : 0.3,
            }]} />)}
            {hover !== null && !level.path.includes(hover) && <View style={[styles.range, {
              left: (hover % 16 + 0.5 - TOWERS[selected].range) * cellSize,
              top: (Math.floor(hover / 16) + 0.5 - TOWERS[selected].range) * cellSize,
              width: TOWERS[selected].range * 2 * cellSize, height: TOWERS[selected].range * 2 * cellSize,
              borderColor: TOWERS[selected].color,
            }]} />}
            {towers.map(tower => <View key={tower.cell} style={[styles.tower, {
              left: tower.cell % 16 * cellSize, top: Math.floor(tower.cell / 16) * cellSize,
              width: cellSize, height: cellSize, borderColor: TOWERS[tower.type].color,
            }]}><Feather name={icons[tower.type]} size={cellSize * 0.7} color={TOWERS[tower.type].color} /></View>)}
            {[level.path[0], level.path[level.path.length - 1]].map((cell, index) => <View key={`endpoint-${index}`} style={[styles.endpoint, {
              left: cell % 16 * cellSize, top: Math.floor(cell / 16) * cellSize, width: cellSize, height: cellSize,
            }]}><Feather name={index === 0 ? 'log-in' : 'package'} size={cellSize * 0.7} color={index === 0 ? theme.colors.danger : theme.colors.accent} /></View>)}
            {battle?.shots.map((shot, index) => {
              const x = (shot.from % 16 + 0.5) * cellSize;
              const y = (Math.floor(shot.from / 16) + 0.5) * cellSize;
              const endX = (shot.x + 0.5) * cellSize;
              const endY = (shot.y + 0.5) * cellSize;
              const length = Math.hypot(endX - x, endY - y);
              return <View key={index} style={{ position: 'absolute', left: (x + endX - length) / 2, top: (y + endY) / 2,
                width: length, height: 2, backgroundColor: TOWERS[shot.type].color,
                transform: [{ rotate: `${Math.atan2(endY - y, endX - x)}rad` }] }} />;
            })}
            {battle?.enemies.map(enemy => {
              const point = enemyPosition(level, enemy.progress);
              const size = cellSize * (enemy.boss ? 0.85 : 0.5);
              return <View key={enemy.id} style={[styles.enemy, { left: (point.x + 0.5) * cellSize - size / 2,
                top: (point.y + 0.5) * cellSize - size / 2, width: size, height: size,
                backgroundColor: enemy.boss ? '#fbbf24' : theme.colors.danger,
                borderColor: enemy.slowUntil > battle.tick ? theme.colors.accent : theme.colors.background,
              }]}><View style={[styles.health, { width: `${Math.max(0, enemy.health / (enemy.boss ? 240 : 35)) * 100}%` }]} /></View>;
            })}
          </View>
        </View>
        {!battle && <AppButton title="Start wave" disabled={!towers.length} onPress={() => { setNotice(null); setBattle(startDefense()); }} />}
        {running && <AppText style={styles.counter}>{appActive && focused ? 'Defending...' : 'Paused'}</AppText>}
        {battle?.status === 'lost' && <>
          <AppText style={styles.failure}>An enemy reached the exit. Adjust your towers and try again.</AppText>
          <AppButton title="Rebuild and retry" onPress={() => { setBattle(null); setNotice(null); }} />
        </>}
        {battle?.status === 'won' && <AppButton title="Open treasure" loading={claiming} onPress={() => { void claim(); }} />}
        {notice && <AppText style={styles.failure} accessibilityLiveRegion="polite">{notice}</AppText>}
        {!battle && <AppText style={styles.description}>No money or upgrades. Tap an existing tower with the same type selected to remove it, or choose another type to replace it.</AppText>}
        {progress && progress.rewarded >= progress.limit && <AppText style={styles.description}>Reward limit reached. Winning still increases your collected count.</AppText>}
        <AppButton title="Return to map" secondary onPress={back} disabled={claiming} />
      </>}
    </View>
  </AppScreen>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 8, paddingBottom: 24, gap: 14 },
  intro: { gap: 8, alignItems: 'center' },
  title: { fontFamily: theme.fonts.display, fontSize: 25, color: theme.colors.text, textAlign: 'center' },
  description: { color: theme.colors.secondary, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  counter: { color: theme.colors.primary, fontFamily: theme.fonts.mono, fontSize: 12, textAlign: 'center' },
  palette: { flexDirection: 'row', gap: 6 },
  towerOption: { flex: 1, minHeight: 66, alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, borderRadius: 12 },
  towerName: { fontFamily: theme.fonts.bold, fontSize: 12, color: theme.colors.text },
  board: { alignSelf: 'center', borderRadius: 16, overflow: 'hidden', backgroundColor: theme.colors.background },
  tile: { position: 'absolute' },
  range: { position: 'absolute', borderWidth: 1, borderRadius: 999, backgroundColor: 'rgba(112,244,11,0.08)' },
  tower: { position: 'absolute', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 5, backgroundColor: theme.colors.surface },
  endpoint: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  enemy: { position: 'absolute', borderRadius: 5, borderWidth: 1 },
  health: { position: 'absolute', top: -4, left: 0, height: 2, backgroundColor: theme.colors.primary },
  failure: { color: theme.colors.danger, textAlign: 'center', fontSize: 13, lineHeight: 19 },
  result: { alignItems: 'center', gap: 16, padding: 24 },
});
