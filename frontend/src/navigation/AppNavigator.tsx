/**
 * Root navigator.
 *
 * The app boots straight into the translator flow. The Auth stack/screens were removed from source — restore
 * them from git history when auth is needed again.
 */

import {
  DefaultTheme,
  NavigationContainer,
  type Theme as NavTheme,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { TranslatorStack } from './TranslatorStack';
import type { RootStackParamList } from './types';

const RootStack = createNativeStackNavigator<RootStackParamList>();

const navigationTheme: NavTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: '#5EEAD4',
    background: '#000000',
    card: '#141414',
    text: '#FFFFFF',
    border: '#262626',
  },
};

export function AppNavigator() {
  // To restore auth, bring back `bootstrap()`, the `hydrated` splash and the
  // `isAuthenticated ? <Main/> : <Auth/>` conditional (see git history).
  return (
    <NavigationContainer theme={navigationTheme}>
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        <RootStack.Screen name="Main" component={TranslatorStack} />
      </RootStack.Navigator>
    </NavigationContainer>
  );
}
