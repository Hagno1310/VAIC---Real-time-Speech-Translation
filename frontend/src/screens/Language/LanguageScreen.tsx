/**
 * Demo 1 — Chọn ngôn ngữ (theo rtt_hackathon.pen · frame "Demo 1 Chọn ngôn ngữ").
 *
 * Lần đầu mở app: người dùng chọn ngôn ngữ mặc định (lưu trên thiết bị). Chỉ UI,
 * chưa gắn logic — `onContinue` điều hướng sang bước kế.
 */
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Globe, Languages, Server } from 'lucide-react-native';

import { getSelf, isDesktop, setDesktopName } from '@/services/desktopBridge';
import type { RttStackScreenProps } from '@/navigation/rttTypes';
import { useStore } from '@/store';
import { rttText, uiLangFromLang } from '@/i18n/rtt';

interface LangOption {
  code: string;
  name: string;
  native: string;
}

const LANGS: LangOption[] = [
  { code: 'vi', name: 'Tiếng Việt', native: 'Vietnamese' },
  { code: 'en', name: 'English', native: 'English' },
];

export function Demo1Language({ navigation }: RttStackScreenProps<'Language'>) {
  const [selected, setSelected] = useState('vi');
  const [showAdv, setShowAdv] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = width < 600; // điện thoại: gọn padding lại cho vừa màn
  // Chọn văn bản theo LỰA CHỌN đang bật (chưa lưu store) để chữ lật ngay khi chạm.
  const t = rttText[uiLangFromLang(selected === 'vi' ? 'vi' : 'en')];

  // Cuộn xuống cuối để ô đang nhập nhảy lên trên bàn phím, dễ nhìn.
  const scrollToInput = () => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
  };

  const toggleAdv = () => {
    setShowAdv((v) => {
      const next = !v;
      if (next) scrollToInput();
      return next;
    });
  };
  const setLangs = useStore((s) => s.setLangs);
  const wsUrl = useStore((s) => s.wsUrl);
  const setWsUrl = useStore((s) => s.setWsUrl);
  const myName = useStore((s) => s.myName);
  const setMyName = useStore((s) => s.setMyName);
  const enterLobby = useStore((s) => s.enterLobby);

  // --- Discovery LAN (chỉ khi chạy trong vỏ Electron desktop) ---
  // Danh sách thiết bị cùng mạng + invite được chuyển sang màn Devices (Demo2).
  // Ở đây chỉ prefill tên máy + WS URL (IP LAN) từ thông tin máy mình.
  const desktop = isDesktop();

  useEffect(() => {
    if (!desktop) return;
    void getSelf().then((self) => {
      if (!self) return;
      if (!myName || myName === 'Thiết bị của tôi') setMyName(self.name);
      // Mặc định localhost không cho máy khác biết địa chỉ thật → tự thay bằng IP
      // LAN của máy này (backend bind 0.0.0.0 nên vẫn tự nối được), để hai máy
      // nhìn thấy cùng một dải mạng và máy kia có thể trỏ tới.
      const wsNow = useStore.getState().wsUrl;
      if (self.ws && /(localhost|127\.0\.0\.1)/.test(wsNow)) setWsUrl(self.ws);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop]);

  const onContinue = () => {
    // Ngôn ngữ của mình = nguồn; đối tác nhận ngôn ngữ còn lại. Backend hỗ trợ
    // vi/en → gộp các ngôn ngữ khác về "en" cho demo.
    const src = selected === 'vi' ? 'vi' : 'en';
    setLangs(src, src === 'vi' ? 'en' : 'vi');
    // Kết nối tới backend LAN và vào lobby ngay, để danh sách thiết bị hiện ở
    // bước sau (Demo2) trong khi vẫn thấy tiến trình kết nối.
    enterLobby((myName || '').trim() || t.common.defaultDeviceName);
    navigation.navigate('Devices');
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-tp-bg"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: compact ? 20 : 40,
          gap: compact ? 24 : 36,
        }}
      >
        {/* Wordmark */}
        <View className="flex-row items-center gap-2.5">
          <View className="h-[30px] w-[30px] items-center justify-center rounded-lg bg-tp-accent">
            <Languages size={18} color="#000000" />
          </View>
          <Text className="text-xl font-bold text-tp-text">RTT</Text>
        </View>

        {/* Card */}
        <View
          className={`w-full max-w-[560px] gap-6 rounded-[20px] border border-tp-border bg-tp-surface ${
            compact ? 'p-5' : 'p-10'
          }`}
        >
          <View className="gap-2">
            <Text className={`${compact ? 'text-[22px]' : 'text-[28px]'} font-semibold text-tp-text`}>
              {t.demo1.title}
            </Text>
            <Text className="text-[15px] leading-[21px] text-tp-text2">
              {t.demo1.subtitle}
            </Text>
          </View>

          {/* Tên thiết bị — hiển thị cho người khác trong lobby */}
          <View className="gap-1.5">
            <Text className="text-[13px] font-medium text-tp-text2">{t.demo1.deviceNameLabel}</Text>
            <TextInput
              value={myName}
              onChangeText={(t) => {
                setMyName(t);
                if (desktop) void setDesktopName(t);
              }}
              autoCapitalize="words"
              autoCorrect={false}
              placeholder={t.demo1.deviceNamePlaceholder}
              placeholderTextColor="#585E66"
              className="rounded-xl border border-tp-border bg-tp-bg px-4 py-3 text-base text-tp-text"
            />
          </View>

          <View className="gap-2.5">
            {LANGS.map((lang) => {
              const active = selected === lang.code;
              return (
                <Pressable
                  key={lang.code}
                  onPress={() => setSelected(lang.code)}
                  className={`flex-row items-center justify-between rounded-xl bg-tp-bg p-4 ${
                    active ? 'border-[1.5px] border-tp-accent' : 'border border-tp-border'
                  }`}
                >
                  <View className="flex-row items-center gap-3">
                    <Globe size={20} color={active ? '#5EEAD4' : '#9AA0A6'} />
                    <View className="gap-0.5">
                      <Text className="text-base font-semibold text-tp-text">{lang.name}</Text>
                      <Text className="text-[13px] text-tp-muted">{lang.native}</Text>
                    </View>
                  </View>
                  <View
                    className={`h-5 w-5 items-center justify-center rounded-full ${
                      active ? 'border-2 border-tp-accent' : 'border-[1.5px] border-tp-border'
                    }`}
                  >
                    {active && <View className="h-2.5 w-2.5 rounded-full bg-tp-accent" />}
                  </View>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={onContinue}
            className="items-center justify-center rounded-full bg-tp-accent p-[15px]"
          >
            <Text className="text-base font-semibold text-tp-bg">{t.demo1.continue}</Text>
          </Pressable>

          <Text className="text-center text-[13px] text-tp-muted">{t.demo1.changeLater}</Text>

          {/* Cài đặt backend (WS URL) — cần khi chạy trên thiết bị LAN */}
          <Pressable
            onPress={toggleAdv}
            className="mt-1 flex-row items-center justify-center gap-1.5"
          >
            <Server size={13} color="#585E66" />
            <Text className="text-center text-[12px] text-tp-muted">
              {showAdv ? t.demo1.hideBackend : t.demo1.showBackend}
            </Text>
          </Pressable>
          {showAdv && (
            <View className="gap-1.5">
              <Text className="text-[11px] text-tp-muted">
                {t.demo1.wsHint}
              </Text>
              <TextInput
                value={wsUrl}
                onChangeText={setWsUrl}
                onFocus={scrollToInput}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="ws://localhost:8000/ws"
                placeholderTextColor="#585E66"
                className="rounded-lg border border-tp-border bg-tp-bg px-3 py-2 text-sm text-tp-text"
              />
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
