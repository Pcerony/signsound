// app.js - 福岡市南区市民会館 退室音響管理システム 制御スクリプト

// 1. 定数定義
const DEFAULT_ROOMS = [
  "多目的ホール",
  "第1会議室",
  "第2会議室",
  "第3会議室",
  "研修室",
  "和室"
];

const TIME_SLOTS = [
  { id: "morning", name: "午前枠", start: "09:00", end: "11:00", startMin: 9 * 60, endMin: 11 * 60 },
  { id: "afternoon", name: "午後枠", start: "13:00", end: "15:00", startMin: 13 * 60, endMin: 15 * 60 },
  { id: "night", name: "夜間枠", start: "18:00", end: "21:00", startMin: 18 * 60, endMin: 21 * 60 }
];

// 音声ファイルへのパス (相対パス)
const AUDIO_PATHS = {
  "10min": "アーカイブ 3/10分前v2.wav",
  "2min": "アーカイブ 3/1分前v2.wav" // ユーザー要望に従い、2分前のタイミングで「1分前v2.wav」を使用
};

// 2. 状態変数 (State)
let state = {
  currentDate: "",          // "YYYY-MM-DD" フォーマット
  reservations: {},         // { "YYYY-MM-DD": { "部屋名": { "slotId": { reserved: bool, play10: bool, play2: bool, useMic: bool } } } }
  isSystemActivated: false, // ブラウザ音声アンロック状態
  volumeMic: 0.9,           // マイク使用時の大音量
  volumeNoMic: 0.4,         // マイク非使用時の小音量
  logs: []
};

// リアルタイム / シミュレーション時間管理
let systemTime = new Date();
let lastRealTime = Date.now();
let simMode = false;
let simSpeed = 1;
let triggeredToday = {}; // { "YYYY-MM-DD_room_slot_type": true } (当日再生済みのトリガー重複防止)

// オーディオ要素
let audioElements = {
  "10min": null,
  "2min": null
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
  
  // 日付ピッカーの初期値設定
  const datePicker = document.getElementById("datePicker");
  datePicker.value = todayStr;
  
  // 画面表示更新
  updateDateDisplay();
  renderScheduleGrid();
  updateVolumeDisplay();
  renderLogs();
  
  // イベントリスナーの登録
  registerEventListeners();
  
  // 1秒に1回動くメインループ開始
  setInterval(tick, 100); // 高精度シミュレーションのために100ms周期でチェック
});

// オーディオの初期化
function initAudio() {
  audioElements["10min"] = new Audio(AUDIO_PATHS["10min"]);
  audioElements["2min"] = new Audio(AUDIO_PATHS["2min"]);
  
  audioElements["10min"].preload = "auto";
  audioElements["2min"].preload = "auto";
}

