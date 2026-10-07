/**
 * Từ điển i18n cho luồng RTT (Real-Time Translator).
 *
 * UI của RTT hiển thị bằng NGÔN NGỮ MẸ ĐẺ của người dùng (`srcLang` trong store):
 * `vi` → tiếng Việt, mọi giá trị khác → tiếng Anh. Đối tượng `vi` giữ NGUYÊN văn
 * bản tiếng Việt hiện có trong từng màn; đối tượng `en` là bản dịch tiếng Anh.
 *
 * Chuỗi tĩnh dùng `string`; chuỗi có nội suy (tên đối tác, số đếm, mã ngôn ngữ)
 * dùng HÀM để chỗ gọi truyền tham số vào.
 */

/** Ngôn ngữ hiển thị của UI. Chỉ vi/en (backend hỗ trợ vi/en). */
export type UiLang = 'vi' | 'en';

/** Quy một mã ngôn ngữ bất kỳ về ngôn ngữ UI: chỉ 'vi' mới ra tiếng Việt. */
export function uiLangFromLang(lang: string): UiLang {
  return lang === 'vi' ? 'vi' : 'en';
}

export interface RttDict {
  common: {
    /** Nhãn ngôn ngữ đầy đủ của một thiết bị, vd "Tiếng Việt (VI)". */
    langLabel: (lang: string) => string;
    /** Tiền tố "Ngôn ngữ" cho dòng mô tả ngôn ngữ thiết bị. */
    language: string;
    /** Nhãn "Gốc" cho câu nguồn. */
    original: string;
    /** Nhãn "Dịch" cho bản dịch. */
    translation: string;
    /** Nhãn "Bạn" trong bong bóng chat của chính mình. */
    you: string;
    /** Tên mặc định cho đối tác khi chưa có tên. */
    defaultPeerName: string;
    /** Tên mặc định cho thiết bị của mình khi người dùng bỏ trống. */
    defaultDeviceName: string;
    /** Tiêu đề "Lịch sử dịch". */
    historyTitle: string;
  };
  demo1: {
    title: string;
    subtitle: string;
    deviceNameLabel: string;
    deviceNamePlaceholder: string;
    continue: string;
    changeLater: string;
    showBackend: string;
    hideBackend: string;
    wsHint: string;
  };
  demo2: {
    otherDevices: (n: number) => string;
    yourDevice: (label: string) => string;
    changeLangHint: string;
    availableHead: string;
    searching: string;
    notConnected: string;
    emptyTitle: string;
    emptyHint: string;
    deviceLang: (label: string) => string;
    sameLangWarn: string;
    busy: string;
    waiting: string;
    invite: string;
    sameLangTitle: string;
    sameLangBody: (name: string, label: string) => string;
    cancel: string;
    inviteAnyway: string;
  };
  demo3: {
    title: string;
    receiverTag: string;
    wantsToConnect: (name: string) => string;
    deviceLang: (label: string) => string;
    sameLangWarn: (langCode: string) => string;
    decline: string;
    accept: string;
    waitingAccept: string;
    back: string;
  };
  demo4: {
    sendingTo: (name: string) => string;
    youJustSpoke: string;
    listeningTo: (name: string) => string;
    end: string;
    history: string;
    sameLangBanner: (name: string, langCode: string) => string;
    statusSpeaking: string;
    statusSpoke: string;
    statusProcessing: string;
    statusListening: string;
    processing: string;
    listeningToYou: string;
    ready: (name: string) => string;
    roomLost: string;
    sendingTranslation: (name: string) => string;
    sentWaiting: (name: string) => string;
    readingAloud: string;
    talkActive: string;
    talkIdle: string;
    hintWeb: string;
    hintNative: string;
    close: string;
    emptyHistory: string;
  };
  demo8: {
    durationLabel: string;
    sentencesLabel: string;
    participantsLabel: string;
    ended: string;
    endedSubtitle: string;
    backToDevices: string;
    exportTxt: string;
  };
  /** Thông báo lỗi/kết nối bắn ra từ store (translatorSlice). */
  errors: {
    deviceBusy: string;
    inviteDeclined: string;
    peerDisconnected: string;
    roomClosed: string;
    wsError: string;
    notConnected: string;
  };
}

