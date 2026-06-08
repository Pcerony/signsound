// app.js - 福岡市南区市民会館 会議室利用終了お知らせチャイム管理システム 制御スクリプト

// 1. 定数定義（全18部屋の構成データ。そのうち特定の10部屋のみが管理対象）
const ROOMS_CONFIG = [
  // 1階 社会教育棟
  { name: "和室", floor: "1F", wing: "social", type: "meeting", managed: false },
  { name: "託児室", floor: "1F", wing: "social", type: "other", managed: false },
  { name: "会議室5", floor: "1F", wing: "social", type: "meeting", managed: true },
  
  // 1階 中央棟
  { name: "大練習室", floor: "1F", wing: "central", type: "practice", managed: false },
  { name: "小練習室1", floor: "1F", wing: "central", type: "practice", managed: false },
  { name: "小練習室2", floor: "1F", wing: "central", type: "practice", managed: false },
  { name: "小練習室3", floor: "1F", wing: "central", type: "practice", managed: false },
  { name: "小練習室4", floor: "1F", wing: "central", type: "practice", managed: false },
  
  // 1階 文化ホール棟
  { name: "文化ホール", floor: "1F", wing: "hall", type: "hall", managed: false },
  
  // 2階 社会教育棟
  { name: "会議室1", floor: "2F", wing: "social", type: "meeting", managed: true },
  { name: "会議室2", floor: "2F", wing: "social", type: "meeting", managed: true },
  { name: "会議室3", floor: "2F", wing: "social", type: "meeting", managed: true },
  { name: "会議室4", floor: "2F", wing: "social", type: "meeting", managed: true },
  { name: "実習室1", floor: "2F", wing: "social", type: "practice", managed: true },
  { name: "実習室2", floor: "2F", wing: "social", type: "practice", managed: true },
  { name: "研修室", floor: "2F", wing: "social", type: "meeting", managed: true },
  { name: "視聴覚室", floor: "2F", wing: "social", type: "meeting", managed: true },
  
  // 2階 中央棟
  { name: "中練習室", floor: "2F", wing: "central", type: "practice", managed: false }
];

// 管理対象のみ（会議室1-5、実習室1-2、研修室、視聴覚室）
const DEFAULT_ROOMS = ROOMS_CONFIG.filter(r => r.managed).map(r => r.name);

const TIME_SLOTS = [
  { id: "morning", name: "午前枠", start: "09:00", end: "11:00", startMin: 9 * 60, endMin: 11 * 60 },
  { id: "afternoon", name: "午後枠", start: "13:00", end: "15:00", startMin: 13 * 60, endMin: 15 * 60 },
  { id: "night", name: "夜間枠", start: "18:00", end: "21:00", startMin: 18 * 60, endMin: 21 * 60 }
];

// 音声ファイルへのパス (相対パス)
const AUDIO_PATHS = {
  "10min": "アーカイブ 3/10分前v2.wav",
  "1min": "アーカイブ 3/1分前v2.wav"
};

// 2. 状態変数 (State)
let state = {
  currentDate: "",          // "YYYY-MM-DD" フォーマット
  reservations: {},         // { "YYYY-MM-DD": { "部屋名": { "slotId": { reserved: bool, play10: bool, play1: bool, useMic: bool } } } }
  isSystemActivated: true,  // ブラウザ音声アンロック状態（初期状態で強制オン）
  volumeMic: 70,            // マイク使用時の音量 (70dB)
  volumeNoMic: 65,          // マイク非使用時の音量 (65dB)
  logs: []
};

// リアルタイム / シミュレーション時間管理
let systemTime = new Date();
let lastRealTime = Date.now();
let simMode = false;
let simSpeed = 1;
let triggeredToday = {}; // { "YYYY-MM-DD_room_slot_type": true } (当日再生済みのトリガー重複防止)

// フィルタ・マップ状態
let gridFilter = "all";           // "all" | "1F" | "2F"
let currentMapFloor = "1F";       // "1F" | "2F"
let currentMapSlot = "afternoon"; // "morning" | "afternoon" | "night"
let activePopoverRoom = null;

// オーディオ要素
let audioElements = {
  "10min": null,
  "1min": null
};

// 3. 初期化処理
window.addEventListener("DOMContentLoaded", () => {
  // 音声要素のロード
  initAudio();
  
  // 今日の日付を設定
  const todayStr = getFormattedDate(new Date());
  state.currentDate = todayStr;
  
  // ローカルストレージからロード
  loadFromLocalStorage();
  
  // システム制御を初期状態で強制アクティブ化
  activateSystemAutomatically();
  
  // 日付ピッカーの初期値設定
  const datePicker = document.getElementById("datePicker");
  datePicker.value = todayStr;
  
  // 画面表示更新
  updateDateDisplay();
  renderScheduleGrid();
  renderFloorMap();
  updateVolumeDisplay();
  renderLogs();
  
  // イベントリスナーの登録
  registerEventListeners();
  
  // 1秒に1回動くメインループ開始
  setInterval(tick, 100); // 高精度シミュレーションのために100ms周期でチェック

  // 透過的なブラウザ音声制限解除（画面のどこかをクリックした際に自動でAudioContextをアンロック）
  const unlockAudioOnFirstClick = () => {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    if (context.state === 'suspended') {
      context.resume();
    }
    
    // ダミーの極小音量再生によるブラウザ制限解除
    const temp1 = new Audio(AUDIO_PATHS["10min"]);
    const temp2 = new Audio(AUDIO_PATHS["1min"]);
    temp1.volume = 0.001;
    temp2.volume = 0.001;
    temp1.play().then(() => temp1.pause()).catch(() => {});
    temp2.play().then(() => temp2.pause()).catch(() => {});
    
    document.removeEventListener("click", unlockAudioOnFirstClick);
    document.removeEventListener("touchstart", unlockAudioOnFirstClick);
  };
  document.addEventListener("click", unlockAudioOnFirstClick);
  document.addEventListener("touchstart", unlockAudioOnFirstClick);
});

// オーディオの初期化
function initAudio() {
  audioElements["10min"] = new Audio(AUDIO_PATHS["10min"]);
  audioElements["1min"] = new Audio(AUDIO_PATHS["1min"]);
  
  audioElements["10min"].preload = "auto";
  audioElements["1min"].preload = "auto";
}

// 4. データロード / セーブ (LocalStorage)
function loadFromLocalStorage() {
  const savedReservations = localStorage.getItem("signsound_reservations");
  if (savedReservations) {
    try {
      const parsed = JSON.parse(savedReservations);
      // 旧データのクレンジングとキーの互換性確保
      Object.keys(parsed).forEach(dateKey => {
        Object.keys(parsed[dateKey]).forEach(roomKey => {
          Object.keys(parsed[dateKey][roomKey]).forEach(slotKey => {
            const data = parsed[dateKey][roomKey][slotKey];
            if (data.play2 !== undefined && data.play1 === undefined) {
              data.play1 = data.play2;
              delete data.play2;
            }
            if (data.useMic === undefined) {
              data.useMic = false;
            }
          });
        });
      });
      state.reservations = parsed;
    } catch (e) {
      console.error("Local storage parse error:", e);
    }
  }
  
  const savedVolumeMic = localStorage.getItem("signsound_volume_mic");
  if (savedVolumeMic !== null) {
    const val = parseFloat(savedVolumeMic);
    state.volumeMic = val <= 1.0 ? 70 : val;
  }
  const sliderMic = document.getElementById("volumeSliderMic");
  if (sliderMic) sliderMic.value = state.volumeMic;

  const savedVolumeNoMic = localStorage.getItem("signsound_volume_nomic");
  if (savedVolumeNoMic !== null) {
    const val = parseFloat(savedVolumeNoMic);
    state.volumeNoMic = val <= 1.0 ? 65 : val;
  }
  const sliderNoMic = document.getElementById("volumeSliderNoMic");
  if (sliderNoMic) sliderNoMic.value = state.volumeNoMic;
  
  const savedLogs = localStorage.getItem("signsound_logs");
  if (savedLogs) {
    state.logs = JSON.parse(savedLogs);
  }
  
  // 選択日時の初期化
  initDateDataIfNeeded(state.currentDate);
}