// 4. データロード / セーブ (LocalStorage)
function loadFromLocalStorage() {
  const savedReservations = localStorage.getItem("signsound_reservations");
  if (savedReservations) {
    state.reservations = JSON.parse(savedReservations);
  }
  
  const savedVolumeMic = localStorage.getItem("signsound_volume_mic");
  if (savedVolumeMic !== null) {
    state.volumeMic = parseFloat(savedVolumeMic);
  }
  document.getElementById("volumeSliderMic").value = state.volumeMic;

  const savedVolumeNoMic = localStorage.getItem("signsound_volume_nomic");
  if (savedVolumeNoMic !== null) {
    state.volumeNoMic = parseFloat(savedVolumeNoMic);
  }
  document.getElementById("volumeSliderNoMic").value = state.volumeNoMic;
  
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
  if (!state.reservations[dateStr]) {
    state.reservations[dateStr] = {};
  }
  
  DEFAULT_ROOMS.forEach(room => {
    if (!state.reservations[dateStr][room]) {
      state.reservations[dateStr][room] = {};
      TIME_SLOTS.forEach(slot => {
        state.reservations[dateStr][room][slot.id] = {
          reserved: false, // デフォルト：空室
          play10: true,    // 10分前放送デフォルトON
          play2: true,     // 2分前放送デフォルトON
          useMic: false    // マイク使用デフォルトOFF（小音量）
        };
      });
    }
  });
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
  
  DEFAULT_ROOMS.forEach(room => {
    const tr = document.createElement("tr");
    
    // 会議室名セル
    const roomCell = document.createElement("td");
    roomCell.className = "room-col";
    roomCell.innerText = room;
    tr.appendChild(roomCell);
    
    // 各時間枠のセル
    TIME_SLOTS.forEach(slot => {
      const td = document.createElement("td");
      td.className = "slot-cell";
      td.id = `cell_${room}_${slot.id}`;
      
      const slotData = dayData[room][slot.id];
      // 後方互換性の確保
      if (slotData.useMic === undefined) {
        slotData.useMic = false;
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
        // 予約済に切り替えたら、自動放送の初期チェックをONにする
        if (slotData.reserved) {
          slotData.play10 = true;
          slotData.play2 = true;
        }
        saveReservations();
        renderScheduleGrid();
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
        addLog("sys", `【設定変更】${room} ${slot.name} の「10分前放送」を ${slotData.play10 ? '有効' : '無効'} にしました。`);
      });
      label10.appendChild(chk10);
      label10.appendChild(document.createTextNode(" 10分前放送"));
      togglesDiv.appendChild(label10);
      
      // 2分前チェックボックス
      const label2 = document.createElement("label");
      label2.className = "audio-toggle-label";
      const chk2 = document.createElement("input");
      chk2.type = "checkbox";
      chk2.checked = slotData.play2;
      chk2.disabled = !slotData.reserved;
      chk2.addEventListener("change", (e) => {
        slotData.play2 = e.target.checked;
        saveReservations();
        addLog("sys", `【設定変更】${room} ${slot.name} の「2分前放送」を ${slotData.play2 ? '有効' : '無効'} にしました。`);
      });
      label2.appendChild(chk2);
      label2.appendChild(document.createTextNode(" 2分前放送"));
      togglesDiv.appendChild(label2);
      
      // 🎤 マイク使用チェックボックス (音量大・小の切り替え)
      const labelMic = document.createElement("label");
      labelMic.className = "audio-toggle-label";
      labelMic.style.color = "var(--status-reserved)";
      labelMic.style.fontWeight = "bold";
      labelMic.style.marginTop = "4px";
      labelMic.style.borderTop = "1px dashed var(--border-light)";
      labelMic.style.paddingTop = "4px";
      
      const chkMic = document.createElement("input");
      chkMic.type = "checkbox";
      chkMic.checked = slotData.useMic;
      chkMic.disabled = !slotData.reserved;
      chkMic.addEventListener("change", (e) => {
        slotData.useMic = e.target.checked;
        saveReservations();
        renderScheduleGrid(); // アイコン等の表示更新
        const volPercent = Math.round((slotData.useMic ? state.volumeMic : state.volumeNoMic) * 100);
        addLog("sys", `【設定変更】${room} ${slot.name} の「マイク使用（音量大:${volPercent}%）」を ${slotData.useMic ? 'ON' : 'OFF'} にしました。`);
      });
      labelMic.appendChild(chkMic);
      labelMic.appendChild(document.createTextNode(" 🎤 マイク使用 (大)"));
      togglesDiv.appendChild(labelMic);
      
      innerDiv.appendChild(togglesDiv);
      td.appendChild(innerDiv);
      tr.appendChild(td);
    });
    
    tbody.appendChild(tr);
  });
}

function updateVolumeDisplay() {
  document.getElementById("volumeValueMic").innerText = `${Math.round(state.volumeMic * 100)}%`;
  document.getElementById("volumeValueNoMic").innerText = `${Math.round(state.volumeNoMic * 100)}%`;
}

