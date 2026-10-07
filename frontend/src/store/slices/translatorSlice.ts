/**
 * translatorSlice — state & điều phối phiên dịch real-time (contract streaming).
 *
 * Sở hữu một `TranslatorSocket`, nối sự kiện server vào state, cung cấp action
 * cho UI. Theo logic bản test chuẩn (backend hoang-dev, static/index.html):
 *
 *   - Mỗi cụm VAD: gửi `audio.chunk` → `stt.final` (lời mình) / `nmt.result`
 *     (lời đối tác) — nghe gì ghi nấy, không có bản dịch tạm/dự đoán.
 *   - Dừng nói: gửi `audio.chunk` cuối → `nmt.result` → chốt vào `turns`,
 *     `tts.audio` → phát giọng (edge-tts MP3).
 *
 * Vòng lặp thu âm + coalesce nằm ở tầng mic (Phase 2); slice chỉ forward `send`.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StateCreator } from 'zustand';

import { env } from '@/config/env';
import { rttText, uiLangFromLang } from '@/i18n/rtt';
import { TranslatorSocket } from '@/services';
import { playBase64Audio } from '@/services/audioPlayback';
import type {
  ConnectionStatus,
  Device,
  IncomingInvite,
  Lang,
  RoomPeer,
  ServerEvent,
  Speaker,
  TranslatorMode,
  TranslatorTurn,
  TurnMetrics,
} from '@/types/translator';
import type { RootStore } from '../index';

/** Dòng "đang nói" — bản dịch tạm cập nhật liên tục. */
export interface LiveLine {
  speaker: Speaker;
  srcText: string;
  dstText: string;
}