function saveReservations() {
  localStorage.setItem("signsound_reservations", JSON.stringify(state.reservations));
}

function saveLogs() {
  localStorage.setItem("signsound_logs", JSON.stringify(state.logs));
}

// 特定の日付のデータがない場合は初期データを作成
function initDateDataIfNeeded(dateStr) {
  let isNewDate = false;
  if (!state.reservations[dateStr]) {
    state.reservations[dateStr] = {};
    isNewDate = true;
  }
  
  DEFAULT_ROOMS.forEach(room => {
    if (!state.reservations[dateStr][room]) {
      state.reservations[dateStr][room] = {};
      TIME_SLOTS.forEach(slot => {
        state.reservations[dateStr][room][slot.id] = {
          reserved: false, // デフォルト：空室
          play10: true,    // 10分前放送デフォルトON
          play1: true,     // 1分前放送デフォルトON
          useMic: false    // マイク使用デフォルトOFF（小音量）
        };
      });
    }
  });

  // デモンストレーション用初期データのシード (新規日付作成時のみ適用)
  if (isNewDate) {
    // 2. 会議室5: 午前枠 (マイクなし・小音量), 午後枠 (マイクなし)
    state.reservations[dateStr]["会議室5"]["morning"].reserved = true;
    state.reservations[dateStr]["会議室5"]["afternoon"].reserved = true;
    
    // 3. 実習室1: 午前枠 (マイクあり・大音量), 午後枠 (マイクあり)
    state.reservations[dateStr]["実習室1"]["morning"].reserved = true;
    state.reservations[dateStr]["実習室1"]["morning"].useMic = true;
    state.reservations[dateStr]["実習室1"]["afternoon"].reserved = true;
    state.reservations[dateStr]["実習室1"]["afternoon"].useMic = true;
    
    // 4. 研修室: 午後枠 (マイクあり・大音量), 夜間枠 (マイクあり)
    state.reservations[dateStr]["研修室"]["afternoon"].reserved = true;
    state.reservations[dateStr]["研修室"]["afternoon"].useMic = true;
    state.reservations[dateStr]["研修室"]["night"].reserved = true;
    state.reservations[dateStr]["研修室"]["night"].useMic = true;
    
    // 5. 視聴覚室: 午後枠 (マイクあり・大音量), 夜間枠 (マイクなし)
    state.reservations[dateStr]["視聴覚室"]["afternoon"].reserved = true;
    state.reservations[dateStr]["視聴覚室"]["afternoon"].useMic = true;
    state.reservations[dateStr]["視聴覚室"]["night"].reserved = true;
    
    // 6. 会議室1: 午後枠 (マイクなし・小音量)
    state.reservations[dateStr]["会議室1"]["afternoon"].reserved = true;
    
    // 7. 会議室3: 夜間枠 (マイクなし・小音量)
    state.reservations[dateStr]["会議室3"]["night"].reserved = true;
    
    saveReservations(); // シードしたデータをlocalStorageに即時保存
  }
}

// 日付フォーマットヘルパー (YYYY-MM-DD)
function getFormattedDate(dateObj) {
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// 曜日の日本語表記
function getJapaneseWeekday(dateObj) {
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  return weekdays[dateObj.getDay()];
}

// 5. UIの更新処理
function updateDateDisplay() {
  const parts = state.currentDate.split("-");
  const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
  
  const displayStr = `${parts[0]}年${parseInt(parts[1])}月${parseInt(parts[2])}日 (${getJapaneseWeekday(dateObj)})`;
  document.getElementById("currentDateDisplay").innerText = displayStr;
  document.getElementById("datePicker").value = state.currentDate;
}

// 予約表テーブルの描画
function renderScheduleGrid() {
  const tbody = document.getElementById("scheduleTableBody");
  tbody.innerHTML = "";
  
  initDateDataIfNeeded(state.currentDate);
  const dayData = state.reservations[state.currentDate];
  
  // 管理対象のすべての部屋を表示
  const filteredRooms = ROOMS_CONFIG.filter(room => room.managed);
  
  if (filteredRooms.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-muted);">該当する部屋はありません。</td></tr>`;
    return;
  }

  filteredRooms.forEach(roomObj => {
    const room = roomObj.name;
    const tr = document.createElement("tr");
    
    // 会議室名セル
    const roomCell = document.createElement("td");
    roomCell.className = "room-col";
    roomCell.innerHTML = `
      <div>${room}</div>
      <div style="font-size:0.75rem; font-weight:normal; color:var(--text-muted); margin-top:2px;">
        ${roomObj.floor}・${roomObj.wing === 'social' ? '社会教育棟' : roomObj.wing === 'central' ? '中央棟' : '文化ホール棟'}
      </div>
    `;
    tr.appendChild(roomCell);
    
    // 各時間枠のセル
    TIME_SLOTS.forEach(slot => {
      const td = document.createElement("td");
      td.className = "slot-cell";
      td.id = `cell_${room}_${slot.id}`;
      
      const slotData = dayData[room][slot.id];
      if (slotData.useMic === undefined) {
        slotData.useMic = false;
      }
      if (slotData.play1 === undefined) {
        slotData.play1 = true;
      }
      
      // 内包コンテナ
      const innerDiv = document.createElement("div");
      innerDiv.className = "slot-inner";
      
      // 予約ステータスボタン
      const btn = document.createElement("button");
      btn.className = `btn-reserve-toggle ${slotData.reserved ? 'reserved' : 'vacant'}`;
      btn.innerText = slotData.reserved ? "🔴 予約済 (利用中)" : "🟢 空室 (利用なし)";
      
      btn.addEventListener("click", () => {
        slotData.reserved = !slotData.reserved;
        if (slotData.reserved) {
          slotData.play10 = true;
          slotData.play1 = true;
        }
        saveReservations();
        renderScheduleGrid();
        renderFloorMap();
        addLog("sys", `【設定変更】${room} の ${slot.name} を ${slotData.reserved ? '予約済' : '空室'} に変更しました。`);
      });
      
      innerDiv.appendChild(btn);
      
      // 自動放送トグル
      const togglesDiv = document.createElement("div");
      togglesDiv.className = "audio-toggles";
      if (!slotData.reserved) {
        togglesDiv.style.opacity = "0.5";
      }
      
      // 10分前チェックボックス
      const label10 = document.createElement("label");
      label10.className = "audio-toggle-label";
      const chk10 = document.createElement("input");
      chk10.type = "checkbox";
      chk10.checked = slotData.play10;
      chk10.disabled = !slotData.reserved;
      chk10.addEventListener("change", (e) => {
        slotData.play10 = e.target.checked;
        saveReservations();
        renderFloorMap();
        addLog("sys", `【設定変更】${room} ${slot.name} の「10分前放送」を ${slotData.play10 ? '有効' : '無効'} にしました。`);
      });
      label10.appendChild(chk10);
      label10.appendChild(document.createTextNode(" 10分前放送"));
      togglesDiv.appendChild(label10);
      
      // 1分前チェックボックス
      const label1 = document.createElement("label");
      label1.className = "audio-toggle-label";
      const chk1 = document.createElement("input");
      chk1.type = "checkbox";
      chk1.checked = slotData.play1;
      chk1.disabled = !slotData.reserved;
      chk1.addEventListener("change", (e) => {
        slotData.play1 = e.target.checked;
        saveReservations();
        renderFloorMap();
        addLog("sys", `【設定変更】${room} ${slot.name} の「1分前放送」を ${slotData.play1 ? '有効' : '無効'} にしました。`);
      });
      label1.appendChild(chk1);
      label1.appendChild(document.createTextNode(" 1分前放送"));
      togglesDiv.appendChild(label1);
      
      // 🎤 マイク使用 二選一セレクタ (ボタン形式)
      const selectDiv = document.createElement("div");
      selectDiv.style.marginTop = "8px";
      selectDiv.style.borderTop = "1px dashed var(--border-light)";
      selectDiv.style.paddingTop = "8px";
      selectDiv.style.width = "100%";
      
      const labelMic = document.createElement("span");
      labelMic.style.fontSize = "0.75rem";
      labelMic.style.fontWeight = "bold";
      labelMic.style.color = "var(--text-main)";
      labelMic.style.display = "block";
      labelMic.style.marginBottom = "4px";
      labelMic.style.textAlign = "left";
      labelMic.innerText = "マイク使用設定:";
      selectDiv.appendChild(labelMic);
      
      const btnContainer = document.createElement("div");
      btnContainer.style.display = "flex";
      btnContainer.style.backgroundColor = "#f1f3f5";
      btnContainer.style.padding = "2px";
      btnContainer.style.borderRadius = "6px";
      btnContainer.style.width = "100%";
      btnContainer.style.boxSizing = "border-box";
      
      const btnNoMic = document.createElement("button");
      btnNoMic.type = "button";
      btnNoMic.style.flex = "1";
      btnNoMic.style.textAlign = "center";
      btnNoMic.style.border = "none";
      btnNoMic.style.padding = "4px 2px";
      btnNoMic.style.fontSize = "0.7rem";
      btnNoMic.style.fontWeight = "bold";
      btnNoMic.style.borderRadius = "4px";
      btnNoMic.style.cursor = slotData.reserved ? "pointer" : "default";
      btnNoMic.style.transition = "all 0.2s";
      btnNoMic.innerText = "🔇 非使用 (65dB)";
      btnNoMic.disabled = !slotData.reserved;
      
      const btnMic = document.createElement("button");
      btnMic.type = "button";
      btnMic.style.flex = "1";
      btnMic.style.textAlign = "center";
      btnMic.style.border = "none";
      btnMic.style.padding = "4px 2px";
      btnMic.style.fontSize = "0.7rem";
      btnMic.style.fontWeight = "bold";
      btnMic.style.borderRadius = "4px";
      btnMic.style.cursor = slotData.reserved ? "pointer" : "default";
      btnMic.style.transition = "all 0.2s";
      btnMic.innerText = "🎤 使用 (70dB)";
      btnMic.disabled = !slotData.reserved;
      
      // ボタンのスタイル更新
      if (!slotData.reserved) {
        btnNoMic.style.backgroundColor = "#e9ecef";
        btnNoMic.style.color = "#6c757d";
        btnNoMic.style.boxShadow = "none";
        
        btnMic.style.backgroundColor = "#e9ecef";
        btnMic.style.color = "#6c757d";
        btnMic.style.boxShadow = "none";
      } else if (slotData.useMic) {
        btnNoMic.style.backgroundColor = "transparent";
        btnNoMic.style.color = "#495057";
        btnNoMic.style.boxShadow = "none";
        
        btnMic.style.backgroundColor = "var(--status-reserved)";
        btnMic.style.color = "#ffffff";
        btnMic.style.boxShadow = "0 1px 3px rgba(0,0,0,0.15)";
      } else {
        btnNoMic.style.backgroundColor = "#ffffff";
        btnNoMic.style.color = "var(--primary-color)";
        btnNoMic.style.boxShadow = "0 1px 3px rgba(0,0,0,0.15)";
        
        btnMic.style.backgroundColor = "transparent";
        btnMic.style.color = "#495057";
        btnMic.style.boxShadow = "none";
      }
      
      btnNoMic.addEventListener("click", () => {
        if (!slotData.reserved) return;
        slotData.useMic = false;
        saveReservations();
        renderScheduleGrid();
        renderFloorMap();
        addLog("sys", `【設定変更】${room} ${slot.name} の設定を「マイク非使用 (65dB)」にしました。`);
      });
      
      btnMic.addEventListener("click", () => {
        if (!slotData.reserved) return;
        slotData.useMic = true;
        saveReservations();
        renderScheduleGrid();
        renderFloorMap();
        addLog("sys", `【設定変更】${room} ${slot.name} の設定を「マイク使用 (70dB)」にしました。`);
      });
      
      btnContainer.appendChild(btnNoMic);
      btnContainer.appendChild(btnMic);
      selectDiv.appendChild(btnContainer);
      togglesDiv.appendChild(selectDiv);
      
      innerDiv.appendChild(togglesDiv);
      td.appendChild(innerDiv);
      tr.appendChild(td);
    });
    
    tbody.appendChild(tr);
  });
}

