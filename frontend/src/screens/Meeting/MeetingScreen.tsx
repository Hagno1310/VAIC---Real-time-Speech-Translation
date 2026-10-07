/**
 * Màn cuộc họp: NGHE/NÓI hợp nhất trên một màn.
 *
 * Immersive: hero chữ lớn GIỮA màn hiện đoạn voice + bản dịch. Push-to-talk bằng
 * nút "Nhấn giữ để nói" hoặc giữ phím Space (web). Nút Lịch sử / phím H (web) mở
 * panel "Lịch sử dịch" dạng bong bóng chat (lời mình phải, đối tác trái): ngăn bên
 * phải trên màn rộng (vẫn thấy hero), tấm trượt từ dưới trên điện thoại. Esc / chạm
 * nền / nút ✕ để đóng. Chỉ push-to-talk, không có chế độ rảnh tay.
 *
 *   - Đang nghe: hero = bản dịch sang ngôn ngữ CỦA BẠN + câu gốc; top "Đang nghe".
 *   - Đang nói (giữ nút/Space): hero accent = lời bạn + "Đang gửi tới đối tác…".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertTriangle, History, Lock, Mic, PhoneOff, Volume2, X } from 'lucide-react-native';

import { useMeetingMic, useResponsive, useRttT } from '@/components/hooks';
import type { TranslatorStackScreenProps } from '@/navigation/types';
import type { Speaker, TranslatorTurn } from '@/types/translator';
import { useStore } from '@/store';

const TP = { accent: '#5EEAD4', text2: '#9AA0A6', muted: '#585E66', red: '#ff6669', black: '#000000' };
const WAVE = [8, 16, 11, 20, 9, 15, 7];

// Chữ dẫn trước tiếng: gõ hết chữ trong ~90% độ dài audio để chữ luôn nhỉnh hơn
// giọng vài nhịp (voice "đuổi theo" text). Giảm số này nếu muốn chữ đi trước nhiều hơn.
const REVEAL_LEAD = 0.9;

/**
 * Chạy chữ dần theo từng từ ("đánh máy"), tránh giật cả cụm.
 * - `syncMs`: độ dài audio (ms) — nếu có, pace nhịp để chạy trọn audio (chữ dẫn
 *   trước tiếng theo REVEAL_LEAD).
 * - `syncKey`: đổi key ⇒ lượt mới, reset về đầu và gõ lại từ đầu.
 * - Fallback: khi `syncKey` mới mà chưa có `syncMs`, hoãn bắt đầu gõ tối đa
 *   ~400ms chờ audio; hết 400ms vẫn chưa có thì gõ nhịp mặc định.
 */
function useReveal(
  text: string,
  opts?: { syncMs?: number; syncKey?: string; cadence?: number },
): string {
  const { syncMs, syncKey, cadence: baseCadence = 55 } = opts ?? {};
  const [shown, setShown] = useState('');
  const wordsRef = useRef<string[]>([]);
  const iRef = useRef(0);
  const keyRef = useRef<string | undefined>(undefined);
  const shownRef = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const words = (text || '').split(/\s+/).filter(Boolean);
    const full = words.join(' ');
    wordsRef.current = words;

    // Lượt mới (syncKey đổi) → reset về đầu để gõ lại khớp audio.
    const newTurn = syncKey !== keyRef.current;
    if (newTurn) {
      keyRef.current = syncKey;
      iRef.current = 0;
    }
    // Khi đang thu âm, syncKey không đổi giữa các câu → con trỏ iRef còn giữ vị trí
    // câu cũ khiến câu mới bị "kẹt". Nếu nội dung mới KHÔNG nối tiếp phần đang hiện
    // (đổi sang câu khác, không phải partial mọc dài thêm) thì gõ lại từ đầu.
    if (!newTurn && shownRef.current && !full.startsWith(shownRef.current)) {
      iRef.current = 0;
    }
    if (iRef.current > words.length) iRef.current = 0; // text ngắn lại → lượt mới

    // Nhịp: có syncMs thì trải đều theo ~90% độ dài audio (chữ dẫn trước), kẹp 40..400ms.
    const cadence =
      syncMs && words.length > 0
        ? Math.min(400, Math.max(40, (syncMs * REVEAL_LEAD) / words.length))
        : baseCadence;

    // Hoãn bắt đầu tối đa 400ms nếu đang chờ audio (có syncKey nhưng chưa có
    // syncMs và chưa gõ chữ nào). Sau 400ms hoặc khi có syncMs → gõ ngay.
    const waitingAudio = syncKey !== undefined && !syncMs && iRef.current === 0;
    const startDelay = waitingAudio ? 400 : 0;

    const tick = () => {
      if (timer.current) clearTimeout(timer.current);
      if (iRef.current >= wordsRef.current.length) {
        const done = wordsRef.current.join(' ');
        setShown(done);
        shownRef.current = done;
        return;
      }
      iRef.current += 1;
      const partial = wordsRef.current.slice(0, iRef.current).join(' ');
      setShown(partial);
      shownRef.current = partial;
      timer.current = setTimeout(tick, cadence);
    };

    timer.current = setTimeout(tick, startDelay);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [text, syncMs, syncKey, baseCadence]);

  return shown;
}

