import { ActivityIndicator, StyleSheet } from 'react-native';

/** Show progress without inserting a new row into the screen layout. */
export function ScreenProgress({ testID, label }: { testID: string; label: string }) {
  return <ActivityIndicator testID={testID} accessibilityLabel={label} pointerEvents="none"
    color="#174c8f" style={styles.indicator} />;
}

const styles = StyleSheet.create({
  indicator: { position: 'absolute', top: 8, right: 8, zIndex: 10 },
});