// 案内図（マップモード）の動的描画 - architectural blueprint floor maps using interactive SVGs!
function renderFloorMap() {
  const mapContainer = document.getElementById("mapFloorPlan");
  if (!mapContainer) return;
  
  initDateDataIfNeeded(state.currentDate);
  const dayData = state.reservations[state.currentDate];
  
  // --- 1階 案内図 SVGの組み立て（社会教育棟のみ） ---
  const svg1F = `
    <svg viewBox="-10 0 280 485" class="floor-svg" style="width: 100%; height: auto; display: block; flex: 1; max-width: 340px;">
      <defs>
        <pattern id="gridPattern1" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(0, 51, 102, 0.04)" stroke-width="1"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#gridPattern1)" />

      <!-- 1F 各棟のアウトライン/外壁 -->
      <!-- 社会教育棟 -->
      <rect x="25" y="25" width="210" height="450" rx="6" fill="#fcfdfe" stroke="#90a4ae" stroke-width="2" />
      <text x="130" y="20" font-size="11" font-weight="bold" fill="var(--primary-color)" text-anchor="middle">社会教育棟 1F (Social Education Wing)</text>

      <!-- ================= 部屋レイアウト ================= -->
      
      <!-- --- 社会教育棟1F --- -->
      <!-- 🚻 トイレ (非管理) -->
      <g class="svg-room non-managed">
        <rect x="35" y="35" width="125" height="110" rx="3" />
        <text x="97" y="85" font-size="11" font-weight="bold" fill="#78909c" text-anchor="middle">🚻 トイレ / 授乳室</text>
        <text x="97" y="105" font-size="9" fill="#90a4ae" text-anchor="middle">女子・男子・多目的</text>
      </g>
      
      <!-- 和室 (非管理対象) -->
      <g class="svg-room non-managed">
        <rect x="165" y="35" width="60" height="110" rx="3" />
        <text x="195" y="94" font-size="11" font-weight="bold" fill="#78909c" text-anchor="middle">和室</text>
      </g>
      
      <!-- 会議室5 (管理対象) -->
      ${renderSvgRoom("会議室5", "rect", { x: 35, y: 150, width: 70, height: 70, rx: 3 }, dayData)}
      
      <!-- 託児室 (非管理対象) -->
      <g class="svg-room non-managed">
        <rect x="110" y="150" width="115" height="70" rx="3" />
        <text x="167" y="190" font-size="11" font-weight="bold" fill="#78909c" text-anchor="middle">託児室</text>
      </g>
      
      <!-- 図書館事務室 / 南図書館 (非管理) -->
      <g class="svg-room non-managed">
        <rect x="35" y="225" width="190" height="40" rx="3" fill="#eceff1" stroke="#b0bec5" stroke-width="1.5" stroke-dasharray="3" />
        <text x="130" y="249" font-size="11" font-weight="bold" fill="#78909c" text-anchor="middle">図書館事務室</text>
      </g>
      <g class="svg-room non-managed">
        <rect x="35" y="270" width="190" height="195" rx="3" fill="#eceff1" stroke="#b0bec5" stroke-width="1.5" stroke-dasharray="3" />
        <text x="130" y="340" font-size="15" font-weight="bold" fill="#78909c" text-anchor="middle">南図書館 (1F)</text>
        <text x="82" y="420" font-size="10" fill="#90a4ae" text-anchor="middle">閲覧スペース</text>
        <text x="178" y="420" font-size="10" fill="#90a4ae" text-anchor="middle">児童書エリア</text>
        <line x1="130" y1="400" x2="130" y2="440" stroke="#cfd8dc" stroke-dasharray="2" />
      </g>

    </svg>
  `;

  // --- 2階 案内図 SVGの組み立て（社会教育棟のみ） ---
  const svg2F = `
    <svg viewBox="15 0 280 485" class="floor-svg" style="width: 100%; height: auto; display: block; flex: 1; max-width: 340px;">
      <defs>
        <pattern id="gridPattern2" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(0, 51, 102, 0.04)" stroke-width="1"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#gridPattern2)" />

      <!-- 2F 各棟のアウトライン/外壁 -->
      <!-- 社会教育棟 -->
      <rect x="25" y="25" width="260" height="450" rx="6" fill="#fcfdfe" stroke="#90a4ae" stroke-width="2" />
      <text x="155" y="20" font-size="11" font-weight="bold" fill="var(--primary-color)" text-anchor="middle">社会教育棟 2F (Social Education Wing)</text>

      <!-- ================= 部屋レイアウト ================= -->
      
      <!-- --- 社会教育棟2F --- -->
      <!-- 🚻 トイレ (非管理) -->
      <g class="svg-room non-managed">
        <rect x="35" y="35" width="120" height="55" rx="3" />
        <text x="95" y="68" font-size="11" font-weight="bold" fill="#78909c" text-anchor="middle">🚻 男子/女子トイレ</text>
      </g>
      
      <!-- 実習室2 (管理対象) -->
      ${renderSvgRoom("実習室2", "rect", { x: 35, y: 95, width: 140, height: 65, rx: 3 }, dayData)}
      
      <!-- 実習室1 (管理対象) -->
      ${renderSvgRoom("実習室1", "rect", { x: 35, y: 165, width: 140, height: 65, rx: 3 }, dayData)}
      
      <!-- 研修室 (管理対象) -->
      ${renderSvgRoom("研修室", "rect", { x: 35, y: 235, width: 140, height: 75, rx: 3 }, dayData)}
      
      <!-- 視聴覚室 (管理対象) -->
      ${renderSvgRoom("視聴覚室", "rect", { x: 35, y: 315, width: 140, height: 75, rx: 3 }, dayData)}
      
      <!-- 会議室3 (管理対象) -->
      ${renderSvgRoom("会議室3", "rect", { x: 125, y: 395, width: 100, height: 65, rx: 3 }, dayData)}

      <!-- 右列（会議室4, 吹抜, 会議室1-2） -->
      <!-- 会議室4 (管理対象) -->
      ${renderSvgRoom("会議室4", "rect", { x: 185, y: 35, width: 90, height: 65, rx: 3 }, dayData)}
      
      <!-- 吹抜ロビー (非管理) -->
      <g class="svg-room non-managed">
        <rect x="185" y="105" width="90" height="85" rx="3" fill="#eceff1" stroke="#cfd8dc" stroke-width="1.5" stroke-dasharray="3" />
        <text x="230" y="150" font-size="11" font-weight="bold" fill="#90a4ae" text-anchor="middle">吹抜スペース</text>
      </g>
      
      <!-- 会議室1 (管理対象) -->
      ${renderSvgRoom("会議室1", "rect", { x: 185, y: 195, width: 90, height: 65, rx: 3 }, dayData)}
      
      <!-- 会議室2 (管理対象) -->
      ${renderSvgRoom("会議室2", "rect", { x: 185, y: 265, width: 90, height: 65, rx: 3 }, dayData)}

      <!-- 廊下/吹抜 (非管理) -->
      <g class="svg-room non-managed">
        <rect x="185" y="335" width="90" height="55" rx="3" />
        <text x="230" y="368" font-size="10" fill="#90a4ae" text-anchor="middle">2F コリドー</text>
      </g>

    </svg>
  `;
  
  mapContainer.innerHTML = svg1F + svg2F;
}

