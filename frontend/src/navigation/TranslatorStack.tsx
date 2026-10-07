/**
 * TranslatorStack — luồng phiên dịch: chọn ngôn ngữ → lobby → lời mời → họp → kết thúc.
 * Lịch sử dịch là panel trong màn Meeting (không có màn riêng).
 */
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { DevicesScreen } from '@/screens/Devices';
import { EndSessionScreen } from '@/screens/EndSession';
import { InviteScreen } from '@/screens/Invite';
import { LanguageScreen } from '@/screens/Language';
import { MeetingScreen } from '@/screens/Meeting';
import type { TranslatorStackParamList } from './types';

const Stack = createNativeStackNavigator<TranslatorStackParamList>();

export function TranslatorStack() {
  return (
    <Stack.Navigator initialRouteName="Language" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Language" component={LanguageScreen} />
      <Stack.Screen name="Devices" component={DevicesScreen} />
      <Stack.Screen name="Invite" component={InviteScreen} />
      <Stack.Screen name="Meeting" component={MeetingScreen} />
      <Stack.Screen name="EndSession" component={EndSessionScreen} />
    </Stack.Navigator>
  );
}
