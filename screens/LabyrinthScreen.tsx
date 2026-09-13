import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppButton, AppHeader, AppScreen, AppText, Card } from '../components/ui';
import { getEffectDetails, getTreasureReward, isTreasureAvailable, treasureProgress } from '../game/engine';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useGame } from '../state/GameProvider';
import { theme } from '../theme';
import { moveMazePath, swipeMazePath } from '../game/maze';

export function LabyrinthScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'Labyrinth'>) {
  const { save, completeTreasureChallenge } = useGame();
  const [path, setPath] = useState([0]);
  const [working, setWorking] = useState(false);
  const [finished, setFinished] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const claiming = useRef(false);
  const [boardSpace, setBoardSpace] = useState({ width: 0, height: 0 });
  const challenge = save?.treasureChallenge?.id === route.params.challengeId ? save.treasureChallenge : null;
  const initialTreasureId = useRef(challenge?.treasureId);
  const box = save?.treasures.find(box => box.id === (challenge?.treasureId ?? initialTreasureId.current));
  const maze = challenge?.kind !== 'tower_defense' ? challenge?.maze : undefined;
  const pathRef = useRef(path);
  pathRef.current = path;
  const finger = useRef<{ x: number; y: number } | null>(null);
  const player = path[path.length - 1];
  const goal = maze ? maze.size * maze.size - 1 : -1;
  const boardSize = Math.max(0, Math.floor(Math.min(boardSpace.width, boardSpace.height, 336)));
  const progress = save ? treasureProgress(save) : null;
  const backToMap = () => navigation.goBack();

  const finish = async (solution: number[]) => {
    if (claiming.current) return;
    claiming.current = true;
    setWorking(true);
    setFailure(null);
    try {
      if (await completeTreasureChallenge(route.params.challengeId, solution)) setFinished(true);
      else setFailure('Keep tracking active and stay within collection range. Wait for fresh GPS, then try opening the box again.');
    } finally { claiming.current = false; setWorking(false); }
  };

  const move = (next: number) => {
    const currentPath = pathRef.current;
    const current = currentPath[currentPath.length - 1];
    if (!maze || working || finished || claiming.current || current === goal || !maze.passages[current].includes(next)) return;
    const nextPath = moveMazePath(maze, currentPath, next);
    pathRef.current = nextPath;
    setPath(nextPath);
    if (next === goal) void finish(nextPath);
  };

  const drag = (x: number, y: number) => {
    if (!finger.current || !maze || working || finished || claiming.current) return;
    const dx = x - finger.current.x;
    const dy = y - finger.current.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 5) return;
    finger.current = { x, y };
    const nextPath = swipeMazePath(maze, pathRef.current, dx, dy);
    pathRef.current = nextPath;
    setPath(nextPath);
    if (nextPath[nextPath.length - 1] === goal) void finish(nextPath);
  };

  const directionButton = (icon: 'arrow-up' | 'arrow-down' | 'arrow-left' | 'arrow-right', target: number, label: string) => {
    const enabled = !!maze?.passages[player].includes(target) && !working && player !== goal;
    return <Pressable onPress={() => move(target)} disabled={!enabled} accessibilityRole="button"
      accessibilityLabel={label} accessibilityState={{ disabled: !enabled }}
      style={({ pressed }) => [styles.direction, !enabled && styles.disabled, pressed && styles.pressed]}>
      <Feather name={icon} size={24} color={theme.colors.primary} />
    </Pressable>;
  };

  return <AppScreen topo scroll={false}>
    <AppHeader title="Treasure labyrinth" onBack={backToMap} />
    <View style={styles.content}>
      {finished ? <Card style={styles.result}>
        <Feather name="unlock" size={42} color={theme.colors.primary} />
        <AppText style={styles.title}>Treasure opened!</AppText>
        <AppText style={styles.description}>
          {box && box.rewardGranted !== false
            ? `${getEffectDetails(getTreasureReward(box).type).name} collected. Your active effects have been updated.`
            : 'Reward limit reached. This box still counts toward your collected treasures.'}
        </AppText>
        <AppText style={styles.counter}>{progress?.collected ?? 0} treasures collected</AppText>
        <AppButton title="Return to map" onPress={backToMap} />
      </Card> : !maze || !box || !isTreasureAvailable(box) || challenge?.sessionId !== save?.sessionId ? <Card style={styles.result}>
        <AppText style={styles.title}>This labyrinth is no longer active</AppText>
        <AppText style={styles.description}>Return to the map and choose an available treasure box.</AppText>
        <AppButton title="Return to map" onPress={backToMap} />
      </Card> : <>
        <View style={styles.intro}>
          <AppText style={styles.description}>Swipe anywhere on the board to move. Follow the passages to the treasure.</AppText>
          <AppText style={styles.counter}>{progress?.collected ?? 0} collected · {progress?.rewarded ?? 0}/{progress?.limit ?? 10} items</AppText>
        </View>
        <View style={styles.boardSpace} onLayout={event => {
          const { width, height } = event.nativeEvent.layout;
          setBoardSpace({ width, height });
        }}>
        <View style={[styles.board, { width: boardSize, height: boardSize }]} accessibilityLabel="Randomly generated 16 by 16 labyrinth"
          onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true}
          onResponderGrant={event => { finger.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY }; }}
          onResponderMove={event => drag(event.nativeEvent.pageX, event.nativeEvent.pageY)}
          onResponderRelease={() => { finger.current = null; }}
          onResponderTerminate={() => { finger.current = null; }}
          onResponderTerminationRequest={() => false}>
          {boardSize > 0 && maze.passages.map((neighbors, index) => {
            const size = boardSize / maze.size;
            const row = Math.floor(index / maze.size);
            const col = index % maze.size;
            return <View key={index} pointerEvents="none"
              accessibilityLabel={`Row ${row + 1}, column ${col + 1}${index === player ? ', explorer' : index === goal ? ', treasure' : ''}`}
              style={[styles.cell, { width: size, height: size,
                borderTopWidth: neighbors.includes(index - maze.size) ? 0 : 1,
                borderRightWidth: neighbors.includes(index + 1) ? 0 : 1,
                borderBottomWidth: neighbors.includes(index + maze.size) ? 0 : 1,
                borderLeftWidth: neighbors.includes(index - 1) ? 0 : 1 },
              path.includes(index) && styles.visited]}>
              {index === player ? <View style={styles.explorer} />
                : index === goal ? <Feather name="package" size={Math.max(5, Math.min(16, size - 3))} color={theme.colors.accent} />
                  : index === 0 ? <Feather name="flag" size={16} color={theme.colors.secondary} /> : null}
            </View>;
          })}
        </View>
        </View>
        <View style={styles.controls}>
          {directionButton('arrow-up', player - maze.size, 'Move up')}
            {directionButton('arrow-left', player - 1, 'Move left')}
            {directionButton('arrow-down', player + maze.size, 'Move down')}
            {directionButton('arrow-right', player + 1, 'Move right')}
        </View>
        {progress && progress.rewarded >= progress.limit && <AppText style={styles.description}>Reward limit reached. Solve for your collection count; this box gives no item.</AppText>}
        {failure && <AppText style={styles.failure} accessibilityLiveRegion="polite">{failure}</AppText>}
        {player === goal && <AppButton title="Open treasure" loading={working} onPress={() => { void finish(path); }} />}
      </>}
    </View>
  </AppScreen>;
}