// 案内図非管理ブロックテンプレート
function createNonManagedBlock(name, extraStyle = "") {
  return ""; 
}

// SVG用管理室ブロック描画ヘルパー
function renderSvgRoom(roomName, svgTag, attrs, dayData) {
  const slotData = dayData[roomName][currentMapSlot];
  if (!slotData) return "";
  
  if (slotData.useMic === undefined) slotData.useMic = false;
  if (slotData.play1 === undefined) slotData.play1 = true;
  
  // 予約状態に応じたCSSクラス決定
  let statusClass = "vacant";
  if (slotData.reserved) {
    statusClass = "reserved";
  }
  
  // 自動放送作動中の点滅ID
  const elementId = `map_cell_${roomName}_${currentMapSlot}`;
  
  // SVGタグ属性の組み立て
  let attrStr = "";
  Object.keys(attrs).forEach(key => {
    attrStr += ` ${key}="${attrs[key]}"`;
  });
  
  // テキスト中央揃え座標の計算
  let cx = 0;
  let cy = 0;
  if (svgTag === "rect") {
    cx = attrs.x + attrs.width / 2;
    cy = attrs.y + attrs.height / 2;
  } else if (svgTag === "path") {
    cx = 820;
    cy = 225;
  }
  
  // 状態テキスト
  let statusText = "空室";
  let micText = "";
  
  if (slotData.reserved) {
    let chkText = "";
    if (slotData.play10 && slotData.play1) chkText = "自動放送:ON";
    else if (slotData.play10) chkText = "10分前のみ";
    else if (slotData.play1) chkText = "1分前のみ";
    else chkText = "放送OFF";
    
    statusText = `利用中 (${chkText})`;
    micText = slotData.useMic ? "🎤大音量" : "🔇小音量";
  }
  
  // 手動クリックイベント呼び出し
  const onclickStr = `onclick="openRoomPopover('${roomName}')"`;
  
  let shapeElement = "";
  if (svgTag === "rect") {
    shapeElement = `<rect class="room-shape ${statusClass}"${attrStr} />`;
  } else if (svgTag === "path") {
    shapeElement = `<path class="room-shape ${statusClass}"${attrStr} />`;
  }
  
  // マイク音量インジケータ（利用中のみ表示）
  let micBadgeElement = "";
  if (slotData.reserved) {
    const badgeColor = slotData.useMic ? "var(--status-reserved)" : "var(--primary-color)";
    micBadgeElement = `
      <g transform="translate(${cx - 30}, ${cy + 22})" style="pointer-events: none;">
        <rect x="0" y="0" width="60" height="13" rx="2" fill="${badgeColor}" />
        <text x="30" y="10" font-size="8" fill="#ffffff" font-weight="bold" text-anchor="middle">${micText}</text>
      </g>
    `;
  }
  
  return `
    <g class="svg-room managed ${statusClass}" id="${elementId}" ${onclickStr}>
      ${shapeElement}
      <text x="${cx}" y="${cy - 5}" class="svg-room-text">${roomName}</text>
      <text x="${cx}" y="${cy + 12}" class="svg-room-status-text">${statusText}</text>
      ${micBadgeElement}
    </g>
  `;
}

// 部屋設定ポップオーバーの展開
function openRoomPopover(roomName) {
  activePopoverRoom = roomName;
  initDateDataIfNeeded(state.currentDate);
  const dayData = state.reservations[state.currentDate];
  const slotData = dayData[roomName][currentMapSlot];
  
  if (slotData.useMic === undefined) slotData.useMic = false;
  if (slotData.play1 === undefined) slotData.play1 = true;
  
  // ポップオーバーのヘッダータイトル更新
  const roomConfig = ROOMS_CONFIG.find(r => r.name === roomName);
  const floorStr = roomConfig.floor;
  const wingStr = roomConfig.wing === 'social' ? '社会教育棟' : roomConfig.wing === 'central' ? '中央棟' : '文化ホール棟';
  const slotStr = TIME_SLOTS.find(s => s.id === currentMapSlot).name;
  
  document.getElementById("popoverRoomTitle").innerText = `${roomName} [${floorStr}・${wingStr} - ${slotStr}]`;
  
  // 利用状況ボタンの反映
  updatePopoverStatusDisplay(slotData.reserved);
  
  // チェックボックス類の反映
  const chk10 = document.getElementById("popoverPlay10");
  const chk1 = document.getElementById("popoverPlay1");
  const btnMicNo = document.getElementById("popoverMicNo");
  const btnMicYes = document.getElementById("popoverMicYes");
  
  chk10.checked = slotData.play10;
  chk1.checked = slotData.play1;
  
  chk10.disabled = !slotData.reserved;
  chk1.disabled = !slotData.reserved;
  btnMicNo.disabled = !slotData.reserved;
  btnMicYes.disabled = !slotData.reserved;
  
  updatePopoverMicButtonsDisplay(slotData.useMic, slotData.reserved);
  
  document.getElementById("popoverAudioToggles").style.opacity = slotData.reserved ? "1" : "0.5";
  
  // モーダル展開
  document.getElementById("roomPopoverOverlay").classList.add("active");
}