/** Bong bóng trong panel lịch sử — lời mình canh phải (viền accent), đối tác trái. */
function HistoryBubble({
  turn,
  peerName,
  srcLang,
  dstLang,
}: {
  turn: TranslatorTurn;
  peerName: string;
  srcLang: string;
  dstLang: string;
}) {
  const t = useRttT();
  const mine = turn.mine === true;
  const label = mine ? t.common.you : peerName;
  const langTag = (mine ? srcLang : dstLang).toUpperCase();
  return (
    <View className={`w-full flex-row ${mine ? 'justify-end' : 'justify-start'}`}>
      <View
        className={`gap-1.5 rounded-2xl border bg-tp-surface p-3.5 ${
          mine ? 'border-tp-accent' : 'border-tp-border'
        } max-w-[88%]`}
      >
        <View className="flex-row items-center gap-2">
          <Text className="text-[13px] font-semibold text-tp-text">{label}</Text>
          <View className="rounded-full border border-tp-border bg-tp-bg px-2 py-0.5">
            <Text className="text-[10px] text-tp-text2">{langTag}</Text>
          </View>
        </View>
        <Text className="text-[15px] leading-[21px] text-tp-text">
          {mine ? turn.srcText : turn.dstText}
        </Text>
        {mine
          ? !!turn.dstText && (
              <Text className="text-[12px] leading-[17px] text-tp-muted">
                {t.common.translation}: {turn.dstText}
              </Text>
            )
          : !!turn.srcText &&
            turn.srcText !== turn.dstText && (
              <Text className="text-[12px] leading-[17px] text-tp-muted">
                {t.common.original}: {turn.srcText}
              </Text>
            )}
      </View>
    </View>
  );
}