// 6. 音響エンジン (Audio Engine)
function initAudioContextUnlock() {
  if (state.isSystemActivated) return;
  
  // ダミー音声を一瞬鳴らして音声出力をアンロック
  const context = new (window.AudioContext || window.webkitAudioContext)();
  if (context.state === 'suspended') {
    context.resume();
  }
  
  // WAVファイルを0音量で少し再生してアンロックを完了させる
  const temp1 = new Audio(AUDIO_PATHS["10min"]);
  const temp2 = new Audio(AUDIO_PATHS["2min"]);
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
  
  addLog("sys", "【システム】退室音響管理システムを起動しました。自動音声再生が有効です。");
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
  
  audio.volume = volumeToUse;
  audio.currentTime = 0;
  
  // 手動テスト再生ボタンの光るアニメーション設定
  let btnId = "";
  if (roomName === "テスト") {
    if (forceVolume === state.volumeMic) {
      btnId = type === "10min" ? "btnTest10MinMic" : "btnTest2MinMic";
    } else {
      btnId = type === "10min" ? "btnTest10MinNoMic" : "btnTest2MinNoMic";
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

  // 自動放送時は、該当するセルのスタイルを一時的に光らせる
  if (roomName !== "テスト") {
    const cell = document.getElementById(`cell_${roomName}_${slotName}`);
    if (cell) {
      cell.classList.add("playing-now");
      setTimeout(() => {
        cell.classList.remove("playing-now");
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
      const volPercent = Math.round((isMicUsed ? state.volumeMic : state.volumeNoMic) * 100);
      const micText = isMicUsed ? `🎤マイク使用中・音量大:${volPercent}%` : `🔇マイク非使用・音量小:${volPercent}%`;
      
      // 10分前放送のチェック (終了時刻の10分前)
      const trigger10Min = slot.endMin - 10;
      const trigger10Key = `${dateStr}_${room}_${slot.id}_10min`;
      if (slotData.play10 && currMin >= trigger10Min && currMin < trigger10Min + 1.0) {
        if (!triggeredToday[trigger10Key]) {
          triggeredToday[trigger10Key] = true;
          playChime("10min", room, slot.id);
          addLog("auto", `【自動放送】${room} の ${slot.name} （終了10分前・${micText}）の予告音声を放送しました。`);
        }
      }
      
      // 2分前放送のチェック (終了時刻の2分前)
      const trigger2Min = slot.endMin - 2;
      const trigger2Key = `${dateStr}_${room}_${slot.id}_2min`;
      if (slotData.play2 && currMin >= trigger2Min && currMin < trigger2Min + 1.0) {
        if (!triggeredToday[trigger2Key]) {
          triggeredToday[trigger2Key] = true;
          playChime("2min", room, slot.id);
          addLog("auto", `【自動放送】${room} の ${slot.name} （終了2分前・${micText}）の予告音声を放送しました。`);
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
  
  let nextTrigger = null;
  let minDiff = Infinity;
  let targetRoom = "";
  let targetSlotName = "";
  let targetType = "";
  
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
          if (diff10 > 0 && diff10 < minDiff && !triggeredToday[triggerKey]) {
            minDiff = diff10;
            targetRoom = room;
            targetSlotName = slot.name;
            targetType = `10分前放送 (${slotData.useMic ? '🎤大音量' : '🔇小音量'})`;
            nextTrigger = t10;
          }
        }
        
        // 2分前トリガー
        if (slotData.play2) {
          const t2 = slot.endMin - 2;
          const diff2 = t2 - currMin;
          const triggerKey = `${dateStr}_${room}_${slot.id}_2min`;
          if (diff2 > 0 && diff2 < minDiff && !triggeredToday[triggerKey]) {
            minDiff = diff2;
            targetRoom = room;
            targetSlotName = slot.name;
            targetType = `2分前放送 (${slotData.useMic ? '🎤大音量' : '🔇小音量'})`;
            nextTrigger = t2;
          }
        }
      });
    });
  }
  
  const countdownBox = document.getElementById("countdownBox");
  const targetDesc = document.getElementById("countdownTargetDesc");
  const timeDisplay = document.getElementById("countdownTime");
  const nextTriggerLabel = document.getElementById("countdownNextTrigger");
  
  if (nextTrigger !== null) {
    targetDesc.innerHTML = `<strong style="color:var(--primary-color)">${targetRoom}</strong><br>${targetSlotName}の終了に向けた放送`;
    nextTriggerLabel.innerText = `次の放送: ${targetType}`;
    
    const totalSeconds = Math.ceil(minDiff * 60);
    const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const ss = String(totalSeconds % 60).padStart(2, '0');
    
    timeDisplay.innerText = `${mm}:${ss}`;
    countdownBox.style.backgroundColor = "#e8f0fe";
  } else {
    targetDesc.innerText = "本日のアクティブな放送予定はありません";
    timeDisplay.innerText = "--:--";
    nextTriggerLabel.innerText = "予約状況または放送スイッチを確認してください";
    countdownBox.style.backgroundColor = "#f5f5f5";
  }
}

// 8. ログ管理処理
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

// 9. イベントリスナー登録と制御
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
  
  // マイク使用時のボリュームスライダー変更
  const volSliderMic = document.getElementById("volumeSliderMic");
  volSliderMic.addEventListener("input", (e) => {
    state.volumeMic = parseFloat(e.target.value);
    localStorage.setItem("signsound_volume_mic", state.volumeMic);
    updateVolumeDisplay();
  });
  
  // マイク非使用時のボリュームスライダー変更
  const volSliderNoMic = document.getElementById("volumeSliderNoMic");
  volSliderNoMic.addEventListener("input", (e) => {
    state.volumeNoMic = parseFloat(e.target.value);
    localStorage.setItem("signsound_volume_nomic", state.volumeNoMic);
    updateVolumeDisplay();
  });
  
  // 手動テスト再生（マイク使用あり・音量大）
  document.getElementById("btnTest10MinMic").addEventListener("click", () => {
    playChime("10min", "テスト", "手動", state.volumeMic);
    const volPercent = Math.round(state.volumeMic * 100);
    addLog("manual", `「10分前予告音（マイク使用中・音量大:${volPercent}%）」の手動テスト再生を実行しました。`);
  });
  
  document.getElementById("btnTest2MinMic").addEventListener("click", () => {
    playChime("2min", "テスト", "手動", state.volumeMic);
    const volPercent = Math.round(state.volumeMic * 100);
    addLog("manual", `「2分前予告音（マイク使用中・音量大:${volPercent}%）」の手動テスト再生を実行しました。`);
  });

  // 手動テスト再生（マイクなし・音量小）
  document.getElementById("btnTest10MinNoMic").addEventListener("click", () => {
    playChime("10min", "テスト", "手動", state.volumeNoMic);
    const volPercent = Math.round(state.volumeNoMic * 100);
    addLog("manual", `「10分前予告音（マイクなし・音量小:${volPercent}%）」の手動テスト再生を実行しました。`);
  });
  
  document.getElementById("btnTest2MinNoMic").addEventListener("click", () => {
    playChime("2min", "テスト", "手動", state.volumeNoMic);
    const volPercent = Math.round(state.volumeNoMic * 100);
    addLog("manual", `「2分前予告音（マイクなし・音量小:${volPercent}%）」の手動テスト再生を実行しました。`);
  });
  
  // 日付ピッカーの操作
  const datePicker = document.getElementById("datePicker");
  datePicker.addEventListener("change", (e) => {
    if (e.target.value) {
      state.currentDate = e.target.value;
      updateDateDisplay();
      renderScheduleGrid();
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
        dayData[room][slot.id].play2 = true;
      });
    });
    saveReservations();
    renderScheduleGrid();
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
    addLog("sys", `【一括設定】${state.currentDate} の全会議室・時間枠を「空室（自動放送無効）」に一括設定しました。`);
  });
  
  // 一括設定：本日の設定をリセット
  document.getElementById("btnBulkReset").addEventListener("click", () => {
    if (confirm("本日のすべての部屋の予約状況と放送チェックボックスを初期化します。よろしいですか？")) {
      delete state.reservations[state.currentDate];
      initDateDataIfNeeded(state.currentDate);
      saveReservations();
      renderScheduleGrid();
      triggeredToday = {};
      addLog("sys", `【一括設定】${state.currentDate} の設定をデフォルト値（すべて空室）にリセットしました。`);
    }
  });
  
  // シミュレーターチェックボックス
  const simCheckbox = document.getElementById("simModeCheckbox");
  const simControls = document.getElementById("simControls");
  simCheckbox.addEventListener("change", (e) => {
    simMode = e.target.checked;
    if (simMode) {
      simControls.style.opacity = "1";
      simControls.style.pointerEvents = "auto";
      document.getElementById("clockLabel").innerText = "仮想時刻:";
      document.getElementById("clockLabel").style.color = "var(--status-simulation)";
      
      setSimTimeFromInput();
      addLog("sys", "【シミュレーター】検証用シミュレーションモードを開始しました。");
    } else {
      simControls.style.opacity = "0.5";
      simControls.style.pointerEvents = "none";
      document.getElementById("clockLabel").innerText = "現在時刻:";
      document.getElementById("clockLabel").style.color = "#ffcc00";
      
      systemTime = new Date();
      triggeredToday = {};
      addLog("sys", "【シミュレーター】実時間モードに戻りました。");
    }
  });
  
  // 仮想時刻入力変更
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
  
  const dateParts = state.currentDate.split("-");
  
  systemTime = new Date(
    parseInt(dateParts[0]),
    parseInt(dateParts[1]) - 1,
    parseInt(dateParts[2]),
    hours,
    minutes,
    0
  );
  
  triggeredToday = {};
  addLog("sys", `【シミュレーター】仮想設定時刻を ${hours}時${minutes}分00秒 に設定しました。再生履歴をクリアしました。`);
}
