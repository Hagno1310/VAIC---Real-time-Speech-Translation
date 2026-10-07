/**
 * Navigation type definitions.
 *
 * These param lists give every screen fully-typed `navigation` and `route`
 * props. When you add a screen, add it here first — the compiler will then flag
 * every navigation call that needs updating.
 *
 * The global declaration merges RootParamList into React Navigation so that
 * `navigation.navigate('AnyScreen')` is type-checked app-wide.
 */

import type { NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

/** Translator flow: language → lobby → invite → meeting → end of session. */
export type TranslatorStackParamList = {
  Language: undefined; // Chọn ngôn ngữ + tên thiết bị, vào lobby
  Devices: undefined; // Danh sách thiết bị cùng mạng (lobby)
  Invite: undefined; // Lời mời kết nối
  Meeting: undefined; // Trong cuộc họp (nói/nghe + lịch sử)
  EndSession: undefined; // Kết thúc phiên
};

/** Top-level navigator. */
export type RootStackParamList = {
  Main: NavigatorScreenParams<TranslatorStackParamList>;
};

export type TranslatorStackScreenProps<T extends keyof TranslatorStackParamList> =
  NativeStackScreenProps<TranslatorStackParamList, T>;

// --- Global type augmentation ----------------------------------------------
declare global {
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
