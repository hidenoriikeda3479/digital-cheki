import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { ServicesProvider } from '@/services/provider';

SplashScreen.preventAutoHideAsync();

const screenBackground = '#ffffff';
const navigationTheme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: screenBackground } };

export default function RootLayout() {
  return (
    <ThemeProvider value={navigationTheme}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics} style={{ flex: 1, backgroundColor: screenBackground }}>
        <AnimatedSplashOverlay />
        <ServicesProvider><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: screenBackground } }} /></ServicesProvider>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}