function closeRoomPopover() {
  document.getElementById("roomPopoverOverlay").classList.remove("active");
  activePopoverRoom = null;
}

function updatePopoverStatusDisplay(isReserved) {
  const toggleBtn = document.getElementById("popoverReserveToggle");
  if (isReserved) {
    toggleBtn.className = "btn-reserve-toggle reserved";
    toggleBtn.innerText = "🔴 予約済 (利用中)";
  } else {
    toggleBtn.className = "btn-reserve-toggle vacant";
    toggleBtn.innerText = "🟢 空室 (利用なし)";
  }
}

function updatePopoverMicButtonsDisplay(useMic, isReserved) {
  const btnMicNo = document.getElementById("popoverMicNo");
  const btnMicYes = document.getElementById("popoverMicYes");
  
  if (!btnMicNo || !btnMicYes) return;
  
  if (!isReserved) {
    btnMicNo.style.backgroundColor = "#e9ecef";
    btnMicNo.style.color = "#6c757d";
    btnMicNo.style.boxShadow = "none";
    
    btnMicYes.style.backgroundColor = "#e9ecef";
    btnMicYes.style.color = "#6c757d";
    btnMicYes.style.boxShadow = "none";
    return;
  }
  
  if (useMic) {
    btnMicNo.style.backgroundColor = "transparent";
    btnMicNo.style.color = "#495057";
    btnMicNo.style.boxShadow = "none";
    
    btnMicYes.style.backgroundColor = "var(--status-reserved)";
    btnMicYes.style.color = "#ffffff";
    btnMicYes.style.boxShadow = "0 1px 3px rgba(0,0,0,0.15)";
  } else {
    btnMicNo.style.backgroundColor = "#ffffff";
    btnMicNo.style.color = "var(--primary-color)";
    btnMicNo.style.boxShadow = "0 1px 3px rgba(0,0,0,0.15)";
    
    btnMicYes.style.backgroundColor = "transparent";
    btnMicYes.style.color = "#495057";
    btnMicYes.style.boxShadow = "none";
  }
}

function updateVolumeDisplay() {
  // 音量表示は無効化
}

// 6. 音響エンジン (Audio Engine)
function initAudioContextUnlock() {
  if (state.isSystemActivated) return;
  
  const context = new (window.AudioContext || window.webkitAudioContext)();
  if (context.state === 'suspended') {
    context.resume();
  }
  
  const temp1 = new Audio(AUDIO_PATHS["10min"]);
  const temp2 = new Audio(AUDIO_PATHS["1min"]);
  temp1.volume = 0.01;
  temp2.volume = 0.01;
  
  const playPromise1 = temp1.play();
  if (playPromise1 !== undefined) {
    playPromise1.then(() => {
      temp1.pause();
    }).catch(err => {
      console.log("Audio unlock debug 1: ", err);
    });
  }
  
  const playPromise2 = temp2.play();
  if (playPromise2 !== undefined) {
    playPromise2.then(() => {
      temp2.pause();
    }).catch(err => {
      console.log("Audio unlock debug 2: ", err);
    });
  }

  state.isSystemActivated = true;
  
  const badge = document.getElementById("systemStatusBadge");
  badge.className = "status-badge status-active";
  badge.innerText = "稼働中";
  
  const btn = document.getElementById("btnSystemActivate");
  btn.className = "btn-system-activate active";
  btn.innerHTML = "🟢 システム稼働中（音声再生有効）";
  
  addLog("sys", "【システム】会議室利用終了お知らせチャイム管理システムを起動しました。自動音声再生が有効です。");
}

// システム自動有効化処理 (強制オン)
function activateSystemAutomatically() {
  state.isSystemActivated = true;
  
  const badge = document.getElementById("systemStatusBadge");
  if (badge) {
    badge.className = "status-badge status-active";
    badge.innerText = "稼働中";
  }
  
  const btn = document.getElementById("btnSystemActivate");
  if (btn) {
    btn.className = "btn-system-activate active";
    btn.innerHTML = "🟢 システム稼働中（音声再生有効・自動起動済）";
    btn.disabled = true; // 手動操作は不要
    btn.style.cursor = "default";
  }
}

// dB値をHTML5 Audioのリニア音量(0.0〜1.0)に変換するヘルパー
function dbToLinearVolume(db) {
  if (db <= 50) return 0.0;
  if (db >= 90) return 1.0;
  return (db - 50) / 40;
}

// チャイム再生
function playChime(type, roomName = "テスト", slotName = "手動", forceVolume = null) {
  if (!state.isSystemActivated) {
    alert("音声再生を許可するため、左上の「システムを起動する」ボタンを押してください。");
    return;
  }
  
  const audio = audioElements[type];
  if (!audio) return;
  
  let volumeToUse = state.volumeNoMic; // デフォルトはマイクなし音量 (小)
  
  if (forceVolume !== null) {
    volumeToUse = forceVolume;
  } else if (roomName !== "テスト") {
    // 自動再生時は、該当スロットがマイク使用設定になっているか確認
    const dayData = state.reservations[state.currentDate];
    if (dayData && dayData[roomName] && dayData[roomName][slotName]) {
      const slotData = dayData[roomName][slotName];
      if (slotData.useMic) {
        volumeToUse = state.volumeMic;
      }
    }
  }
  
  audio.volume = dbToLinearVolume(volumeToUse);
  audio.currentTime = 0;
  
  // 手動テスト再生ボタンの光るアニメーション設定
  let btnId = "";
  if (roomName === "テスト") {
    if (forceVolume === state.volumeMic) {
      btnId = type === "10min" ? "btnTest10MinMic" : "btnTest1MinMic";
    } else {
      btnId = type === "10min" ? "btnTest10MinNoMic" : "btnTest1MinNoMic";
    }
  }
  
  if (btnId) {
    const testBtn = document.getElementById(btnId);
    if (testBtn) {
      testBtn.classList.add("playing");
      setTimeout(() => {
        testBtn.classList.remove("playing");
      }, 5000); // 5秒後に消す
    }
  }

  // 自動放送時のセル点滅（グリッドとマップ両方を光らせる）
  if (roomName !== "テスト") {
    // テーブル内のセル
    const cell = document.getElementById(`cell_${roomName}_${slotName}`);
    if (cell) {
      cell.classList.add("playing-now");
      setTimeout(() => {
        cell.classList.remove("playing-now");
      }, 15000); // 15秒間光らせる
    }
    // マップ内の部屋
    const mapCell = document.getElementById(`map_cell_${roomName}_${slotName}`);
    if (mapCell) {
      mapCell.classList.add("playing-now");
      setTimeout(() => {
        mapCell.classList.remove("playing-now");
      }, 15000); // 15秒間光らせる
    }
  }
  
  audio.play()
    .then(() => {
      console.log(`Sound played: ${type} at volume ${volumeToUse} for ${roomName}`);
    })
    .catch(err => {
      console.error("音声の再生に失敗しました:", err);
      addLog("sys", `【エラー】音声再生に失敗しました。ブラウザ設定で音声自動再生が許可されているか確認してください。 (詳細: ${err.message})`);
    });
}

// 7. タイマー/時計・シミュレーター処理 (Clock / Tick Engine)
function tick() {
  const now = Date.now();
  const delta = now - lastRealTime;
  lastRealTime = now;
  
  if (simMode) {
    const simulatedDelta = delta * simSpeed;
    systemTime = new Date(systemTime.getTime() + simulatedDelta);
  } else {
    systemTime = new Date();
  }
  
  // 画面の時計表示を更新
  updateClockDisplay();
  
  // 放送トリガーのチェック
  checkBroadcastTriggers();
  
  // カウントダウン表示の更新
  updateCountdown();
}