function makeId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Cài đặt lưu trên thiết bị (SRS: ngôn ngữ + backend nhớ giữa các lần mở).
const STORAGE_KEY = 'rtt.settings';
function persist(data: { wsUrl: string; srcLang: Lang; dstLang: Lang; ttsOn: boolean }): void {
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/** Clip TTS đang phát cho một lượt đối tác: id lượt, mốc bắt đầu, độ dài (ms). */
export type AudioCue = { turnId: string; startedAt: number; durationMs: number };

export interface TranslatorSlice {
  wsUrl: string;
  translatorStatus: ConnectionStatus;
  translatorMode: TranslatorMode;
  srcLang: Lang;
  dstLang: Lang;
  ttsOn: boolean;
  translatorError: string | null;

  /** Lịch sử: MỖI lượt nói (một lần push-to-talk) là MỘT entry đã gộp. */
  turns: TranslatorTurn[];
  /** Các segment đã cắt trong LƯỢT hiện tại (gộp thành một entry lịch sử khi kết thúc lượt). */
  sessionSegments: TranslatorTurn[];
  /** Bong bóng "đang nói" hiện tại (từ stt.partial), hoặc null. */
  live: LiveLine | null;
  metrics: TurnMetrics | null;
  /** Tín hiệu audio TTS đang phát cho lượt đối tác — để hero gõ chữ khớp giọng. */
  audioCue: AudioCue | null;

  // -- Lobby / ghép phòng 1↔1 (chat nội bộ LAN) ---------------------------
  /** Id do server cấp cho thiết bị này (sau `hello`). */
  myClientId: string | null;
  /** Backend đã warmup xong (model + VAD) — màn họp chờ cờ này trước khi cho nói. */
  serverReady: boolean;
  /** Tên hiển thị của thiết bị này trong lobby. */
  myName: string;
  /** Các thiết bị khác đang online cùng backend. */
  devices: Device[];
  /** Phòng 1↔1 hiện tại (null = đang ở lobby / chưa ghép). */
  room: { roomId: string; peer: RoomPeer } | null;
  /** Lời mời đang đến (bên nhận), hoặc null. */
  incomingInvite: IncomingInvite | null;
  /** Đang chờ thiết bị này chấp nhận (bên gửi), hoặc null. */
  pendingInviteTo: string | null;

  /** Nội bộ — KHÔNG select trong component. */
  _socket: TranslatorSocket | null;
  _direction: string | null;
  /** nmt.result kế tiếp là bản CHỐT của lượt → gộp sessionSegments vào lịch sử. */
  _finalizePending: boolean;
  /** Tên đang muốn vào lobby (khác null = đang cố kết nối, cho phép tự thử lại). */
  _lobbyName: string | null;
  /** Handle setTimeout của lần thử lại đang chờ (để huỷ khi ngắt). */
  _reconnectTimer: ReturnType<typeof setTimeout> | null;
  /** Số lần đã thử kết nối lobby liên tiếp (reset khi mở được). */
  _reconnectAttempts: number;

  /** Nạp cài đặt đã lưu (wsUrl, ngôn ngữ, tts) khi mở app. */
  hydrateSettings: () => Promise<void>;
  setWsUrl: (url: string) => void;
  setLangs: (src: Lang, dst: Lang) => void;
  /**
   * Đổi ngôn ngữ CỦA MÌNH khi đang ở lobby (chọn nhầm ở màn đầu). Cập nhật
   * srcLang/dstLang, lưu lại, và gửi lại `hello` để backend rebroadcast lobby —
   * các máy khác tự thấy ngôn ngữ mới, không cần reload. Bỏ qua khi đã vào phòng.
   */
  changeLang: (src: Lang) => void;
  setTranslatorMode: (mode: TranslatorMode) => void;
  setTtsOn: (on: boolean) => void;
  setMyName: (name: string) => void;

  connect: () => void;
  disconnect: () => void;

  /** Kết nối tới backend LAN và vào lobby với tên hiển thị. */
  enterLobby: (name: string) => void;
  /** Gửi lời mời ghép phòng tới một thiết bị. */
  invitePeer: (toClientId: string) => void;
  /** Chấp nhận lời mời đến từ `fromClientId` (tạo phòng). */
  acceptInvite: (fromClientId: string) => void;
  /** Từ chối lời mời đến từ `fromClientId`. */
  declineInvite: (fromClientId: string) => void;
  /** Rời phòng hiện tại (đóng cho cả đối tác) và ngắt kết nối. */
  leaveRoom: () => void;

  /** Mở một lượt nói mới (xoá live + segment cũ, đảm bảo đúng chiều dịch). */
  startTurn: (speaker: Speaker) => void;
  /** Chốt MỘT segment (cắt ở 4 dòng): audio.chunk → nmt.result → thêm vào sessionSegments. */
  commitSegment: (speaker: Speaker, wavBase64: string) => void;
  /** Kết thúc lượt (nhấn Dừng): audio.chunk cuối → gộp toàn bộ segment thành 1 entry lịch sử. */
  endTurn: (speaker: Speaker, wavBase64: string) => void;

  clearTurns: () => void;
}

export const createTranslatorSlice: StateCreator<RootStore, [], [], TranslatorSlice> = (
  set,
  get,
) => {
  // Id của turn đối tác vừa chốt — dùng để gắn audioCue cho đúng lượt.
  let lastPeerTurnId: string | null = null;

  const directionKey = () => {
    const s = get();
    return `${s.translatorMode}:${s.srcLang}->${s.dstLang}`;
  };

  /** Thông báo lỗi theo NGÔN NGỮ của người dùng (srcLang) — khớp với UI. */
  const errs = () => rttText[uiLangFromLang(get().srcLang)].errors;

  /** Đảm bảo đã gửi session.start đúng chiều dịch hiện tại (gửi lại nếu đổi). */
  const ensureSession = (): void => {
    const s = get();
    if (!s._socket || !s._socket.isOpen) return;
    const dir = directionKey();
    if (s._direction !== dir) {
      s._socket.send({
        type: 'session.start',
        data: { mode: s.translatorMode, sourceLang: s.srcLang, targetLang: s.dstLang },
      });
      set({ _direction: dir });
    }
  };

  // Backend desktop là exe PyInstaller, cold-start có thể mất vài chục giây mới
  // listen cổng 8000. Nên khi vào lobby ta tự thử lại (backoff) thay vì báo lỗi
  // ngay lần đầu ERR_CONNECTION_REFUSED. Ngừng khi: mở được, đã vào phòng, hoặc
  // người dùng chủ động ngắt (_lobbyName = null).
  const RECONNECT_MAX = 40; // ~40 lần
  const scheduleReconnect = (): void => {
    const attempts = get()._reconnectAttempts;
    if (get()._lobbyName === null) return; // đã ngắt chủ động
    if (attempts >= RECONNECT_MAX) {
      set({
        translatorStatus: 'error',
        translatorError:
          'Không kết nối được backend sau nhiều lần thử. Kiểm tra backend/WS URL rồi thử lại.',
      });
      return;
    }
    const delay = Math.min(3000, 500 + attempts * 300); // 0.5s → tối đa 3s
    set({
      translatorStatus: 'connecting',
      translatorError: null,
      _reconnectAttempts: attempts + 1,
      _reconnectTimer: setTimeout(() => {
        set({ _reconnectTimer: null });
        if (get()._lobbyName !== null) connectLobby();
      }, delay),
    });
  };

  const connectLobby = (): void => {
    if (get()._lobbyName === null) return;
    const socket = new TranslatorSocket();
    set({ translatorStatus: 'connecting', translatorError: null, _socket: socket, _direction: null });
    socket.connect(get().wsUrl, {
      onOpen: () => {
        set({ translatorStatus: 'connected', _reconnectAttempts: 0, translatorError: null });
        const s = get();
        socket.send({ type: 'hello', data: { name: s.myName, lang: s.srcLang } });
      },
      onEvent: handleEvent,
      onClose: () => {
        set({ translatorStatus: 'disconnected', _direction: null, myClientId: null, devices: [], room: null });
        // Rớt/không mở được trong khi vẫn muốn ở lobby → thử lại.
        if (get()._lobbyName !== null) scheduleReconnect();
      },
      onError: (reason) => {
        // URL sai / bị chặn: thử lại vô ích → báo ngay cách sửa.
        if (reason) {
          set({
            translatorStatus: 'error',
            translatorError: `${errs().wsError} ${errs().wsUrlHint} (${reason})`,
          });
          return;
        }
        // Chưa vào lobby được (backend đang khởi động) → im lặng thử lại.
        // onClose thường theo sau onError nên việc lên lịch để onClose lo.
        if (get()._lobbyName === null) {
          set({ translatorStatus: 'error', translatorError: errs().wsError });
        }
      },
    });
  };

  const handleEvent = (event: ServerEvent): void => {
    switch (event.type) {
      case 'session.started':
        set({ translatorMode: event.data.mode });
        break;
      case 'stt.partial': {
        // Khi TÔI nói: chỉ stt.* + metrics quay về máy tôi (nmt/tts đã route
        // sang đối tác).
        const live = get().live;
        set({
          live: { speaker: event.data.speaker, srcText: event.data.text, dstText: live?.dstText ?? '' },
        });
        break;
      }
      case 'stt.final': {
        // Lời CHÍNH MÌNH vừa nói (bản dịch đã route sang đối tác). Lưu vào lịch
        // sử của mình để máy tôi có bản ghi đúng những gì tôi đã nói. Backend đã
        // chặn im lặng nên không còn câu ảo lọt vào đây.
        const text = event.data.text.trim();
        const next: { turns?: TranslatorTurn[]; live?: LiveLine | null } = {};
        if (text) {
          // dstText để trống → chờ bản dịch của mình về qua `nmt.self` điền vào.
          const mineTurn: TranslatorTurn = {
            id: makeId(),
            speaker: event.data.speaker,
            srcText: text,
            dstText: '',
            mine: true,
          };
          next.turns = [...get().turns, mineTurn];
          // Cập nhật hero người nói bằng CHÍNH câu vừa chốt. Nếu không, khi một cụm
          // được chốt mà không kèm stt.partial nào (VAD cắt cụm ngắn), `live` sẽ kẹt
          // ở câu trước → người nói vẫn thấy câu 1 dù đối tác đã nhận câu 2.
          next.live = { speaker: event.data.speaker, srcText: text, dstText: get().live?.dstText ?? '' };
        } else {
          // Cụm im lặng/rỗng → xoá bong bóng cũ để không hiện lại câu trước.
          next.live = null;
        }
        set({ ...next, audioCue: null });
        break;
      }
      case 'nmt.self': {
        // Bản dịch của CHÍNH MÌNH quay về → điền vào bong bóng mình mới nhất còn
        // trống dstText (tạo bởi stt.final). Không thấy thì thêm mới.
        const turns = get().turns;
        let idx = -1;
        for (let i = turns.length - 1; i >= 0; i -= 1) {
          if (turns[i].mine === true && !turns[i].dstText) {
            idx = i;
            break;
          }
        }
        if (idx >= 0) {
          const updated = turns.slice();
          updated[idx] = {
            ...updated[idx],
            srcText: event.data.srcText || updated[idx].srcText,
            dstText: event.data.dstText,
          };
          set({ turns: updated });
        } else {
          set({
            turns: [
              ...turns,
              {
                id: makeId(),
                speaker: event.data.speaker,
                srcText: event.data.srcText,
                dstText: event.data.dstText,
                mine: true,
              },
            ],
          });
        }
        break;
      }
      case 'nmt.result': {
        // Mô hình phòng: nmt.result đến từ ĐỐI TÁC (server route sang máy tôi).
        // Mỗi cái là một câu dịch đã chốt → thêm thẳng vào lịch sử hội thoại.
        const seg: TranslatorTurn = {
          id: makeId(),
          speaker: event.data.speaker,
          srcText: event.data.srcText,
          dstText: event.data.dstText,
          mine: false,
        };
        lastPeerTurnId = seg.id;
        set({
          live: null,
          turns: [...get().turns, seg],
          audioCue: null, // sẽ set lại khi tts.audio thực sự phát
        });
        break;
      }
      case 'tts.audio': {
        // Audio bản dịch của đối tác — phát trên máy tôi (nếu bật đọc). Khi clip
        // thật sự phát, ghi audioCue để hero gõ chữ khớp độ dài giọng.
        if (get().ttsOn) {
          const turnId = lastPeerTurnId;
          void playBase64Audio(event.data.audio, (durationMs) => {
            if (turnId) set({ audioCue: { turnId, startedAt: Date.now(), durationMs } });
          });
        }
        break;
      }
      case 'metrics':
        set({ metrics: event.data });
        break;
      case 'error':
        set({
          live: null,
          translatorError: `[${event.data.code}] ${event.data.message}`,
        });
        break;

      // -- Lobby / ghép phòng 1↔1 -----------------------------------------
      case 'welcome':
        set({ myClientId: event.data.clientId, serverReady: event.data.serverReady !== false });
        break;
      case 'server.ready':
        set({ serverReady: true });
        break;
      case 'lobby':
        set({ devices: event.data.devices });
        break;
      case 'invite.incoming':
        set({ incomingInvite: event.data });
        break;
      case 'invite.declined':
        set({
          pendingInviteTo: null,
          translatorError:
            event.data.reason === 'busy' ? errs().deviceBusy : errs().inviteDeclined,
        });
        break;
      case 'room.joined': {
        const peer = event.data.peer;
        set({
          room: { roomId: event.data.roomId, peer },
          dstLang: peer.lang,
          incomingInvite: null,
          pendingInviteTo: null,
          devices: [],
          turns: [],
          live: null,
          translatorError: null,
          audioCue: null,
        });
        lastPeerTurnId = null;
        // Server đã start session (src=mình, tgt=đối tác); đồng bộ _direction để
        // không gửi lại session.start. Bật đọc để đối tác nhận audio.
        const s = get();
        set({ _direction: `${s.translatorMode}:${s.srcLang}->${peer.lang}` });
        if (s.ttsOn && s._socket?.isOpen) {
          s._socket.send({ type: 'config.update', data: { ttsOn: true } });
        }
        break;
      }
      case 'room.closed':
        set({
          room: null,
          live: null,
          translatorError:
            event.data.reason === 'peer_disconnected'
              ? errs().peerDisconnected
              : errs().roomClosed,
        });
        break;
      default:
        break;
    }
  };

  return {
    wsUrl: env.wsUrl,
    translatorStatus: 'disconnected',
    translatorMode: 'cloud',
    srcLang: 'vi',
    dstLang: 'en',
    ttsOn: true,
    translatorError: null,

    turns: [],
    sessionSegments: [],
    live: null,
    metrics: null,
    audioCue: null,

    myClientId: null,
    serverReady: false,
    myName: 'Thiết bị của tôi',
    devices: [],
    room: null,
    incomingInvite: null,
    pendingInviteTo: null,

    _socket: null,
    _direction: null,
    _finalizePending: false,
    _lobbyName: null,
    _reconnectTimer: null,
    _reconnectAttempts: 0,

    hydrateSettings: async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw) as Partial<{
          wsUrl: string;
          srcLang: Lang;
          dstLang: Lang;
          ttsOn: boolean;
        }>;
        set({
          wsUrl: saved.wsUrl ?? get().wsUrl,
          srcLang: saved.srcLang ?? get().srcLang,
          dstLang: saved.dstLang ?? get().dstLang,
          ttsOn: saved.ttsOn ?? get().ttsOn,
        });
      } catch {
        /* cài đặt lỗi -> dùng mặc định */
      }
    },
    setWsUrl: (url) => {
      set({ wsUrl: url });
      const s = get();
      persist({ wsUrl: url, srcLang: s.srcLang, dstLang: s.dstLang, ttsOn: s.ttsOn });
    },
    setLangs: (src, dst) => {
      set({ srcLang: src, dstLang: dst, _direction: null });
      const s = get();
      persist({ wsUrl: s.wsUrl, srcLang: src, dstLang: dst, ttsOn: s.ttsOn });
    },
    changeLang: (src) => {
      // Đang trong phòng thì không cho đổi (cần re-start cả hai phiên — ngoài luồng lobby).
      if (get().room) return;
      const dst: Lang = src === 'vi' ? 'en' : 'vi';
      set({ srcLang: src, dstLang: dst, _direction: null });
      const s = get();
      persist({ wsUrl: s.wsUrl, srcLang: src, dstLang: dst, ttsOn: s.ttsOn });
      // Gửi lại hello để backend cập nhật registry + rebroadcast lobby cho máy khác.
      if (s._socket?.isOpen) {
        s._socket.send({ type: 'hello', data: { name: s.myName, lang: src } });
      }
    },
    setTranslatorMode: (mode) => {
      set({ translatorMode: mode, _direction: null });
      const s = get();
      if (s._socket?.isOpen) s._socket.send({ type: 'config.update', data: { mode } });
    },
    setTtsOn: (on) => {
      set({ ttsOn: on });
      const s = get();
      if (s._socket?.isOpen) s._socket.send({ type: 'config.update', data: { ttsOn: on } });
      persist({ wsUrl: s.wsUrl, srcLang: s.srcLang, dstLang: s.dstLang, ttsOn: on });
    },
    setMyName: (name) => set({ myName: name }),

    connect: () => {
      const socket = new TranslatorSocket();
      set({ translatorStatus: 'connecting', translatorError: null, _socket: socket, _direction: null });
      socket.connect(get().wsUrl, {
        onOpen: () => {
          set({ translatorStatus: 'connected' });
          const s = get();
          socket.send({
            type: 'session.start',
            data: { mode: s.translatorMode, sourceLang: s.srcLang, targetLang: s.dstLang },
          });
          socket.send({ type: 'config.update', data: { ttsOn: s.ttsOn } });
          set({ _direction: directionKey() });
        },
        onEvent: handleEvent,
        onClose: () => set({ translatorStatus: 'disconnected', _direction: null }),
        onError: (reason) =>
          set({
            translatorStatus: 'error',
            translatorError: reason ? `${errs().wsError} ${errs().wsUrlHint} (${reason})` : errs().wsError,
          }),
      });
    },

    disconnect: () => {
      const { _socket, _reconnectTimer } = get();
      if (_reconnectTimer) clearTimeout(_reconnectTimer);
      if (_socket) {
        _socket.send({ type: 'session.end', data: {} });
        _socket.close();
      }
      set({
        translatorStatus: 'disconnected',
        _socket: null,
        _direction: null,
        _finalizePending: false,
        _lobbyName: null,
        _reconnectTimer: null,
        live: null,
        sessionSegments: [],
        myClientId: null,
        devices: [],
        room: null,
        incomingInvite: null,
        pendingInviteTo: null,
      });
    },

    enterLobby: (name) => {
      // Huỷ mọi lần thử lại đang chờ + đóng kết nối cũ (khi đổi backend) trước khi
      // bắt đầu phiên mới.
      const prev = get()._reconnectTimer;
      if (prev) clearTimeout(prev);
      const prevSocket = get()._socket;
      if (prevSocket) prevSocket.close();
      set({
        _lobbyName: name,
        _reconnectTimer: null,
        _reconnectAttempts: 0,
        translatorError: null,
        myName: name,
        myClientId: null,
        devices: [],
        room: null,
        incomingInvite: null,
        pendingInviteTo: null,
        turns: [],
        live: null,
      });
      const socket = new TranslatorSocket();
      set({ translatorStatus: 'connecting', translatorError: null, _socket: socket, _direction: null });
      socket.connect(get().wsUrl, {
        onOpen: () => {
          set({ translatorStatus: 'connected', _reconnectAttempts: 0, translatorError: null });
          const s = get();
          socket.send({ type: 'hello', data: { name: s.myName, lang: s.srcLang } });
        },
        onEvent: handleEvent,
        onClose: () => {
          set({
            translatorStatus: 'disconnected',
            _direction: null,
            myClientId: null,
            devices: [],
            room: null,
          });
          // Rớt/không mở được trong khi vẫn muốn ở lobby → thử lại.
          if (get()._lobbyName !== null) scheduleReconnect();
        },
        onError: (reason) =>
          set({
            translatorStatus: 'error',
            translatorError: reason ? `${errs().wsError} ${errs().wsUrlHint} (${reason})` : errs().wsError,
          }),
      });
    },

    invitePeer: (toClientId) => {
      const s = get();
      if (!s._socket?.isOpen) return;
      s._socket.send({ type: 'invite', data: { toClientId } });
      set({ pendingInviteTo: toClientId, translatorError: null });
    },

    acceptInvite: (fromClientId) => {
      const s = get();
      if (!s._socket?.isOpen) return;
      s._socket.send({ type: 'invite.accept', data: { fromClientId } });
    },

    declineInvite: (fromClientId) => {
      const s = get();
      if (s._socket?.isOpen) s._socket.send({ type: 'invite.decline', data: { fromClientId } });
      set({ incomingInvite: null });
    },

    leaveRoom: () => {
      const s = get();
      if (s._reconnectTimer) clearTimeout(s._reconnectTimer);
      if (s._socket?.isOpen) {
        s._socket.send({ type: 'room.leave', data: {} });
        s._socket.send({ type: 'session.end', data: {} });
        s._socket.close();
      }
      set({
        translatorStatus: 'disconnected',
        _socket: null,
        _direction: null,
        _finalizePending: false,
        _lobbyName: null,
        _reconnectTimer: null,
        live: null,
        sessionSegments: [],
        myClientId: null,
        devices: [],
        room: null,
        incomingInvite: null,
        pendingInviteTo: null,
      });
    },

    startTurn: (_speaker) => {
      ensureSession();
      set({ live: null, sessionSegments: [], _finalizePending: false, translatorError: null });
    },

    commitSegment: (speaker, wavBase64) => {
      const { _socket } = get();
      if (!_socket || !_socket.isOpen) return;
      ensureSession();
      _socket.send({ type: 'audio.chunk', data: { speaker, audio: wavBase64 } });
    },

    endTurn: (speaker, wavBase64) => {
      const { _socket } = get();
      if (!_socket || !_socket.isOpen) {
        set({ translatorError: errs().notConnected });
        return;
      }
      ensureSession();
      set({ _finalizePending: true });
      _socket.send({ type: 'audio.chunk', data: { speaker, audio: wavBase64, final: true } });
    },

    clearTurns: () => set({ turns: [], sessionSegments: [], live: null, metrics: null, audioCue: null }),
  };
};