export function MeetingScreen({ navigation }: TranslatorStackScreenProps<'Meeting'>) {
  const { compact } = useResponsive();
  const t = useRttT();
  const insets = useSafeAreaInsets();
  const mic = useMeetingMic();
  const status = useStore((s) => s.translatorStatus);
  const live = useStore((s) => s.live);
  const turns = useStore((s) => s.turns);
  const srcLang = useStore((s) => s.srcLang);
  const dstLang = useStore((s) => s.dstLang);
  const room = useStore((s) => s.room);
  const ttsOn = useStore((s) => s.ttsOn);
  const audioCue = useStore((s) => s.audioCue);
  const leaveRoom = useStore((s) => s.leaveRoom);

  const [historyOpen, setHistoryOpen] = useState(false);
  const historyScroll = useRef<ScrollView>(null);

  const speaker: Speaker = srcLang === 'vi' ? 'vn' : 'sg';
  const speaking = mic.recording;
  const peerName = room?.peer.name ?? t.common.defaultPeerName;
  // Hai bên cùng một ngôn ngữ → không có gì để dịch (nguồn = đích). Cảnh báo.
  const sameLang = srcLang === dstLang;

  // Đối tác rời/mất kết nối → về lobby.
  useEffect(() => {
    if (!room && status === 'connected') navigation.navigate('Devices');
  }, [room, status, navigation]);

  // Chỉ cho nói khi micro đã mở sẵn VÀ backend đã nạp xong model/VAD — nếu không
  // câu đầu tiên vừa chậm vừa mất đoạn.
  const serverReady = useStore((s) => s.serverReady);
  const preparing = !mic.error && (!mic.ready || !serverReady);

  // Push-to-talk: bắt đầu/kết thúc một lượt nói.
  const startTalk = useCallback(() => {
    if (!preparing && !mic.recording) void mic.start(speaker);
  }, [mic, speaker, preparing]);
  const stopTalk = useCallback(() => {
    if (mic.recording) void mic.stop();
  }, [mic]);

  // Phím tắt web: Space giữ để nói, Alt bấm để bật/tắt lịch sử. Chỉ áp dụng trên
  // web và gỡ listener khi rời màn. Dùng ref để đăng ký listener MỘT lần.
  const startRef = useRef(startTalk);
  const stopRef = useRef(stopTalk);
  startRef.current = startTalk;
  stopRef.current = stopTalk;
  const spaceHeld = useRef(false);
  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const onDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (!spaceHeld.current) {
          spaceHeld.current = true;
          startRef.current();
        }
      } else if (e.key === 'Escape') {
        setHistoryOpen(false);
      } else if (e.key.toLowerCase() === 'h' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // H bật/tắt (không dùng Alt: Windows/trình duyệt nuốt phím Alt).
        if (!e.repeat) setHistoryOpen((v) => !v);
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeld.current = false;
        stopRef.current();
      }
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  // Cuộn lịch sử xuống cuối khi mở / có lượt mới.
  useEffect(() => {
    if (historyOpen) historyScroll.current?.scrollToEnd({ animated: false });
  }, [historyOpen, turns.length]);

  // HERO có 3 trạng thái:
  //   • ĐANG NÓI (đang giữ mic)      → hiện lời MÌNH (live.srcText).
  //   • ĐÃ NÓI  (vừa thả, đối tác     → giữ CÂU VỪA NÓI của mình trên màn hình,
  //             chưa đáp)               không nhảy sang khung nghe rỗng/cũ.
  //   • ĐANG NGHE                     → bản dịch (ngôn ngữ mình) của đối tác.
  const lastTurn = turns.length > 0 ? turns[turns.length - 1] : null;
  const lastMine = useMemo(
    () => [...turns].reverse().find((t) => t.mine === true) ?? null,
    [turns],
  );
  const lastPeer = useMemo(
    () => [...turns].reverse().find((t) => t.mine !== true) ?? null,
    [turns],
  );
  // Cụm đang được ĐỌC (audio đang phát) — hero bám theo để chữ khớp tai; audio
  // phát cuốn chiếu (hàng đợi) nên trễ hơn lúc chữ về.
  const playingTurn = audioCue ? turns.find((t) => t.id === audioCue.turnId) ?? null : null;
  // Vừa nói xong: không giữ mic, không có audio đối tác đang phát, và lượt gần
  // nhất là của MÌNH (đối tác chưa gửi bản dịch nào mới).
  const justSpoke = !speaking && !playingTurn && lastTurn?.mine === true;

  // "Đang xử lý" ngay sau khi thả mic: chờ transcript cụm VỪA nói quay về để
  // KHÔNG nháy câu CŨ (stt.final của cụm mới thường về trễ vài trăm ms). Bắt cạnh
  // thả mic (speaking true→false), giữ loading tới khi có lượt-của-mình MỚI, hoặc
  // hết 4s (dự phòng: cụm cuối im lặng → backend không trả stt.final).
  const [awaitingMine, setAwaitingMine] = useState(false);
  const prevSpeaking = useRef(false);
  const mineIdAtRelease = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (prevSpeaking.current && !speaking) {
      mineIdAtRelease.current = lastMine?.id;
      setAwaitingMine(true);
    }
    prevSpeaking.current = speaking;
  }, [speaking, lastMine?.id]);
  useEffect(() => {
    if (awaitingMine && lastMine?.id && lastMine.id !== mineIdAtRelease.current) {
      setAwaitingMine(false);
    }
  }, [lastMine?.id, awaitingMine]);
  useEffect(() => {
    if (!awaitingMine) return undefined;
    const timer = setTimeout(() => setAwaitingMine(false), 4000);
    return () => clearTimeout(timer);
  }, [awaitingMine]);
  // Chỉ hiện loading khi vừa nói xong và chưa nghe đối tác (không đè lúc đang nghe).
  const showMineLoading = awaitingMine && !speaking && !playingTurn;

  // Dùng `||` (không phải `??`) để chuỗi rỗng cũng rơi xuống fallback.
  const heroBig = speaking
    ? live?.srcText || ''
    : justSpoke
      ? lastMine?.srcText || ''
      : playingTurn?.dstText || lastPeer?.dstText || '';
  // ĐANG NGHE hiện câu gốc của đối tác dưới bản dịch; ĐANG/ĐÃ NÓI thì không.
  const heroSrc = speaking || justSpoke ? '' : playingTurn?.srcText || lastPeer?.srcText || '';
  // Hero khớp audio khi ĐANG NGHE; ĐÃ NÓI dùng id lượt của mình để gõ chữ đúng câu.
  const heroTurnId = speaking
    ? undefined
    : justSpoke
      ? lastMine?.id
      : playingTurn?.id ?? lastPeer?.id;
  const cue = audioCue && audioCue.turnId === heroTurnId ? audioCue : null;
  const typed = useReveal(heroBig, { syncMs: cue?.durationMs, syncKey: heroTurnId });
  const typing = typed.length < heroBig.length;

  const endMeeting = () => {
    leaveRoom();
    navigation.navigate('EndSession');
  };

  const dotColor = status === 'connected' ? TP.accent : status === 'error' ? TP.red : TP.muted;

  return (
    <View className="flex-1 bg-tp-bg" style={{ paddingTop: insets.top }}>
      {/* Top bar */}
      <View
        className={`flex-row flex-wrap items-center justify-between gap-y-2 border-b border-tp-border ${
          compact ? 'px-4 py-3' : 'px-8 py-[18px]'
        }`}
      >
        <View className="flex-row items-center gap-2.5">
          <View className="flex-row items-center gap-2 rounded-full border border-tp-border bg-tp-surface px-3.5 py-2">
            <Lock size={14} color={TP.accent} />
            <Text className="text-[13px] font-semibold tracking-[1px] text-tp-text">
              {srcLang.toUpperCase()} → {dstLang.toUpperCase()}
            </Text>
          </View>
          <Text className="text-[15px] font-medium text-tp-text" numberOfLines={1}>
            {speaking
              ? t.meeting.sendingTo(peerName)
              : justSpoke
                ? t.meeting.youJustSpoke
                : t.meeting.listeningTo(peerName)}
          </Text>
        </View>
        <View className="flex-row items-center gap-3">
          <View className="flex-row items-center gap-1.5">
            <View className="h-[9px] w-[9px] rounded-full" style={{ backgroundColor: dotColor }} />
            <Text className="text-[13px] font-semibold text-tp-accent">LIVE</Text>
          </View>
          <Pressable
            onPress={() => setHistoryOpen((v) => !v)}
            className="flex-row items-center gap-1.5 rounded-full border border-tp-border bg-tp-surface px-3 py-2"
          >
            <History size={15} color={TP.text2} />
            <Text className="text-[13px] text-tp-text2">
              {compact ? '' : t.meeting.history}
              {turns.length > 0 ? `${compact ? '' : ' · '}${turns.length}` : ''}
            </Text>
          </Pressable>
          <Pressable
            onPress={endMeeting}
            className="flex-row items-center gap-2 rounded-full bg-tp-surface px-[14px] py-2"
            style={{ borderWidth: 1, borderColor: '#E7000B' }}
          >
            <PhoneOff size={15} color={TP.red} />
            <Text className="text-sm font-medium" style={{ color: TP.red }}>
              {t.meeting.end}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Cảnh báo: cả hai chọn cùng ngôn ngữ → không có bản dịch thực sự. */}
      {sameLang && (
        <View
          className={`flex-row items-center gap-2.5 border-b ${compact ? 'px-4 py-3' : 'px-8 py-3.5'}`}
          style={{ borderColor: '#5a2a2e', backgroundColor: '#2a1518' }}
        >
          <AlertTriangle size={18} color={TP.red} />
          <Text className="flex-1 text-[13px]" style={{ color: '#ff8a99' }}>
            {t.meeting.sameLangBanner(peerName, srcLang.toUpperCase())}
          </Text>
        </View>
      )}

      {/* HERO — voice + bản dịch giữa màn (kẹp số dòng để không tràn) */}
      <View className="flex-1 items-center justify-center px-6">
        <Text
          className="text-[13px] font-semibold tracking-[2px]"
          style={{ color: speaking || justSpoke || showMineLoading ? TP.accent : TP.text2 }}
        >
          {speaking
            ? t.meeting.statusSpeaking
            : showMineLoading
              ? t.meeting.statusProcessing
              : justSpoke
                ? t.meeting.statusSpoke
                : t.meeting.statusListening}
        </Text>
        <View
          style={{ maxHeight: compact ? 220 : 380, overflow: 'hidden', maxWidth: 1000 }}
          className="mt-5 items-center"
        >
          {showMineLoading ? (
            <View className="flex-row items-center gap-3">
              <ActivityIndicator color={TP.accent} />
              <Text className="text-center text-lg text-tp-text2" style={{ maxWidth: 720 }}>
                {t.meeting.processing}
              </Text>
            </View>
          ) : heroBig ? (
            <Text
              numberOfLines={compact ? 4 : 5}
              className={`text-center font-semibold ${
                compact ? 'text-[26px] leading-[34px]' : 'text-[44px] leading-[54px]'
              }`}
              style={{ color: speaking || justSpoke ? TP.accent : '#EDEFF2' }}
            >
              {typed || '…'}
              {typing && <Text style={{ color: TP.accent }}>▍</Text>}
            </Text>
          ) : speaking ? (
            <Text className="text-center text-lg text-tp-muted" style={{ maxWidth: 720 }}>
              {t.meeting.listeningToYou}
            </Text>
          ) : (
            <Text className="text-center text-lg text-tp-muted" style={{ maxWidth: 720 }}>
              {status === 'connected' ? t.meeting.ready(peerName) : t.meeting.roomLost}
            </Text>
          )}
        </View>
        {showMineLoading ? null : speaking ? (
          <Text className="mt-5 text-center text-base text-tp-text2" numberOfLines={2} style={{ maxWidth: 800 }}>
            {t.meeting.sendingTranslation(peerName)}
          </Text>
        ) : justSpoke ? (
          <Text className="mt-5 text-center text-base text-tp-text2" numberOfLines={2} style={{ maxWidth: 800 }}>
            {t.meeting.sentWaiting(peerName)}
          </Text>
        ) : (
          !!heroSrc && (
            <Text className="mt-5 text-center text-base text-tp-text2" numberOfLines={2} style={{ maxWidth: 800 }}>
              {t.common.original}: {heroSrc}
            </Text>
          )
        )}
      </View>

      {/* Dải đọc to (TTS) khi đang nghe */}
      {!speaking && !justSpoke && ttsOn && (
        <View className="flex-row items-center justify-center gap-3 border-t border-tp-border bg-tp-surface px-8 py-3">
          <Volume2 size={16} color={TP.accent} />
          <View className="h-[18px] flex-row items-end gap-[3px]">
            {WAVE.map((h, i) => (
              <View key={i} className="w-[3px] rounded-sm bg-tp-accent" style={{ height: h }} />
            ))}
          </View>
          <Text className="text-[13px] text-tp-text2">{t.meeting.readingAloud}</Text>
        </View>
      )}

      {/* Push-to-talk */}
      <View
        className="items-center gap-2 border-t border-tp-border px-8 pt-5"
        style={{ paddingBottom: insets.bottom + 20 }}
      >
        <Pressable
          onPressIn={startTalk}
          onPressOut={stopTalk}
          disabled={status !== 'connected' || preparing}
          className="flex-row items-center justify-center gap-3 rounded-full px-12 py-5"
          style={{
            backgroundColor:
              status !== 'connected' || preparing ? TP.muted : speaking ? TP.red : TP.accent,
          }}
        >
          <Mic size={24} color={speaking ? '#ffffff' : TP.black} />
          <Text
            className="text-lg font-bold"
            style={{ color: speaking ? '#ffffff' : TP.black }}
          >
            {preparing ? t.meeting.preparing : speaking ? t.meeting.talkActive : t.meeting.talkIdle}
          </Text>
        </Pressable>
        {mic.error ? (
          <Text className="text-sm" style={{ color: '#ff8a99' }}>
            {mic.error}
          </Text>
        ) : Platform.OS === 'web' ? (
          <Text className="text-[13px] text-tp-muted">
            {t.meeting.hintWeb}
          </Text>
        ) : (
          <Text className="text-[13px] text-tp-muted">{t.meeting.hintNative}</Text>
        )}
      </View>

      {/* Màn chuẩn bị: chờ micro + backend sẵn sàng trước lượt nói đầu tiên */}
      {preparing && (
        <View
          className="absolute inset-0 items-center justify-center gap-5 px-8"
          style={{ backgroundColor: 'rgba(0,0,0,0.85)' }}
        >
          <ActivityIndicator color={TP.accent} size="large" />
          <Text className="text-center text-xl font-semibold text-tp-text">{t.meeting.preparing}</Text>
          <View className="gap-2">
            {[
              { done: mic.ready, label: t.meeting.prepMic },
              { done: serverReady, label: t.meeting.prepServer },
            ].map((step) => (
              <Text
                key={step.label}
                className="text-[15px]"
                style={{ color: step.done ? TP.accent : TP.text2 }}
              >
                {step.done ? '✓' : '…'} {step.label}
              </Text>
            ))}
          </View>
        </View>
      )}

      {/* Panel Lịch sử dịch — ngăn phải (màn rộng) / tấm trượt dưới (điện thoại).
          Nền mờ nhẹ để hero vẫn đọc được; chạm nền để đóng. */}
      {historyOpen && (
        <View className="absolute inset-0">
          <Pressable
            className="absolute inset-0"
            style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
            onPress={() => setHistoryOpen(false)}
            accessibilityLabel={t.meeting.close}
          />
          <View
            className={`absolute bg-tp-bg ${
              compact
                ? 'bottom-0 left-0 right-0 h-[75%] rounded-t-3xl border-t border-tp-border'
                : 'bottom-0 right-0 top-0 w-[400px] max-w-full border-l border-tp-border'
            }`}
            style={compact ? undefined : { paddingTop: insets.top }}
          >
            <View className="flex-row items-center justify-between border-b border-tp-border px-4 py-3">
              <View className="flex-row items-center gap-2.5">
                <History size={18} color={TP.accent} />
                <Text className="text-lg font-semibold text-tp-text">{t.common.historyTitle}</Text>
              </View>
              <Pressable
                onPress={() => setHistoryOpen(false)}
                accessibilityLabel={t.meeting.close}
                hitSlop={8}
                className="rounded-full border border-tp-border bg-tp-surface p-2"
              >
                <X size={16} color={TP.text2} />
              </Pressable>
            </View>
            <ScrollView
              ref={historyScroll}
              className="flex-1"
              contentContainerStyle={{
                paddingHorizontal: 16,
                paddingTop: 16,
                paddingBottom: insets.bottom + 24,
                gap: 12,
              }}
            >
              {turns.length === 0 ? (
                <Text className="py-10 text-center text-base text-tp-muted">
                  {t.meeting.emptyHistory}
                </Text>
              ) : (
                turns.map((turn) => (
                  <HistoryBubble
                    key={turn.id}
                    turn={turn}
                    peerName={peerName}
                    srcLang={srcLang}
                    dstLang={dstLang}
                  />
                ))
              )}
            </ScrollView>
          </View>
        </View>
      )}
    </View>
  );
}
