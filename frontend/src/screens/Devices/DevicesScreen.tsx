/**
 * Demo 2 — Danh sách thiết bị (rtt_hackathon.pen · "Demo 2 Danh sách thiết bị").
 *
 * Cùng backend LAN: hiện thiết bị của mình + các thiết bị khác đang online (từ
 * event `lobby`). Bấm "Mời" → gửi `invite`; nhận lời mời → sang Demo3; ghép được
 * phòng → sang Meeting.
 */
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertTriangle, Languages, Laptop, Link2, Loader, UserPlus, Users, Wifi } from 'lucide-react-native';

import { useResponsive, useRttT } from '@/components/hooks';
import type { RttStackScreenProps } from '@/navigation/rttTypes';
import { isDesktop, onDevices } from '@/services/desktopBridge';
import type { DesktopDevice } from '@/services/desktopBridge';
import { useStore } from '@/store';
import type { Device } from '@/types/translator';

const TP = { accent: '#5EEAD4', text2: '#9AA0A6', muted: '#585E66', red: '#ff6669', black: '#000000' };

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <View className="flex-row items-center gap-2 rounded-full border border-tp-border bg-tp-surface px-3.5 py-2">
      {children}
    </View>
  );
}

export function Demo2Devices({ navigation }: RttStackScreenProps<'Devices'>) {
  const { compact } = useResponsive();
  const t = useRttT();
  const insets = useSafeAreaInsets();
  const devices = useStore((s) => s.devices);
  const myName = useStore((s) => s.myName);
  const srcLang = useStore((s) => s.srcLang);
  const status = useStore((s) => s.translatorStatus);
  const pendingInviteTo = useStore((s) => s.pendingInviteTo);
  const incomingInvite = useStore((s) => s.incomingInvite);
  const room = useStore((s) => s.room);
  const translatorError = useStore((s) => s.translatorError);
  const invitePeer = useStore((s) => s.invitePeer);
  const wsUrl = useStore((s) => s.wsUrl);
  const setWsUrl = useStore((s) => s.setWsUrl);
  const enterLobby = useStore((s) => s.enterLobby);
  const changeLang = useStore((s) => s.changeLang);

  // --- Discovery LAN (chỉ trong vỏ Electron desktop) ---
  const desktop = isDesktop();
  const [lanDevices, setLanDevices] = useState<DesktopDevice[]>([]);
  useEffect(() => {
    if (!desktop) return undefined;
    return onDevices((list) => setLanDevices(list));
  }, [desktop]);

  // Bấm một máy cùng mạng → trỏ backend sang máy đó và vào lại lobby của nó.
  // Cả hai máy khi đó cùng một backend nên mới thấy & mời được nhau.
  const connectToLan = (dev: DesktopDevice) => {
    setWsUrl(dev.ws);
    enterLobby((myName || '').trim() || 'Thiết bị của tôi');
  };

  // Thiết bị đang chờ xác nhận mời khi cùng ngôn ngữ (mở popup cảnh báo), hoặc null.
  const [confirmDevice, setConfirmDevice] = useState<Device | null>(null);

  // Mời thiết bị: cùng ngôn ngữ với mình → mở popup cảnh báo trước; khác thì mời luôn.
  const requestInvite = (dev: Device) => {
    if (dev.lang === srcLang) setConfirmDevice(dev);
    else invitePeer(dev.clientId);
  };

  // Nhận lời mời đến → sang màn Lời mời (bên nhận).
  useEffect(() => {
    if (incomingInvite) navigation.navigate('Invite');
  }, [incomingInvite, navigation]);

  // Ghép phòng xong (dù mình mời hay được mời) → vào cuộc họp.
  useEffect(() => {
    if (room) navigation.navigate('Meeting');
  }, [room, navigation]);

  return (
    <View className="flex-1 bg-tp-bg" style={{ paddingTop: insets.top }}>
      {/* Top bar */}
      <View
        className={`flex-row flex-wrap items-center justify-between gap-y-2 border-b border-tp-border ${compact ? 'px-4 py-3' : 'px-8 py-5'
          }`}
      >
        <View className="flex-row items-center gap-2.5">
          <View className="h-[30px] w-[30px] items-center justify-center rounded-lg bg-tp-accent">
            <Languages size={18} color={TP.black} />
          </View>
          <Text className="text-xl font-bold text-tp-text">RTT</Text>
        </View>
        <View className="flex-row flex-wrap items-center gap-2">
          <Pill>
            <Users size={15} color={TP.accent} />
            <Text className="text-[13px] font-medium text-tp-text">
              {t.demo2.otherDevices(devices.length)}
            </Text>
          </Pill>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: compact ? 16 : 32,
          paddingBottom: (compact ? 16 : 32) + insets.bottom,
          gap: compact ? 16 : 24,
        }}
      >
        {/* Your device */}
        <View className="flex-row items-center justify-between rounded-2xl border border-tp-border bg-tp-surface p-5">
          <View className="flex-row items-center gap-3.5">
            <Laptop size={26} color={TP.accent} />
            <View className="gap-[3px]">
              <Text className="text-lg font-semibold text-tp-text">{myName}</Text>
              <Text className="text-[13px] text-tp-text2">
                {t.demo2.yourDevice(t.common.langLabel(srcLang))}
              </Text>
            </View>
          </View>
          <View className="flex-row items-center gap-2.5">
            {/* Đổi ngôn ngữ của mình (khi lỡ chọn nhầm ở màn đầu). Bấm mã ngôn ngữ
                để chuyển; máy khác trong lobby tự cập nhật, không cần reload. */}
            <View className="flex-row items-center gap-1.5">
              {(['vi', 'en'] as const).map((code) => {
                const active = srcLang === code;
                const disabled = active || status !== 'connected' || pendingInviteTo !== null;
                return (
                  <Pressable
                    key={code}
                    onPress={() => changeLang(code)}
                    disabled={disabled}
                    className={`rounded-full border px-2.5 py-1 ${active ? 'border-tp-accent bg-tp-accent' : 'border-tp-border bg-tp-surface'
                      }`}
                    style={{ opacity: !active && (status !== 'connected' || pendingInviteTo !== null) ? 0.4 : 1 }}
                  >
                    <Text
                      className="text-xs font-semibold"
                      style={{ color: active ? TP.black : TP.text2 }}
                    >
                      {code.toUpperCase()}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View
              className="h-[9px] w-[9px] rounded-full"
              style={{ backgroundColor: status === 'connected' ? TP.accent : TP.muted }}
            />
          </View>
        </View>
        <Text className="-mt-2 px-1 text-[11px] text-tp-muted">{t.demo2.changeLangHint}</Text>

        {!!translatorError && (
          <View className="rounded-xl border px-4 py-3" style={{ borderColor: '#5a2a2e', backgroundColor: '#2a1518' }}>
            <Text className="text-sm" style={{ color: '#ff8a99' }}>
              {translatorError}
            </Text>
          </View>
        )}

        {/* Thiết bị cùng mạng (discovery LAN) — bấm để nối tới backend máy đó */}
        {desktop && lanDevices.length > 0 && (
          <View className="gap-3">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <Wifi size={16} color={TP.accent} />
                <Text className="text-lg font-semibold text-tp-text">Thiết bị cùng mạng</Text>
              </View>
              <Text className="text-[13px] text-tp-muted">{lanDevices.length} thiết bị</Text>
            </View>
            {lanDevices.map((dev) => {
              const linked = wsUrl === dev.ws; // đang dùng chung backend máy này
              return (
                <View
                  key={dev.id}
                  className="flex-row items-center justify-between rounded-[14px] border border-tp-border bg-tp-surface p-[18px]"
                >
                  <View className="flex-row items-center gap-3.5">
                    <Laptop size={24} color={linked ? TP.accent : TP.text2} />
                    <View className="gap-[3px]">
                      <Text className="text-base font-semibold text-tp-text">{dev.name}</Text>
                      <Text className="text-xs text-tp-muted">{dev.ip}</Text>
                    </View>
                  </View>
                  {linked ? (
                    <View className="rounded-full border border-tp-accent bg-tp-surface px-5 py-2.5">
                      <Text className="text-sm font-semibold text-tp-accent">Đã nối backend</Text>
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => connectToLan(dev)}
                      className="flex-row items-center gap-2 rounded-full bg-tp-accent px-5 py-2.5"
                    >
                      <Link2 size={15} color={TP.black} />
                      <Text className="text-sm font-semibold text-tp-bg">Kết nối</Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
            <Text className="text-[11px] text-tp-muted">
              Bấm “Kết nối” để dùng chung backend với máy đó — sau đó cả hai sẽ hiện trong “Thiết bị
              khả dụng” bên dưới để mời vào phòng. Chỉ cần MỘT máy bấm kết nối.
            </Text>
          </View>
        )}

        {/* Available head */}
        <View className="flex-row items-center justify-between">
          <Text className="text-xl font-semibold text-tp-text">{t.demo2.availableHead}</Text>
          <View className="flex-row items-center gap-[7px]">
            <Loader size={14} color={TP.muted} />
            <Text className="text-[13px] text-tp-muted">
              {status === 'connected' ? t.demo2.searching : t.demo2.notConnected}
            </Text>
          </View>
        </View>

        {/* Device list */}
        {devices.length === 0 ? (
          <View className="items-center gap-2 rounded-[14px] border border-dashed border-tp-border bg-tp-surface p-8">
            <Text className="text-center text-[15px] text-tp-text2">
              {t.demo2.emptyTitle}
            </Text>
            <Text className="text-center text-[13px] text-tp-muted">
              {t.demo2.emptyHint}
            </Text>
          </View>
        ) : (
          <View className="gap-3">
            {devices.map((dev) => {
              const waiting = pendingInviteTo === dev.clientId;
              // Cùng ngôn ngữ với mình → ghép cặp sẽ không có bản dịch. Cảnh báo.
              const sameLang = dev.lang === srcLang;
              return (
                <View
                  key={dev.clientId}
                  className="flex-row items-center justify-between rounded-[14px] border border-tp-border bg-tp-surface p-[18px]"
                >
                  <View className="flex-1 flex-row items-center gap-3.5">
                    <Laptop size={24} color={dev.busy ? TP.muted : TP.text2} />
                    <View className="flex-1 gap-[3px]">
                      <Text className="text-base font-semibold text-tp-text">{dev.name}</Text>
                      <Text className="text-xs text-tp-muted">{t.demo2.deviceLang(t.common.langLabel(dev.lang))}</Text>
                      {sameLang && !dev.busy && (
                        <View className="mt-0.5 flex-row items-center gap-1.5">
                          <AlertTriangle size={12} color={TP.red} />
                          <Text className="text-[11px]" style={{ color: '#ff8a99' }}>
                            {t.demo2.sameLangWarn}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                  {dev.busy ? (
                    <View className="rounded-full border border-tp-border bg-tp-surface px-5 py-2.5">
                      <Text className="text-sm text-tp-muted">{t.demo2.busy}</Text>
                    </View>
                  ) : waiting ? (
                    <View className="flex-row items-center gap-2 rounded-full border border-tp-border bg-tp-surface px-5 py-2.5">
                      <Loader size={14} color={TP.text2} />
                      <Text className="text-sm text-tp-text2">{t.demo2.waiting}</Text>
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => requestInvite(dev)}
                      disabled={status !== 'connected' || pendingInviteTo !== null}
                      className="flex-row items-center gap-2 rounded-full bg-tp-accent px-5 py-2.5"
                      style={{ opacity: status !== 'connected' || pendingInviteTo !== null ? 0.5 : 1 }}
                    >
                      <UserPlus size={15} color={TP.black} />
                      <Text className="text-sm font-semibold text-tp-bg">{t.demo2.invite}</Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Popup cảnh báo khi mời thiết bị cùng ngôn ngữ — vẫn cho tiếp tục mời. */}
      <Modal
        transparent
        visible={confirmDevice !== null}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setConfirmDevice(null)}
      >
        <Pressable
          className="flex-1 items-center justify-center bg-black/60 px-6"
          onPress={() => setConfirmDevice(null)}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            className="w-full max-w-md gap-4 rounded-2xl border border-tp-border bg-tp-surface p-6"
          >
            <View className="flex-row items-center gap-2.5">
              <AlertTriangle size={22} color={TP.red} />
              <Text className="text-lg font-semibold text-tp-text">{t.demo2.sameLangTitle}</Text>
            </View>
            <Text className="text-[14px] leading-[20px] text-tp-text2">
              {t.demo2.sameLangBody(
                confirmDevice?.name ?? '',
                confirmDevice ? t.common.langLabel(confirmDevice.lang) : '',
              )}
            </Text>
            <View className="flex-row gap-3">
              <Pressable
                onPress={() => setConfirmDevice(null)}
                className="flex-1 items-center justify-center rounded-full border border-tp-border bg-tp-surface p-[13px]"
              >
                <Text className="text-[15px] font-medium text-tp-text">{t.demo2.cancel}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (confirmDevice) invitePeer(confirmDevice.clientId);
                  setConfirmDevice(null);
                }}
                className="flex-1 items-center justify-center rounded-full bg-tp-accent p-[13px]"
              >
                <Text className="text-[15px] font-semibold text-tp-bg">{t.demo2.inviteAnyway}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