function updateClockDisplay() {
  const hh = String(systemTime.getHours()).padStart(2, '0');
  const mm = String(systemTime.getMinutes()).padStart(2, '0');
  const ss = String(systemTime.getSeconds()).padStart(2, '0');
  
  document.getElementById("systemClock").innerText = `${hh}:${mm}:${ss}`;
}

// 放送トリガーのチェック
function checkBroadcastTriggers() {
  const dateStr = getFormattedDate(systemTime);
  
  if (dateStr !== state.currentDate) {
    return;
  }
  
  const dayData = state.reservations[dateStr];
  if (!dayData) return;
  
  const currentHours = systemTime.getHours();
  const currentMinutes = systemTime.getMinutes();
  const currentSeconds = systemTime.getSeconds();
  const currMin = currentHours * 60 + currentMinutes + currentSeconds / 60;
  
  DEFAULT_ROOMS.forEach(room => {
    TIME_SLOTS.forEach(slot => {
      const slotData = dayData[room][slot.id];
      if (!slotData || !slotData.reserved) return;
      
      const isMicUsed = slotData.useMic || false;
      const volDb = isMicUsed ? state.volumeMic : state.volumeNoMic;
      const micText = isMicUsed ? `🎤マイク使用中・音量大:${volDb}dB` : `🔇マイク非使用・音量小:${volDb}dB`;
      
      // 10分前放送のチェック (終了時刻の10分前)
      const trigger10Min = slot.endMin - 10;
      const trigger10Key = `${dateStr}_${room}_${slot.id}_10min`;
      if (slotData.play10 && currMin >= trigger10Min && currMin < trigger10Min + 1.0) {
        if (!triggeredToday[trigger10Key]) {
          triggeredToday[trigger10Key] = true;
          playChime("10min", room, slot.id);
          addLog("auto", `【自動放送】${room} の ${slot.name} （終了10分前・${micText}）の予告音声を放送しました。`);
          renderFloorMap(); // 状態更新
        }
      }
      
      // 1分前放送のチェック (終了時刻の1分前)
      const trigger1Min = slot.endMin - 1;
      const trigger1Key = `${dateStr}_${room}_${slot.id}_1min`;
      if (slotData.play1 && currMin >= trigger1Min && currMin < trigger1Min + 1.0) {
        if (!triggeredToday[trigger1Key]) {
          triggeredToday[trigger1Key] = true;
          playChime("1min", room, slot.id);
          addLog("auto", `【自動放送】${room} の ${slot.name} （終了1分前・${micText}）の予告音声を放送しました。`);
          renderFloorMap(); // 状態更新
        }
      }
    });
  });
}

// カウントダウン表示の更新
function updateCountdown() {
  const dateStr = getFormattedDate(systemTime);
  
  const currentHours = systemTime.getHours();
  const currentMinutes = systemTime.getMinutes();
  const currentSeconds = systemTime.getSeconds();
  const currMin = currentHours * 60 + currentMinutes + currentSeconds / 60;
  
  let candidates = [];
  
  const dayData = state.reservations[dateStr];
  
  if (dayData && state.currentDate === dateStr) {
    DEFAULT_ROOMS.forEach(room => {
      TIME_SLOTS.forEach(slot => {
        const slotData = dayData[room][slot.id];
        if (!slotData || !slotData.reserved) return;
        
        // 10分前トリガー
        if (slotData.play10) {
          const t10 = slot.endMin - 10;
          const diff10 = t10 - currMin;
          const triggerKey = `${dateStr}_${room}_${slot.id}_10min`;
          if (diff10 > 0 && !triggeredToday[triggerKey]) {
            candidates.push({
              room: room,
              slotName: slot.name,
              type: "10分前放送",
              useMic: slotData.useMic,
              diff: diff10,
              diffSeconds: Math.ceil(diff10 * 60)
            });
          }
        }
        
        // 1分前トリガー
        if (slotData.play1) {
          const t1 = slot.endMin - 1;
          const diff1 = t1 - currMin;
          const triggerKey = `${dateStr}_${room}_${slot.id}_1min`;
          if (diff1 > 0 && !triggeredToday[triggerKey]) {
            candidates.push({
              room: room,
              slotName: slot.name,
              type: "1分前放送",
              useMic: slotData.useMic,
              diff: diff1,
              diffSeconds: Math.ceil(diff1 * 60)
            });
          }
        }
      });
    });
  }
  
  const countdownBox = document.getElementById("countdownBox");
  const targetDesc = document.getElementById("countdownTargetDesc");
  const timeDisplay = document.getElementById("countdownTime");
  const nextTriggerLabel = document.getElementById("countdownNextTrigger");
  
  const upcomingListContainer = document.getElementById("upcomingListContainer");
  const upcomingList = document.getElementById("upcomingList");
  
  if (candidates.length > 0) {
    // 時間順（近い順）に並び替え
    candidates.sort((a, b) => a.diffSeconds - b.diffSeconds);
    
    // リストの描画
    if (upcomingListContainer && upcomingList) {
      upcomingList.innerHTML = "";
      candidates.forEach(c => {
        const mm = String(Math.floor(c.diffSeconds / 60)).padStart(2, '0');
        const ss = String(c.diffSeconds % 60).padStart(2, '0');
        
        const itemDiv = document.createElement("div");
        itemDiv.style.display = "flex";
        itemDiv.style.justifyContent = "space-between";
        itemDiv.style.alignItems = "center";
        itemDiv.style.background = "#ffffff";
        itemDiv.style.border = "1px solid var(--border-light)";
        itemDiv.style.padding = "6px 8px";
        itemDiv.style.borderRadius = "4px";
        itemDiv.style.fontSize = "0.75rem";
        itemDiv.style.boxShadow = "0 1px 2px rgba(0,0,0,0.02)";
        
        const infoDiv = document.createElement("div");
        infoDiv.innerHTML = `<strong style="color: var(--primary-color);">${c.room}</strong> <span style="color: var(--text-muted); font-size: 0.7rem;">(${c.slotName}・${c.type})</span>`;
        itemDiv.appendChild(infoDiv);
        
        const badgeDiv = document.createElement("div");
        badgeDiv.style.display = "flex";
        badgeDiv.style.alignItems = "center";
        badgeDiv.style.gap = "6px";
        
        const volBadge = document.createElement("span");
        volBadge.style.fontSize = "0.7rem";
        volBadge.style.padding = "2px 4px";
        volBadge.style.borderRadius = "3px";
        if (c.useMic) {
          volBadge.style.background = "#ffebee";
          volBadge.style.color = "var(--status-reserved)";
          volBadge.innerText = `🎤 70dB`;
        } else {
          volBadge.style.background = "#e8f5e9";
          volBadge.style.color = "var(--status-vacant)";
          volBadge.innerText = `🔇 65dB`;
        }
        volBadge.style.fontWeight = "bold";
        badgeDiv.appendChild(volBadge);
        
        const timeBadge = document.createElement("span");
        timeBadge.style.fontWeight = "bold";
        timeBadge.style.color = "var(--status-simulation)";
        timeBadge.innerText = `あと ${mm}:${ss}`;
        badgeDiv.appendChild(timeBadge);
        
        itemDiv.appendChild(badgeDiv);
        upcomingList.appendChild(itemDiv);
      });
      upcomingListContainer.style.display = "block";
    }

    // 最も近い秒数を探す
    let minSec = Infinity;
    candidates.forEach(c => {
      if (c.diffSeconds < minSec) {
        minSec = c.diffSeconds;
      }
    });
    
    // 同じ秒数を持つトリガーを抽出 (複数同時に放送される場合)
    // 許容誤差として ±1秒も含める (誤差があってもまとまるようにする)
    const closest = candidates.filter(c => Math.abs(c.diffSeconds - minSec) <= 1);
    
    if (closest.length > 0) {
      // 部屋名を結合 (例: 「会議室5・和室」)
      const roomNames = closest.map(c => c.room).filter((value, index, self) => self.indexOf(value) === index);
      const roomDetails = roomNames.map(name => `<strong style="color:var(--primary-color)">${name}</strong>`).join("・");
      const slotName = closest[0].slotName;
      
      // 各部屋の放送タイプとマイク使用状況
      const types = closest.map(c => `${c.type}(${c.useMic ? '🎤大音量' : '🔇小音量'})`).filter((value, index, self) => self.indexOf(value) === index);
      
      targetDesc.innerHTML = `${roomDetails}<br>${slotName}の終了に向けた放送`;
      nextTriggerLabel.innerText = `次の放送: ${types.join("・")}`;
      
      const mm = String(Math.floor(minSec / 60)).padStart(2, '0');
      const ss = String(minSec % 60).padStart(2, '0');
      
      timeDisplay.innerText = `${mm}:${ss}`;
      countdownBox.style.backgroundColor = "#e8f0fe";
      return;
    }
  }
  
  // 予定がない場合
  targetDesc.innerText = "本日のアクティブな放送予定はありません";
  timeDisplay.innerText = "--:--";
  nextTriggerLabel.innerText = "予約状況または放送スイッチを確認してください";
  countdownBox.style.backgroundColor = "#f5f5f5";
  if (upcomingListContainer) {
    upcomingListContainer.style.display = "none";
  }
}

