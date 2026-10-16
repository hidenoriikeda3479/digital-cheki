import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useSyncExternalStore } from 'react';

import { Colors } from '@/constants/theme';
import { useAppServices } from '@/services/provider';

export default function AppTabs() {
  const colors = Colors.light;
  const { capture, editing } = useAppServices();
  const captureState = useSyncExternalStore(capture.subscribe, capture.getSnapshot, capture.getSnapshot);
  const editingState = useSyncExternalStore(editing.subscribe, editing.getSnapshot, editing.getSnapshot);

  return (
    <NativeTabs
      hidden={captureState.phase === 'camera' || !!editingState.photo}
      backgroundColor={colors.background}
      indicatorColor={colors.backgroundElement}
      labelStyle={{ selected: { color: colors.text } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/home.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="explore">
        <NativeTabs.Trigger.Label>Explore</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/explore.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