const styles = StyleSheet.create({
  content: { flex: 1, minHeight: 0, paddingHorizontal: 12, paddingBottom: 8, gap: 8 },
  intro: { gap: 8, alignItems: 'center' },
  title: { fontFamily: theme.fonts.display, fontSize: 23, textAlign: 'center', color: theme.colors.text },
  description: { fontSize: 13, lineHeight: 19, textAlign: 'center', color: theme.colors.secondary },
  counter: { fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.primary },
  boardSpace: { flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center' },
  board: { borderRadius: 16, overflow: 'hidden', alignSelf: 'center', flexDirection: 'row', flexWrap: 'wrap', backgroundColor: theme.colors.background },
  cell: { borderColor: theme.colors.secondary, alignItems: 'center', justifyContent: 'center' },
  visited: { backgroundColor: theme.colors.surface },
  explorer: { width: 12, height: 12, borderRadius: 6, backgroundColor: theme.colors.primary, borderWidth: 3, borderColor: theme.colors.subtle },
  controls: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  direction: { width: 54, height: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface,
    borderWidth: 1, borderColor: theme.colors.subtle, borderRadius: 12 },
  disabled: { opacity: 0.3 },
  pressed: { backgroundColor: theme.colors.border },
  result: { gap: 18, alignItems: 'center', padding: 24 },
  failure: { color: theme.colors.danger, fontSize: 13, textAlign: 'center' },
});