// 9. ログ管理処理
function addLog(type, msg) {
  const now = new Date(systemTime);
  const timestamp = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  
  const entry = {
    timestamp: timestamp,
    type: type, // "auto" | "manual" | "sys"
    message: msg
  };
  
  state.logs.unshift(entry);
  
  if (state.logs.length > 100) {
    state.logs.pop();
  }
  
  saveLogs();
  renderLogs();
}

function renderLogs() {
  const panel = document.getElementById("logPanel");
  if (!panel) return;
  panel.innerHTML = "";
  
  if (state.logs.length === 0) {
    panel.innerHTML = `<div style="color:var(--text-muted); text-align:center; padding:10px;">ログ履歴はありません。</div>`;
    return;
  }
  
  state.logs.forEach(log => {
    const div = document.createElement("div");
    div.className = "log-entry";
    
    const timeSpan = document.createElement("span");
    timeSpan.className = "log-time";
    timeSpan.innerText = `[${log.timestamp}]`;
    div.appendChild(timeSpan);
    
    const typeSpan = document.createElement("span");
    typeSpan.className = `log-type ${log.type}`;
    if (log.type === "auto") {
      typeSpan.innerText = "【自動】";
    } else if (log.type === "manual") {
      typeSpan.innerText = "【テスト】";
    } else {
      typeSpan.innerText = "【システム】";
    }
    div.appendChild(typeSpan);
    
    const msgSpan = document.createElement("span");
    msgSpan.className = "log-msg";
    msgSpan.innerText = log.message;
    div.appendChild(msgSpan);
    
    panel.appendChild(div);
  });
}

