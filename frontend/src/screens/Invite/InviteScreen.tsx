/**
 * Demo 3 — Lời mời kết nối (rtt_hackathon.pen · "Demo 3 Lời mời kết nối").
 *
 * Bên NHẬN lời mời: hiển thị ai đang mời + Chấp nhận / Từ chối. Chấp nhận →
 * `invite.accept` → server tạo phòng → `room.joined` → vào Meeting. Nếu không có
 * lời mời (bên gửi lỡ vào đây), hiện trạng thái "đang chờ".
 */
import { useEffect } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertTriangle, Check, Laptop, Loader } from 'lucide-react-native';

import { useRttT } from '@/components/hooks';
import type { RttStackScreenProps } from '@/navigation/rttTypes';
import { useStore } from '@/store';

const TP = { accent: '#5EEAD4', text2: '#9AA0A6', red: '#ff6669', black: '#000000' };

function Circle({ children }: { children: React.ReactNode }) {
  return (
    <View className="h-20 w-20 items-center justify-center rounded-full border-[1.5px] border-tp-accent bg-tp-bg">
      {children}
    </View>
  );
}

export function Demo3Invite({ navigation }: RttStackScreenProps<'Invite'>) {
  const t = useRttT();
  const insets = useSafeAreaInsets();
  const incomingInvite = useStore((s) => s.incomingInvite);
  const srcLang = useStore((s) => s.srcLang);
  const room = useStore((s) => s.room);
  const acceptInvite = useStore((s) => s.acceptInvite);
  const declineInvite = useStore((s) => s.declineInvite);

  // Người mời cùng ngôn ngữ với mình → ghép cặp sẽ không có bản dịch. Vẫn cho chấp nhận.
  const sameLang = incomingInvite?.fromLang === srcLang;

  // Ghép phòng xong → vào cuộc họp (thay màn để Back không quay lại lời mời).
  useEffect(() => {
    if (room) navigation.replace('Meeting');
  }, [room, navigation]);

  // Lời mời bị rút / hết hạn (đối tác đóng) → quay lại danh sách thiết bị.
  useEffect(() => {
    if (!incomingInvite && !room) {
      const t = setTimeout(() => navigation.goBack(), 150);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [incomingInvite, room, navigation]);

  const onAccept = () => {
    if (incomingInvite) acceptInvite(incomingInvite.fromClientId);
  };
  const onDecline = () => {
    if (incomingInvite) declineInvite(incomingInvite.fromClientId);
    navigation.goBack();
  };

  return (
    <View className="flex-1 bg-tp-bg" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 40 }}
      >
        <Text className="text-2xl font-semibold text-tp-text">{t.demo3.title}</Text>

        {incomingInvite ? (
          <View className="w-[520px] max-w-full items-center gap-5 rounded-[20px] border border-tp-border bg-tp-surface p-9">
            <Text className="text-[11px] font-semibold tracking-[1.5px] text-tp-muted">{t.demo3.receiverTag}</Text>
            <Circle>
              <Laptop size={36} color={TP.accent} />
            </Circle>
            <Text className="text-center text-xl font-semibold leading-[26px] text-tp-text">
              {t.demo3.wantsToConnect(incomingInvite.fromName)}
            </Text>
            <Text className="text-sm text-tp-text2">
              {t.demo3.deviceLang(t.common.langLabel(incomingInvite.fromLang))}
            </Text>
            {sameLang && (
              <View
                className="w-full flex-row items-center gap-2.5 rounded-xl border px-4 py-3"
                style={{ borderColor: '#5a2a2e', backgroundColor: '#2a1518' }}
              >
                <AlertTriangle size={18} color={TP.red} />
                <Text className="flex-1 text-[13px]" style={{ color: '#ff8a99' }}>
                  {t.demo3.sameLangWarn(srcLang.toUpperCase())}
                </Text>
              </View>
            )}
            <View className="w-full flex-row gap-3">
              <Pressable
                onPress={onDecline}
                className="flex-1 items-center justify-center rounded-full border border-tp-border bg-tp-surface p-[13px]"
              >
                <Text className="text-[15px] font-medium text-tp-text">{t.demo3.decline}</Text>
              </Pressable>
              <Pressable
                onPress={onAccept}
                className="flex-1 flex-row items-center justify-center gap-2 rounded-full bg-tp-accent p-[13px]"
              >
                <Check size={16} color={TP.black} />
                <Text className="text-[15px] font-semibold text-tp-bg">{t.demo3.accept}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View className="w-[520px] max-w-full items-center gap-5 rounded-[20px] border border-tp-border bg-tp-surface p-9">
            <View className="flex-row items-center gap-2">
              <Loader size={16} color={TP.accent} />
              <Text className="text-[15px] text-tp-text2">{t.demo3.waitingAccept}</Text>
            </View>
            <Pressable
              onPress={() => navigation.goBack()}
              className="w-full items-center justify-center rounded-full border border-tp-border bg-tp-surface p-[13px]"
            >
              <Text className="text-[15px] font-medium text-tp-text">{t.demo3.back}</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
