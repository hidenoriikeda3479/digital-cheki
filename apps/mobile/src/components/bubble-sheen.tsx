import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';

export function BubbleSheen({ id }: { id: string }) {
  const film = `bubble-film-${id}`;
  const rim = `bubble-rim-${id}`;
  const highlight = `bubble-highlight-${id}`;
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    <Svg width="100%" height="100%" viewBox="0 0 200 200">
      <Defs>
        <RadialGradient id={film} cx="40%" cy="32%" rx="75%" ry="75%">
          <Stop offset="0%" stopColor="#ffffff" stopOpacity={0.1} />
          <Stop offset="64%" stopColor="#e8faff" stopOpacity={0.08} />
          <Stop offset="88%" stopColor="#cceefa" stopOpacity={0.19} />
          <Stop offset="100%" stopColor="#ffffff" stopOpacity={0.32} />
        </RadialGradient>
        <LinearGradient id={rim} x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%" stopColor="#ffffff" stopOpacity={0.95} />
          <Stop offset="30%" stopColor="#b5ebf6" stopOpacity={0.63} />
          <Stop offset="62%" stopColor="#f6c8e3" stopOpacity={0.54} />
          <Stop offset="84%" stopColor="#d6ccf7" stopOpacity={0.62} />
          <Stop offset="100%" stopColor="#ffffff" stopOpacity={0.9} />
        </LinearGradient>
        <RadialGradient id={highlight} cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0%" stopColor="#ffffff" stopOpacity={0.72} />
          <Stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx="100" cy="100" r="98" fill={`url(#${film})`} />
      <Circle cx="100" cy="100" r="97" fill="none" stroke={`url(#${rim})`} strokeWidth="2.4" />
      <Circle cx="100" cy="100" r="92" fill="none" stroke="#ffffff" strokeOpacity={0.24} strokeWidth="1" />
      <Ellipse cx="59" cy="42" rx="55" ry="24" transform="rotate(-28 59 42)" fill={`url(#${highlight})`} />
      <Path d="M 29 69 C 36 43 53 29 78 23" fill="none" stroke="#ffffff" strokeOpacity={0.55}
        strokeWidth="3" strokeLinecap="round" />
      <Path d="M 139 164 C 152 157 162 147 168 135" fill="none" stroke="#ffffff" strokeOpacity={0.28}
        strokeWidth="2.5" strokeLinecap="round" />
    </Svg>
  </View>;
}