export const rttText: Record<UiLang, RttDict> = {
  vi: {
    common: {
      langLabel: (lang) => (lang === 'vi' ? 'Tiếng Việt (VI)' : 'English (EN)'),
      language: 'Ngôn ngữ',
      original: 'Gốc',
      translation: 'Dịch',
      you: 'Bạn',
      defaultPeerName: 'Đối tác',
      defaultDeviceName: 'Thiết bị của tôi',
      historyTitle: 'Lịch sử dịch',
    },
    demo1: {
      title: 'Chọn ngôn ngữ của bạn',
      subtitle: 'Ngôn ngữ này được lưu trên thiết bị và dùng làm mặc định cho các phiên họp.',
      deviceNameLabel: 'Tên thiết bị của bạn',
      deviceNamePlaceholder: 'VD: MacBook của Linh',
      continue: 'Tiếp tục',
      changeLater: 'Có thể đổi lại trong Cài đặt.',
      showBackend: 'Cài đặt backend',
      hideBackend: 'Ẩn cài đặt backend',
      wsHint: 'WebSocket URL (thiết bị thật: dùng IP LAN, vd ws://192.168.1.x:8000/ws)',
    },
    demo2: {
      otherDevices: (n) => `${n} thiết bị khác`,
      yourDevice: (label) => `Thiết bị của bạn · ${label}`,
      changeLangHint: 'Chọn nhầm? Bấm VI/EN để đổi ngôn ngữ của bạn — máy khác sẽ tự cập nhật.',
      availableHead: 'Thiết bị khả dụng',
      searching: 'Đang tìm thiết bị…',
      notConnected: 'Chưa kết nối',
      emptyTitle: 'Chưa thấy thiết bị nào khác.',
      emptyHint: 'Mở app trên máy thứ hai và trỏ cùng WS URL để nó xuất hiện ở đây.',
      deviceLang: (label) => `Ngôn ngữ: ${label}`,
      sameLangWarn: 'Cùng ngôn ngữ với bạn — sẽ không có bản dịch',
      busy: 'Đang bận',
      waiting: 'Đang chờ…',
      invite: 'Mời',
      sameLangTitle: 'Cùng ngôn ngữ',
      sameLangBody: (name, label) =>
        `“${name}” đang dùng ${label}, cùng ngôn ngữ với bạn. Nếu ghép cặp sẽ không có bản dịch. Bạn vẫn muốn tiếp tục mời?`,
      cancel: 'Huỷ',
      inviteAnyway: 'Vẫn mời',
    },
    demo3: {
      title: 'Lời mời kết nối',
      receiverTag: 'PHÍA NHẬN',
      wantsToConnect: (name) => `“${name}” muốn kết nối`,
      deviceLang: (label) => `Ngôn ngữ: ${label}`,
      sameLangWarn: (langCode) =>
        `Cùng ngôn ngữ với bạn (${langCode}) — sẽ không có bản dịch. Bạn vẫn có thể chấp nhận để vào phòng.`,
      decline: 'Từ chối',
      accept: 'Chấp nhận',
      waitingAccept: 'Đang chờ chấp nhận…',
      back: 'Quay lại',
    },
    demo4: {
      sendingTo: (name) => `Đang gửi tới ${name}`,
      youJustSpoke: 'Bạn vừa nói',
      listeningTo: (name) => `Đang nghe ${name}`,
      end: 'Kết thúc',
      history: 'Lịch sử',
      sameLangBanner: (name, langCode) =>
        `Bạn và ${name} đang dùng cùng ngôn ngữ (${langCode}). Sẽ không có bản dịch — hãy để một người đổi sang ngôn ngữ khác.`,
      statusSpeaking: 'ĐANG NÓI',
      statusSpoke: 'ĐÃ NÓI',
      statusProcessing: 'ĐANG XỬ LÝ',
      statusListening: 'ĐANG NGHE',
      processing: 'Đang nhận diện giọng nói…',
      listeningToYou: 'Đang nghe bạn nói…',
      ready: (name) => `Đã ghép với ${name}. Giữ nút bên dưới để nói, hoặc chờ ${name} nói.`,
      roomLost: 'Mất kết nối phòng. Quay lại danh sách thiết bị để ghép lại.',
      sendingTranslation: (name) => `Đang gửi bản dịch tới ${name}…`,
      sentWaiting: (name) => `Đã gửi tới ${name}. Đang chờ ${name} phản hồi…`,
      readingAloud: 'Đang đọc to bản dịch…',
      talkActive: 'Đang nói… (thả để gửi)',
      talkIdle: 'Nhấn giữ để nói',
      hintWeb: 'Phím tắt: Space giữ để nói · H mở lịch sử · Esc đóng',
      hintNative: 'Giữ nút để nói, thả ra để gửi bản dịch.',
      close: 'Đóng',
      emptyHistory: 'Chưa có câu nào trong phiên.',
    },
    demo8: {
      durationLabel: 'Thời lượng',
      sentencesLabel: 'Câu đã dịch',
      participantsLabel: 'Người tham gia',
      ended: 'Phiên họp đã kết thúc',
      endedSubtitle: 'Với David’s iPad. Đã lưu bản ghi trên thiết bị của bạn.',
      backToDevices: 'Quay lại danh sách thiết bị',
      exportTxt: 'Xuất bản ghi (.txt)',
    },
    errors: {
      deviceBusy: 'Thiết bị đang bận.',
      inviteDeclined: 'Lời mời bị từ chối.',
      peerDisconnected: 'Đối tác đã rời hoặc mất kết nối.',
      roomClosed: 'Phòng đã đóng.',
      wsError: 'Lỗi kết nối WebSocket tới backend.',
      notConnected: 'Chưa kết nối tới backend. Bấm “Kết nối” trước.',
    },
  },
  en: {
    common: {
      langLabel: (lang) => (lang === 'vi' ? 'Vietnamese (VI)' : 'English (EN)'),
      language: 'Language',
      original: 'Original',
      translation: 'Translation',
      you: 'You',
      defaultPeerName: 'Partner',
      defaultDeviceName: 'My device',
      historyTitle: 'Translation history',
    },
    demo1: {
      title: 'Choose your language',
      subtitle: 'This language is saved on your device and used as the default for meetings.',
      deviceNameLabel: 'Your device name',
      deviceNamePlaceholder: 'e.g. Linh’s MacBook',
      continue: 'Continue',
      changeLater: 'You can change this later in Settings.',
      showBackend: 'Backend settings',
      hideBackend: 'Hide backend settings',
      wsHint: 'WebSocket URL (real devices: use the LAN IP, e.g. ws://192.168.1.x:8000/ws)',
    },
    demo2: {
      otherDevices: (n) => `${n} other devices`,
      yourDevice: (label) => `Your device · ${label}`,
      changeLangHint: 'Picked the wrong one? Tap VI/EN to change your language — other devices update automatically.',
      availableHead: 'Available devices',
      searching: 'Searching for devices…',
      notConnected: 'Not connected',
      emptyTitle: 'No other devices found yet.',
      emptyHint: 'Open the app on a second machine pointing at the same WS URL for it to appear here.',
      deviceLang: (label) => `Language: ${label}`,
      sameLangWarn: 'Same language as you — no translation will happen',
      busy: 'Busy',
      waiting: 'Waiting…',
      invite: 'Invite',
      sameLangTitle: 'Same language',
      sameLangBody: (name, label) =>
        `“${name}” is using ${label}, the same language as you. Pairing will produce no translation. Do you still want to invite them?`,
      cancel: 'Cancel',
      inviteAnyway: 'Invite anyway',
    },
    demo3: {
      title: 'Connection invite',
      receiverTag: 'RECEIVING',
      wantsToConnect: (name) => `“${name}” wants to connect`,
      deviceLang: (label) => `Language: ${label}`,
      sameLangWarn: (langCode) =>
        `Same language as you (${langCode}) — no translation will happen. You can still accept to join the room.`,
      decline: 'Decline',
      accept: 'Accept',
      waitingAccept: 'Waiting for acceptance…',
      back: 'Back',
    },
    demo4: {
      sendingTo: (name) => `Sending to ${name}`,
      youJustSpoke: 'You just spoke',
      listeningTo: (name) => `Listening to ${name}`,
      end: 'End',
      history: 'History',
      sameLangBanner: (name, langCode) =>
        `You and ${name} are using the same language (${langCode}). There will be no translation — have one person switch to another language.`,
      statusSpeaking: 'SPEAKING',
      statusSpoke: 'SPOKE',
      statusProcessing: 'PROCESSING',
      statusListening: 'LISTENING',
      processing: 'Transcribing your speech…',
      listeningToYou: 'Listening to you…',
      ready: (name) => `Paired with ${name}. Hold the button below to speak, or wait for ${name} to speak.`,
      roomLost: 'Room connection lost. Go back to the device list to pair again.',
      sendingTranslation: (name) => `Sending the translation to ${name}…`,
      sentWaiting: (name) => `Sent to ${name}. Waiting for ${name} to respond…`,
      readingAloud: 'Reading the translation aloud…',
      talkActive: 'Speaking… (release to send)',
      talkIdle: 'Hold to speak',
      hintWeb: 'Shortcuts: hold Space to speak · H opens history · Esc closes',
      hintNative: 'Hold the button to speak, release to send the translation.',
      close: 'Close',
      emptyHistory: 'No sentences in this session yet.',
    },
    demo8: {
      durationLabel: 'Duration',
      sentencesLabel: 'Sentences translated',
      participantsLabel: 'Participants',
      ended: 'Meeting ended',
      endedSubtitle: 'With David’s iPad. The transcript has been saved on your device.',
      backToDevices: 'Back to device list',
      exportTxt: 'Export transcript (.txt)',
    },
    errors: {
      deviceBusy: 'Device is busy.',
      inviteDeclined: 'The invitation was declined.',
      peerDisconnected: 'Partner left or lost connection.',
      roomClosed: 'The room was closed.',
      wsError: 'WebSocket connection error to the backend.',
      notConnected: 'Not connected to the backend. Tap “Connect” first.',
    },
  },
};