// 10. イベントリスナー登録と制御
function registerEventListeners() {
  // システム起動ボタン
  document.getElementById("btnSystemActivate").addEventListener("click", () => {
    initAudioContextUnlock();
  });
  
  // 文字サイズ変更
  const fontChanger = document.getElementById("fontSizeChanger");
  fontChanger.addEventListener("click", (e) => {
    if (!e.target.classList.contains("font-btn")) return;
    
    document.querySelectorAll(".font-btn").forEach(btn => btn.classList.remove("active"));
    e.target.classList.add("active");
    
    const size = e.target.dataset.size;
    document.body.className = `font-${size}`;
  });

  // リスト・マップ表示モード切替
  const tabListView = document.getElementById("tabListView");
  const tabMapView = document.getElementById("tabMapView");
  const listViewSection = document.getElementById("listViewSection");
  const mapViewSection = document.getElementById("mapViewSection");
  
  tabListView.addEventListener("click", () => {
    tabListView.classList.add("active");
    tabMapView.classList.remove("active");
    listViewSection.style.display = "block";
    mapViewSection.style.display = "none";
    renderScheduleGrid(); 
  });
  
  tabMapView.addEventListener("click", () => {
    tabMapView.classList.add("active");
    tabListView.classList.remove("active");
    listViewSection.style.display = "none";
    mapViewSection.style.display = "block";
    renderFloorMap(); 
  });



  // マップ時間枠セレクタ
  const mapTimeSlotSelector = document.getElementById("mapTimeSlotSelector");
  mapTimeSlotSelector.addEventListener("change", (e) => {
    currentMapSlot = e.target.value;
    renderFloorMap();
  });



  // ポップオーバー閉じイベント
  document.getElementById("popoverCloseBtn").addEventListener("click", closeRoomPopover);
  document.getElementById("roomPopoverOverlay").addEventListener("click", (e) => {
    if (e.target.id === "roomPopoverOverlay") {
      closeRoomPopover();
    }
  });

  // ポップオーバー内の予約切替
  const popoverReserveToggle = document.getElementById("popoverReserveToggle");
  popoverReserveToggle.addEventListener("click", () => {
    if (!activePopoverRoom) return;
    
    initDateDataIfNeeded(state.currentDate);
    const dayData = state.reservations[state.currentDate];
    const slotData = dayData[activePopoverRoom][currentMapSlot];
    
    slotData.reserved = !slotData.reserved;
    if (slotData.reserved) {
      slotData.play10 = true;
      slotData.play1 = true;
    }
    
    // コントロール類の有効無効と状態反映
    const chk10 = document.getElementById("popoverPlay10");
    const chk1 = document.getElementById("popoverPlay1");
    const btnMicNo = document.getElementById("popoverMicNo");
    const btnMicYes = document.getElementById("popoverMicYes");
    
    chk10.checked = slotData.play10;
    chk1.checked = slotData.play1;
    
    chk10.disabled = !slotData.reserved;
    chk1.disabled = !slotData.reserved;
    btnMicNo.disabled = !slotData.reserved;
    btnMicYes.disabled = !slotData.reserved;
    
    updatePopoverMicButtonsDisplay(slotData.useMic, slotData.reserved);
    
    document.getElementById("popoverAudioToggles").style.opacity = slotData.reserved ? "1" : "0.5";
    
    saveReservations();
    updatePopoverStatusDisplay(slotData.reserved);
    renderScheduleGrid();
    renderFloorMap();
    
    const slotStr = TIME_SLOTS.find(s => s.id === currentMapSlot).name;
    addLog("sys", `【案内図操作】${activePopoverRoom} の ${slotStr} を ${slotData.reserved ? '予約済' : '空室'} に変更しました。`);
  });

  // ポップオーバー内自動放送チェックボックス変更
  document.getElementById("popoverPlay10").addEventListener("change", (e) => {
    if (!activePopoverRoom) return;
    const dayData = state.reservations[state.currentDate];
    const slotData = dayData[activePopoverRoom][currentMapSlot];
    slotData.play10 = e.target.checked;
    saveReservations();
    renderScheduleGrid();
    renderFloorMap();
    const slotStr = TIME_SLOTS.find(s => s.id === currentMapSlot).name;
    addLog("sys", `【案内図操作】${activePopoverRoom} ${slotStr} の「10分前放送」を ${slotData.play10 ? '有効' : '無効'} にしました。`);
  });

  document.getElementById("popoverPlay1").addEventListener("change", (e) => {
    if (!activePopoverRoom) return;
    const dayData = state.reservations[state.currentDate];
    const slotData = dayData[activePopoverRoom][currentMapSlot];
    slotData.play1 = e.target.checked;
    saveReservations();
    renderScheduleGrid();
    renderFloorMap();
    const slotStr = TIME_SLOTS.find(s => s.id === currentMapSlot).name;
    addLog("sys", `【案内図操作】${activePopoverRoom} ${slotStr} の「1分前放送」を ${slotData.play1 ? '有効' : '無効'} にしました。`);
  });

  // ポップオーバー内マイク設定切り替え（二者択一）
  document.getElementById("popoverMicNo").addEventListener("click", () => {
    if (!activePopoverRoom) return;
    const dayData = state.reservations[state.currentDate];
    const slotData = dayData[activePopoverRoom][currentMapSlot];
    if (!slotData.reserved) return;
    
    slotData.useMic = false;
    saveReservations();
    updatePopoverMicButtonsDisplay(false, true);
    renderScheduleGrid();
    renderFloorMap();
    
    const slotStr = TIME_SLOTS.find(s => s.id === currentMapSlot).name;
    addLog("sys", `【案内図操作】${activePopoverRoom} ${slotStr} を「マイク非使用 (65dB)」に設定しました。`);
  });

  document.getElementById("popoverMicYes").addEventListener("click", () => {
    if (!activePopoverRoom) return;
    const dayData = state.reservations[state.currentDate];
    const slotData = dayData[activePopoverRoom][currentMapSlot];
    if (!slotData.reserved) return;
    
    slotData.useMic = true;
    saveReservations();
    updatePopoverMicButtonsDisplay(true, true);
    renderScheduleGrid();
    renderFloorMap();
    
    const slotStr = TIME_SLOTS.find(s => s.id === currentMapSlot).name;
    addLog("sys", `【案内図操作】${activePopoverRoom} ${slotStr} を「マイク使用 (70dB)」に設定しました。`);
  });

  // ポップオーバー手動テスト再生
  document.getElementById("popoverTestPlayBtn").addEventListener("click", () => {
    if (!activePopoverRoom) return;
    const dayData = state.reservations[state.currentDate];
    const slotData = dayData[activePopoverRoom][currentMapSlot];
    const volToUse = slotData.reserved && slotData.useMic ? state.volumeMic : state.volumeNoMic;
    
    playChime("10min", "テスト", "手動", volToUse);
    const volDb = volToUse;
    addLog("manual", `「手動テスト再生（${activePopoverRoom}基準・音量:${volDb}dB）」を実行しました。`);
  });
  
  // 日付ピッカーの操作
  const datePicker = document.getElementById("datePicker");
  datePicker.addEventListener("change", (e) => {
    if (e.target.value) {
      state.currentDate = e.target.value;
      updateDateDisplay();
      renderScheduleGrid();
      renderFloorMap();
      addLog("sys", `【表示切替】表示日を ${state.currentDate} に変更しました。`);
    }
  });
  
  // 前の日ボタン
  document.getElementById("btnPrevDay").addEventListener("click", () => {
    const parts = state.currentDate.split("-");
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    d.setDate(d.getDate() - 1);
    state.currentDate = getFormattedDate(d);
    updateDateDisplay();
    renderScheduleGrid();
    renderFloorMap();
    addLog("sys", `【表示切替】表示日を ${state.currentDate} に変更しました。`);
  });
  
  // 次の日ボタン
  document.getElementById("btnNextDay").addEventListener("click", () => {
    const parts = state.currentDate.split("-");
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    d.setDate(d.getDate() + 1);
    state.currentDate = getFormattedDate(d);
    updateDateDisplay();
    renderScheduleGrid();
    renderFloorMap();
    addLog("sys", `【表示切替】表示日を ${state.currentDate} に変更しました。`);
  });
  
  // ログクリア
  document.getElementById("btnClearLog").addEventListener("click", () => {
    state.logs = [];
    saveLogs();
    renderLogs();
  });
  
  // 一括設定：全会議室を「予約済」にする
  document.getElementById("btnBulkReserve").addEventListener("click", () => {
    initDateDataIfNeeded(state.currentDate);
    const dayData = state.reservations[state.currentDate];
    DEFAULT_ROOMS.forEach(room => {
      TIME_SLOTS.forEach(slot => {
        dayData[room][slot.id].reserved = true;
        dayData[room][slot.id].play10 = true;
        dayData[room][slot.id].play1 = true;
      });
    });
    saveReservations();
    renderScheduleGrid();
    renderFloorMap();
    addLog("sys", `【一括設定】${state.currentDate} の全会議室・時間枠を「予約済（自動放送有効）」に一括設定しました。`);
  });
  
  // 一括設定：全会議室を「空室」にする
  document.getElementById("btnBulkVacant").addEventListener("click", () => {
    initDateDataIfNeeded(state.currentDate);
    const dayData = state.reservations[state.currentDate];
    DEFAULT_ROOMS.forEach(room => {
      TIME_SLOTS.forEach(slot => {
        dayData[room][slot.id].reserved = false;
      });
    });
    saveReservations();
    renderScheduleGrid();
    renderFloorMap();
    addLog("sys", `【一括設定】${state.currentDate} の全会議室・時間枠を「空室（自動放送無効）」に一括設定しました。`);
  });
  
  // 一括設定：本日の設定をリセット
  document.getElementById("btnBulkReset").addEventListener("click", () => {
    if (confirm("本日のすべての部屋の予約状況と放送チェックボックスを初期化します。よろしいですか？")) {
      delete state.reservations[state.currentDate];
      initDateDataIfNeeded(state.currentDate);
      saveReservations();
      renderScheduleGrid();
      renderFloorMap();
      triggeredToday = {};
      addLog("sys", `【一括設定】${state.currentDate} の設定をデフォルト値（すべて空室）にリセットしました。`);
    }
  });
  
  // シミュレーターチェックボックス
  const simCheckbox = document.getElementById("simModeCheckbox");
  const simControls = document.getElementById("simControls");
  simCheckbox.addEventListener("change", (e) => {
    const isChecked = e.target.checked;
    if (isChecked) {
      simControls.style.opacity = "1";
      simControls.style.pointerEvents = "auto";
      addLog("sys", "【シミュレーター】時間シミュレーターが有効になりました。「確定」ボタンを押すと仮想時刻が適用されます。");
    } else {
      simMode = false;
      simControls.style.opacity = "0.5";
      simControls.style.pointerEvents = "none";
      document.getElementById("clockLabel").innerText = "現在時刻:";
      document.getElementById("clockLabel").style.color = "#ffcc00";
      
      systemTime = new Date();
      triggeredToday = {};
      addLog("sys", "【シミュレーター】実時間モードに戻りました。");
    }
  });

  // 確定ボタンクリックで仮想時間適用
  document.getElementById("btnApplySimTime").addEventListener("click", () => {
    if (!simCheckbox.checked) return;
    
    simMode = true;
    document.getElementById("clockLabel").innerText = "仮想時刻:";
    document.getElementById("clockLabel").style.color = "var(--status-simulation)";
    
    setSimTimeFromInput();
    addLog("sys", "【シミュレーター】検証用シミュレーションモードを開始しました。");
  });
  
  // 仮想時刻入力変更（すでにシミュレーション開始している場合のみ自動で適用）
  document.getElementById("simTimeInput").addEventListener("change", () => {
    if (simMode) {
      setSimTimeFromInput();
    }
  });
  
  // シミュレーション速度変更
  document.querySelectorAll(".sim-speed-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      document.querySelectorAll(".sim-speed-btn").forEach(b => b.classList.remove("active"));
      e.target.classList.add("active");
      simSpeed = parseInt(e.target.dataset.speed);
      addLog("sys", `【シミュレーター】時間の進行倍率を ${simSpeed} 倍速 に設定しました。`);
    });
  });
}

// 入力フォームからシミュレータ用の仮想時刻を再計算してセットする
function setSimTimeFromInput() {
  const timeVal = document.getElementById("simTimeInput").value;
  if (!timeVal) return;
  
  const parts = timeVal.split(":");
  const hours = parseInt(parts[0]);
  const minutes = parseInt(parts[1]);
  const seconds = parts[2] ? parseInt(parts[2]) : 0;
  
  const dateParts = state.currentDate.split("-");
  
  systemTime = new Date(
    parseInt(dateParts[0]),
    parseInt(dateParts[1]) - 1,
    parseInt(dateParts[2]),
    hours,
    minutes,
    seconds
  );
  
  triggeredToday = {};
  addLog("sys", `【シミュレーター】仮想設定時刻を ${hours}時${minutes}分${String(seconds).padStart(2, '0')}秒 に設定しました。再生履歴をクリアしました。`);
}
