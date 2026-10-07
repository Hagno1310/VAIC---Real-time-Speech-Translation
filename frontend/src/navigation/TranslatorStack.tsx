/**
 * RttStack — luồng demo RTT 8 bước (rtt_hackathon.pen).
 * Lịch sử dịch là panel trong màn Meeting (không có màn riêng).
 */
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { Demo1Language } from '@/screens/rtt/Demo1Language';
import { Demo2Devices } from '@/screens/rtt/Demo2Devices';
import { Demo3Invite } from '@/screens/rtt/Demo3Invite';
import { Demo4Meeting } from '@/screens/rtt/Demo4Meeting';
import { Demo8EndSession } from '@/screens/rtt/Demo8EndSession';
import type { RttStackParamList } from './rttTypes';

const Stack = createNativeStackNavigator<RttStackParamList>();

const LanguageScreen = Demo1Language;
const DevicesScreen = Demo2Devices;
const InviteScreen = Demo3Invite;
const MeetingScreen = Demo4Meeting;
const EndSessionScreen = Demo8EndSession;

export function RttStack() {
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
