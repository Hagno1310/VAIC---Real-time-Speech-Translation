/**
 * Kiểu điều hướng cho luồng demo RTT (rtt_hackathon.pen · "RTT: Demo full luồng").
 * 8 bước happy-path từ chọn ngôn ngữ → kết thúc phiên.
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type RttStackParamList = {
  Language: undefined; // Demo 1 — Chọn ngôn ngữ
  Devices: undefined; // Demo 2 — Danh sách thiết bị
  Invite: undefined; // Demo 3 — Lời mời kết nối
  Meeting: undefined; // Demo 4 — Trong cuộc họp
  EndSession: undefined; // Demo 8 — Kết thúc phiên
};

export type RttStackScreenProps<T extends keyof RttStackParamList> =
  NativeStackScreenProps<RttStackParamList, T>;
