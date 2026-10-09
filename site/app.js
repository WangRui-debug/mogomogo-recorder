/* Local-only PCM recording. No audio is uploaded to the server. */
'use strict';

const STORAGE_PREFIX = `mogomogo-public:${location.pathname.replace(/index\.html$/, '')}:`;
const $ = (id) => document.getElementById(id);
const state = {
  db: null, script: null, session: null, sessions: [], takes: [], index: 0, mode: 'H',
  viewTake: null, busy: false, phase: 'idle', purpose: null, capture: null,
  stream: null, context: null, node: null, analyser: null, source: null, mute: null,
  chunks: [], started: 0, autoStop: null, stopResolve: null, reviewURL: null,
  practiceURL: null, micSettings: null, tabBlocked: false, unsaved: null, attempt: 0,
};
const positionKey = () => `${state.mode}${state.script.sentences[state.index].id}`;
const isRecording = () => state.phase !== 'idle';
const locked = () => isRecording() || state.busy || state.tabBlocked;
const icons = () => window.lucide.createIcons();
const notes = {
  '06': '木槌：きづち', '08': 'ナミ：人名（なみ）／みなも：そのまま読んでください。',
  '09': '銘柄：めいがら／納めた：おさめた',
  '10': '東寺：とうじ／五大明王：ごだいみょうおう／明王：みょうおう',
  '11': '風：ふう',
};

function error(message) {
  $('error-banner').textContent = message;
  $('error-banner').hidden = !message;
}
let toastTimer;
function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
}
function report(cause) {
  console.error(cause);
  const explanations = {
    NotAllowedError: 'マイクの使用が許可されていません。ブラウザのサイト設定を確認してください。',
    NotFoundError: 'マイクが見つかりません。接続を確認してください。',
    NotReadableError: 'マイクを開始できません。他のアプリの使用状況を確認してください。',
    QuotaExceededError: 'ブラウザの保存容量が不足しています。録音データをダウンロードしてください。',
  };
  error(explanations[cause.name] || `処理できませんでした：${cause.message || cause}`);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(STORAGE_PREFIX + 'recordings-v1', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('sessions', { keyPath: 'id' });
      const takes = request.result.createObjectStore('takes', { keyPath: 'id' });
      takes.createIndex('sessionId', 'sessionId');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function getAll(storeName, sessionId) {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(storeName);
    const store = transaction.objectStore(storeName);
    const request = sessionId ? store.index('sessionId').getAll(sessionId) : store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function put(storeName, data) {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(data);
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error || new Error('保存が中断されました。'));
    transaction.onerror = () => {};
  });
}
async function saveSession() {
  state.session.position = { index: state.index, mode: state.mode };
  await put('sessions', state.session);
  localStorage.setItem(STORAGE_PREFIX + 'current-session', state.session.id);
}
async function refreshSessions() {
  state.sessions = (await getAll('sessions')).sort((a, b) => b.created.localeCompare(a.created));
  $('session-select').replaceChildren(...state.sessions.map((session) => {
    const label = `${session.speakerId} · ${new Date(session.created).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${session.id.slice(0, 4)}`;
    return new Option(label, session.id);
  }));
  $('session-select').value = state.session.id;
}
async function newSession() {
  const used = new Set(state.sessions.map((session) => session.speakerId));
  let number = 1;
  while (used.has(`spk${String(number).padStart(3, '0')}`)) number++;
  state.session = {
    id: crypto.randomUUID(), speakerId: `spk${String(number).padStart(3, '0')}`,
    created: new Date().toISOString(), scriptSha256: state.script.script_sha256,
    selected: {}, position: { index: 0, mode: 'H' },
  };
  state.index = 0; state.mode = 'H'; state.takes = []; state.viewTake = null;
  await saveSession();
  await refreshSessions();
  render();
}
async function selectSession(id) {
  state.session = state.sessions.find((session) => session.id === id);
  if (state.session.scriptSha256 !== state.script.script_sha256 && !state.script.compatible_script_sha256?.includes(state.session.scriptSha256)) {
    throw new Error('原稿の版が異なります。元の原稿を戻してデータを保存してください。');
  }
  state.index = state.session.position.index;
  state.mode = state.session.position.mode;
  state.takes = await getAll('takes', id);
  state.viewTake = null;
  localStorage.setItem(STORAGE_PREFIX + 'current-session', id);
  render();
}

function rubyText(annotated) {
  const fragment = document.createDocumentFragment();
  const pattern = /([一-龯々〆ヵヶ]+)\(([^)]+)\)/g;
  let position = 0;
  for (const match of annotated.matchAll(pattern)) {
    fragment.append(document.createTextNode(annotated.slice(position, match.index)));
    const ruby = document.createElement('ruby');
    ruby.append(document.createTextNode(match[1]));
    const rt = document.createElement('rt');
    rt.textContent = match[2]; ruby.append(rt); fragment.append(ruby);
    position = match.index + match[0].length;
  }
  fragment.append(document.createTextNode(annotated.slice(position)));
  return fragment;
}
function currentTakes() {
  return state.takes.filter((take) => take.condition === state.mode && take.sentenceId === state.script.sentences[state.index].id)
    .sort((a, b) => a.number - b.number);
}
function chosenTake() {
  const takes = currentTakes();
  return takes.find((take) => take.id === state.viewTake)
    || takes.find((take) => take.id === state.session.selected[positionKey()]) || takes.at(-1);
}
function render() {
  const sentence = state.script.sentences[state.index];
  $('speaker-id').value = state.session.speakerId;
  $('sentence-count').textContent = `原稿 ${sentence.id} / 15`;
  $('position-status').textContent = `${state.mode} · ${sentence.id} / 15`;
  $('mode-h').setAttribute('aria-pressed', String(state.mode === 'H'));
  $('mode-m').setAttribute('aria-pressed', String(state.mode === 'M'));
  $('mode-instruction').textContent = state.mode === 'H'
    ? '普段の会話のように、相手に伝わるようにはっきり読んでください。'
    : '「自分の喋っている内容を相手に伝える気がない」喋り方をする人を演じて，相手に伝わらないほど不明瞭に喋ってください';
  $('condition-label').textContent = state.mode === 'H' ? 'ハキハキ発話' : 'もごもご発話';
  $('condition-label').classList.toggle('m', state.mode === 'M');
  $('sentence-text').replaceChildren(rubyText(sentence.annotated));
  $('pronunciation-note').textContent = notes[sentence.id] || 'ふりがなは読み方の補助です。二重に読まないでください。';
  const count = Object.keys(state.session.selected).length;
  $('progress-text').textContent = `${count} / 30`;
  $('progress').value = count;
  $('sentence-list').replaceChildren(...state.script.sentences.map((item, index) => {
    const button = document.createElement('button');
    button.className = `sentence-item${index === state.index ? ' active' : ''}`;
    button.title = item.text;
    button.setAttribute('aria-label', `${item.id} ${item.text}`);
    if (index === state.index) button.setAttribute('aria-current', 'step');
    const number = document.createElement('span'); number.className = 'number'; number.textContent = item.id;
    const excerpt = document.createElement('span'); excerpt.className = 'excerpt'; excerpt.textContent = item.text;
    const dots = document.createElement('span'); dots.className = 'completion-dots';
    for (const condition of ['H', 'M']) {
      const dot = document.createElement('span');
      const done = Boolean(state.session.selected[condition + item.id]);
      dot.className = `completion-dot ${condition.toLowerCase()}${done ? ' done' : ''}`;
      dot.title = `${condition}: ${done ? '採用済み' : '未採用'}`;
      dots.append(dot);
    }
    button.append(number, excerpt, dots);
    button.addEventListener('click', () => action(() => moveTo(index, state.mode)));
    return button;
  }));
  renderReview(); updateControls();
}
function renderReview() {
  $('take-audio').pause();
  if (state.reviewURL) URL.revokeObjectURL(state.reviewURL);
  state.reviewURL = null;
  const takes = currentTakes(); const take = chosenTake();
  $('empty-take').hidden = Boolean(take); $('review-content').hidden = !take;
  $('take-status').textContent = take ? `${takes.length} テイク` : '未録音';
  if (!take) { $('take-audio').removeAttribute('src'); return; }
  state.viewTake = take.id;
  $('take-select').replaceChildren(...takes.map((item) => new Option(
    `テイク ${item.number} · ${item.duration.toFixed(1)}秒${state.session.selected[positionKey()] === item.id ? ' · 採用' : ''}${state.unsaved?.id === item.id ? ' · 未保存' : ''}`, item.id)));
  $('take-select').value = take.id;
  state.reviewURL = URL.createObjectURL(take.blob); $('take-audio').src = state.reviewURL;
  $('rating').value = take.rating ?? ''; $('take-note').value = take.note;
  const warnings = [];
  if (take.duration < 1) warnings.push('録音が短いため、内容を確認してください');
  if (take.rmsDb < -45) warnings.push('入力が小さいため、マイク位置を確認してください');
  if (take.clippedSamples > 0) warnings.push('ピーク付近の音があります。音割れがないか確認してください');
  $('quality-status').classList.toggle('warning', warnings.length > 0);
  $('quality-status').textContent = warnings.length ? warnings.join('。') : `${(take.sampleRate / 1000).toFixed(1)} kHz · WAV / 16-bit / mono · 内容を回聴してください`;
}
function updateControls() {
  const lock = locked();
  for (const id of ['new-session', 'session-select', 'speaker-id', 'mode-h', 'mode-m', 'previous', 'next', 'take-select', 'rating', 'take-note', 'accept-next', 'enable-microphone', 'microphone-select', 'practice-button', 'export-button', 'help-button', 'download-take', 'countdown-toggle']) $(id).disabled = lock;
  document.querySelectorAll('.sentence-item').forEach((button) => { button.disabled = lock; });
  $('speaker-id').disabled = lock || state.takes.length > 0;
  if (state.unsaved) {
    for (const id of ['new-session', 'session-select', 'mode-h', 'mode-m', 'previous', 'next', 'take-select']) $(id).disabled = true;
    document.querySelectorAll('.sentence-item').forEach((button) => { button.disabled = true; });
  }
  $('accept-next').disabled = lock || Boolean(state.unsaved);
  $('record-button').disabled = lock || !state.stream || Boolean(state.unsaved);
  $('practice-start').disabled = lock;
  $('record-button').hidden = isRecording() && state.purpose === 'take';
  $('stop-button').hidden = !isRecording() || state.purpose !== 'take';
  $('stop-button').disabled = state.phase === 'saving';
  $('practice-start').hidden = isRecording() && state.purpose === 'practice';
  $('practice-stop').hidden = !isRecording() || state.purpose !== 'practice';
  $('practice-stop').disabled = state.phase === 'saving';
  $('previous').disabled ||= state.index === 0 && state.mode === 'H';
  $('next').disabled ||= state.index === 14 && state.mode === 'M';
  document.body.classList.toggle('recording', state.phase === 'recording');
}
async function action(operation) {
  if (locked()) return;
  state.busy = true; updateControls();
  try { await operation(); } catch (cause) { report(cause); }
  finally { state.busy = false; updateControls(); }
}
async function moveTo(index, mode) {
  state.index = index; state.mode = mode; state.viewTake = null;
  await saveSession(); render();
}
async function step(direction) {
  const position = Math.max(0, Math.min(29, state.index + (state.mode === 'M' ? 15 : 0) + direction));
  await moveTo(position % 15, position >= 15 ? 'M' : 'H');
}

async function enumerateMicrophones() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const active = state.micSettings?.deviceId || $('microphone-select').value;
  $('microphone-select').replaceChildren(new Option('既定のマイク', ''), ...devices
    .filter((device) => device.kind === 'audioinput')
    .map((device, index) => new Option(device.label || `マイク ${index + 1}`, device.deviceId)));
  $('microphone-select').value = active;
}
async function disconnectMicrophone() {
  state.stream?.getTracks().forEach((track) => track.stop());
  if (state.context) await state.context.close();
  state.stream = null; state.context = null; state.analyser = null;
  state.node = null; state.source = null; state.mute = null;
  $('mic-status').textContent = '未接続';
  $('enable-microphone').querySelector('span').textContent = '接続する';
  updateControls();
}
async function connectMicrophone() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('マイクには localhost または HTTPS が必要です。録音端末で localhost のURLを開いてください。');
  }
  if (state.context) await disconnectMicrophone();
  const deviceId = $('microphone-select').value;
  const constraints = { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  if (deviceId) constraints.deviceId = { exact: deviceId };
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
    state.micSettings = state.stream.getAudioTracks()[0].getSettings();
    state.context = new AudioContext();
    await state.context.audioWorklet.addModule('recorder-worklet.js');
    state.node = new AudioWorkletNode(state.context, 'pcm-recorder');
    state.node.port.onmessage = ({ data }) => {
      if (data.type === 'chunk') state.chunks.push(data.samples);
      if (data.type === 'stopped' && state.stopResolve) {
        const resolve = state.stopResolve; state.stopResolve = null; resolve();
      }
    };
    state.source = state.context.createMediaStreamSource(state.stream);
    state.analyser = state.context.createAnalyser(); state.analyser.fftSize = 2048;
    state.analyser.smoothingTimeConstant = 0.25;
    state.mute = state.context.createGain(); state.mute.gain.value = 0;
    state.source.connect(state.analyser); state.source.connect(state.node);
    state.node.connect(state.mute); state.mute.connect(state.context.destination);
    await state.context.resume();
    state.stream.getAudioTracks()[0].addEventListener('ended', () => {
      if (isRecording()) stopRecording().finally(() => disconnectMicrophone());
      else disconnectMicrophone();
      error('マイクの接続が切れました。録音内容を確認し、再接続してください。');
    });
    await enumerateMicrophones();
    const processing = ['echoCancellation', 'noiseSuppression', 'autoGainControl'].filter((key) => state.micSettings[key] === true);
    $('mic-status').textContent = `${state.context.sampleRate / 1000} kHz / mono${processing.length ? ' · 自動処理あり' : ''}`;
    $('enable-microphone').querySelector('span').textContent = '切断する';
    error(''); updateControls();
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  } catch (cause) { await disconnectMicrophone(); throw cause; }
}
function pausePlayers() { document.querySelectorAll('audio').forEach((audio) => audio.pause()); }
async function startRecording(purpose) {
  if (locked() || state.unsaved) return;
  if (!/^[A-Za-z0-9_-]{1,32}$/.test($('speaker-id').value)) {
    error('話者IDは半角英数字・ハイフン・アンダースコアで入力してください。'); return;
  }
  const attempt = ++state.attempt;
  state.purpose = purpose; state.phase = 'countdown'; updateControls();
  try {
    if (!state.stream) await connectMicrophone();
    if (attempt !== state.attempt) return;
    if (purpose === 'take') await saveSession();
    pausePlayers(); error('');
    state.capture = { sentence: { ...state.script.sentences[state.index] }, condition: state.mode };
    if ($('countdown-toggle').checked && purpose === 'take') {
      $('countdown').hidden = false;
      for (let count = 3; count > 0; count--) {
        if (state.phase !== 'countdown' || attempt !== state.attempt) return;
        $('countdown').textContent = count;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (attempt === state.attempt) $('countdown').hidden = true;
    }
    if (state.phase !== 'countdown' || attempt !== state.attempt) return;
    await state.context.resume();
    if (attempt !== state.attempt) return;
    state.capture.recordedAt = new Date().toISOString();
    state.chunks = []; state.started = performance.now(); state.phase = 'recording';
    state.node.port.postMessage({ type: 'start' });
    $('record-state').lastChild.textContent = '録音中';
    $('practice-state').textContent = purpose === 'practice' ? '録音中' : '';
    state.autoStop = setTimeout(() => { stopRecording(); toast('90秒で自動停止しました。'); }, 90000);
    updateControls();
  } catch (cause) {
    state.phase = 'idle'; state.purpose = null; $('countdown').hidden = true; updateControls(); report(cause);
  }
}
function encodeWave(chunks, sampleRate) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + length * 2); const view = new DataView(buffer);
  const tag = (offset, text) => [...text].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  tag(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); tag(36, 'data'); view.setUint32(40, length * 2, true);
  let position = 44, power = 0, peak = 0, clippedSamples = 0;
  for (const chunk of chunks) for (const sample of chunk) {
    const bounded = Math.max(-1, Math.min(1, sample));
    view.setInt16(position, Math.round(bounded * (bounded < 0 ? 32768 : 32767)), true); position += 2;
    power += sample * sample; peak = Math.max(peak, Math.abs(sample));
    if (Math.abs(sample) >= 0.999) clippedSamples++;
  }
  return {
    blob: new Blob([buffer], { type: 'audio/wav' }), sampleRate, samples: length, duration: length / sampleRate,
    rmsDb: 20 * Math.log10(Math.max(1e-10, Math.sqrt(power / Math.max(1, length)))), peak, clippedSamples,
  };
}
async function stopRecording() {
  if (state.phase === 'idle' || state.phase === 'saving') return;
  clearTimeout(state.autoStop);
  if (state.phase === 'countdown') {
    state.attempt++;
    state.phase = 'idle'; state.purpose = null; $('countdown').hidden = true; updateControls(); return;
  }
  state.phase = 'saving'; updateControls();
  const purpose = state.purpose;
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { state.stopResolve = null; reject(new Error('録音の停止に時間がかかっています。接続を確認してください。')); }, 5000);
      state.stopResolve = () => { clearTimeout(timeout); resolve(); };
      state.node.port.postMessage({ type: 'stop' });
    });
    const wave = encodeWave(state.chunks, state.context.sampleRate);
    if (!wave.samples) throw new Error('音声を取得できませんでした。マイクを再接続してください。');
    if (purpose === 'practice') {
      if (state.practiceURL) URL.revokeObjectURL(state.practiceURL);
      state.practiceURL = URL.createObjectURL(wave.blob);
      $('practice-audio').src = state.practiceURL; $('practice-audio').hidden = false;
      $('practice-state').textContent = `${wave.duration.toFixed(1)}秒 · 回聴して確認してください。`;
    } else {
      const previous = state.takes.filter((take) => take.sentenceId === state.capture.sentence.id && take.condition === state.capture.condition);
      const take = {
        ...wave, id: crypto.randomUUID(), sessionId: state.session.id, sentenceId: state.capture.sentence.id,
        text: state.capture.sentence.text, condition: state.capture.condition,
        number: Math.max(0, ...previous.map((item) => item.number)) + 1,
        recordedAt: state.capture.recordedAt, rating: null, note: '', deviceSettings: { ...state.micSettings },
      };
      state.takes.push(take); state.viewTake = take.id;
      try { await put('takes', take); }
      catch (cause) { state.unsaved = take; report(cause); }
      render();
      if (state.unsaved) error('この録音をブラウザに保存できませんでした。移動せず「このテイクを保存」でWAVをダウンロードしてください。');
      else toast('録音を保存しました。回聴してから採用してください。');
    }
  } catch (cause) { report(cause); }
  finally {
    state.phase = 'idle'; state.purpose = null;
    $('record-state').lastChild.textContent = '録音待ち'; updateControls();
  }
}

function filename(take) {
  return `${state.session.speakerId}_${take.sentenceId}_${take.condition}_take${String(take.number).padStart(2, '0')}.wav`;
}
function download(blob, name) {
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function csv(rows) {
  return '\uFEFF' + rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n';
}
async function exportZip() {
  state.busy = true; updateControls();
  $('confirm-export').disabled = true; $('include-all').disabled = true;
  try {
    if (typeof JSZip === 'undefined') throw new Error('ZIPライブラリを読み込めません。ページを再読み込みしてください。');
    const zip = new JSZip(); const all = $('include-all').checked;
    const selected = new Set(Object.values(state.session.selected));
    const takes = state.takes.filter((take) => all || selected.has(take.id));
    if (!takes.length) throw new Error('保存対象がありません。録音するか、未採用テイクを含めてください。');
    const manifest = [['speaker_id', 'session_id', 'sentence_id', 'condition', 'take', 'selected', 'wav_path', 'text', 'sample_rate', 'samples', 'duration_sec', 'mumbling_rating', 'note', 'recorded_at', 'rms_dbfs', 'peak', 'clipped_samples']];
    for (const take of takes) {
      const path = `audio/${take.condition}/${filename(take)}`;
      zip.file(path, await take.blob.arrayBuffer());
      manifest.push([state.session.speakerId, state.session.id, take.sentenceId, take.condition, take.number, selected.has(take.id), path, take.text, take.sampleRate, take.samples, take.duration, take.rating, take.note, take.recordedAt, take.rmsDb, take.peak, take.clippedSamples]);
    }
    const pairs = [['speaker_id', 'sentence_id', 'text', 'clean_wav', 'mumbling_wav', 'complete']];
    for (const sentence of state.script.sentences) {
      const h = takes.find((take) => take.id === state.session.selected[`H${sentence.id}`]);
      const m = takes.find((take) => take.id === state.session.selected[`M${sentence.id}`]);
      pairs.push([state.session.speakerId, sentence.id, sentence.text, h ? `audio/H/${filename(h)}` : '', m ? `audio/M/${filename(m)}` : '', Boolean(h && m)]);
    }
    zip.file('manifest.csv', csv(manifest)); zip.file('pairs.csv', csv(pairs));
    zip.file('script.txt', state.script.source_text);
    zip.file('session.json', JSON.stringify({
      ...state.session, exportedAt: new Date().toISOString(), appVersion: '1.0.0-public',
      scriptVersion: state.script.version, exportedScriptSha256: state.script.script_sha256, referencePolicy: 'No reference audio is provided or loaded.',
      audioFormat: 'PCM16 mono WAV; browser AudioContext sample rate; no normalization or trimming',
      alignment: 'Same text only. Recordings are not frame-aligned.',
      userAgent: navigator.userAgent,
      takes: takes.map(({ blob, reference, ...metadata }) => ({ ...metadata, file: `audio/${metadata.condition}/${filename(metadata)}` })),
    }, null, 2));
    zip.file('README.txt', 'H = 通常のハキハキ発話 / clear speech\nM = もごもご発話 / mumbled speech\nmanifest.csv: all exported takes; selected=true identifies accepted takes.\npairs.csv: accepted same-text pairs only; empty paths indicate missing selections.\nThe two conditions are NOT time-aligned. No loudness normalization or silence trimming was applied.\nMumbling rating is optional participant self-report, not an objective score.\nReference and practice audio are not included. Keep these recordings within the approved research scope.\n');
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, (metadata) => {
      $('export-status').textContent = `作成中 ${Math.round(metadata.percent)}%`;
    });
    download(blob, `${state.session.speakerId}_${state.session.created.slice(0, 10)}_${state.session.id.slice(0, 8)}.zip`);
    $('export-status').textContent = `${takes.length}テイクを書き出しました。ダウンロードしたZIPを確認してください。`;
  } catch (cause) { $('export-status').textContent = cause.message; report(cause); }
  finally {
    state.busy = false; updateControls();
    $('confirm-export').disabled = false; $('include-all').disabled = false;
  }
}

function draw() {
  liveSpectrum.draw(state.analyser, state.context?.sampleRate, state.phase);
  const canvas = $('waveform'); const scale = window.devicePixelRatio || 1;
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * scale) || canvas.height !== Math.round(height * scale)) {
    canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
  }
  const context = canvas.getContext('2d'); context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, width, height); context.lineWidth = 1.5;
  context.strokeStyle = state.phase === 'recording' ? '#ba4d5c' : '#177467';
  context.beginPath();
  let power = 0;
  if (state.analyser) {
    const data = new Float32Array(state.analyser.fftSize); state.analyser.getFloatTimeDomainData(data);
    for (let index = 0; index < data.length; index++) {
      const x = index * width / (data.length - 1); const y = height / 2 - data[index] * height * 0.46;
      if (!index) context.moveTo(x, y); else context.lineTo(x, y);
      power += data[index] * data[index];
    }
    const rms = Math.sqrt(power / data.length); const db = 20 * Math.log10(Math.max(rms, 1e-10));
    $('level-meter').value = Math.max(0, Math.min(1, (db + 60) / 60));
    $('level-text').textContent = `${Math.max(-99, db).toFixed(0)} dBFS`;
  } else {
    context.moveTo(0, height / 2); context.lineTo(width, height / 2);
    $('level-meter').value = 0; $('level-text').textContent = '— dBFS';
  }
  context.stroke();
  if (state.phase === 'recording') {
    const elapsed = (performance.now() - state.started) / 1000;
    $('timer').textContent = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${(elapsed % 60).toFixed(1).padStart(4, '0')}`;
  }
  requestAnimationFrame(draw);
}


function bindEvents() {
  $('new-session').onclick = () => action(newSession);
  $('session-select').onchange = () => action(() => selectSession($('session-select').value));
  $('speaker-id').onchange = () => action(async () => {
    const value = $('speaker-id').value.trim();
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(value)) {
      $('speaker-id').classList.add('invalid');
      throw new Error('話者IDは半角英数字・ハイフン・アンダースコア（1〜32文字）で入力してください。');
    }
    $('speaker-id').classList.remove('invalid'); error('');
    state.session.speakerId = value; await saveSession(); await refreshSessions();
  });
  $('mode-h').onclick = () => action(() => moveTo(state.index, 'H'));
  $('mode-m').onclick = () => action(() => moveTo(state.index, 'M'));
  $('previous').onclick = () => action(() => step(-1));
  $('next').onclick = () => action(() => step(1));
  $('furigana-toggle').onchange = () => $('sentence-text').classList.toggle('hide-ruby', !$('furigana-toggle').checked);
  $('enable-microphone').onclick = () => action(() => state.stream ? disconnectMicrophone() : connectMicrophone());
  $('microphone-select').onchange = () => action(async () => { if (state.stream) await connectMicrophone(); });
  $('record-button').onclick = () => startRecording('take');
  $('stop-button').onclick = stopRecording;
  $('take-select').onchange = () => { if (!locked()) { state.viewTake = $('take-select').value; renderReview(); } };
  $('rating').onchange = () => action(async () => {
    const take = chosenTake(); take.rating = $('rating').value ? Number($('rating').value) : null; await put('takes', take);
  });
  $('take-note').onchange = () => action(async () => {
    const take = chosenTake(); take.note = $('take-note').value.trim(); await put('takes', take);
  });
  $('accept-next').onclick = () => action(async () => {
    const take = chosenTake(); if (!take || state.unsaved) return;
    state.session.selected[positionKey()] = take.id; await saveSession();
    if (Object.keys(state.session.selected).length === 30) toast('30発話の採用が完了しました。データを保存してください。');
    else if (state.mode === 'H' && state.index === 14) toast('次はもごもご発話です。読み方を確認してください。');
    await step(1);
  });
  $('download-take').onclick = () => { const take = chosenTake(); if (take) download(take.blob, filename(take)); };
  $('help-button').onclick = () => $('guide-dialog').showModal();
  $('practice-button').onclick = () => $('practice-dialog').showModal();
  $('practice-start').onclick = () => startRecording('practice');
  $('practice-stop').onclick = stopRecording;
  $('practice-dialog').addEventListener('cancel', (event) => { if (isRecording()) event.preventDefault(); });
  $('export-dialog').addEventListener('cancel', (event) => { if (state.busy) event.preventDefault(); });
  document.querySelectorAll('.close-dialog').forEach((button) => {
    button.onclick = () => {
      if (isRecording() || state.busy) return;
      button.closest('dialog').close(); $('practice-audio').pause();
    };
  });
  document.querySelectorAll('audio').forEach((audio) => audio.addEventListener('play', () => {
    if (isRecording()) audio.pause();
    else document.querySelectorAll('audio').forEach((other) => { if (other !== audio) other.pause(); });
  }));
  $('export-button').onclick = () => {
    const count = Object.keys(state.session.selected).length;
    $('export-summary').textContent = `${state.session.speakerId} · 採用済み ${count} / 30 発話 · 録音 ${state.takes.length}テイク。${count < 30 ? '未完了の状態でも保存できます。' : ''}`;
    $('export-status').textContent = ''; $('export-dialog').showModal();
  };
  $('confirm-export').onclick = exportZip;
  window.addEventListener('beforeunload', (event) => {
    if (isRecording() || state.unsaved) { event.preventDefault(); event.returnValue = ''; }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && isRecording()) {
      stopRecording(); error('画面が非表示になったため録音を停止しました。途中で切れていないか確認してください。');
    }
  });
}

async function initialize() {
  icons();
  try {
    const response = await fetch('assets/script.json?v=20261009-1', { cache: 'no-store' });
    if (!response.ok) throw new Error('原稿を取得できません。ページを再読み込みしてください。');
    state.script = await response.json();
    state.db = await openDatabase();
    state.sessions = await getAll('sessions');
    const last = localStorage.getItem(STORAGE_PREFIX + 'current-session');
    if (state.sessions.some((session) => session.id === last)) { await selectSession(last); await refreshSessions(); }
    else await newSession();
    bindEvents(); draw();
    if (navigator.locks) navigator.locks.request(STORAGE_PREFIX + 'single-tab', { ifAvailable: true }, async (lock) => {
      if (!lock) {
        state.tabBlocked = true; updateControls();
        error('別のタブで収録ページが開いています。そちらを閉じ、このページを再読み込みしてください。');
        return;
      }
      await new Promise(() => {});
    });
    if (!window.isSecureContext || !navigator.mediaDevices) error('マイクには localhost または HTTPS が必要です。HTTPSの公開URLまたはlocalhostで開いてください。');
    if (!localStorage.getItem(STORAGE_PREFIX + 'guide-seen')) {
      $('guide-dialog').showModal();
      $('guide-dialog').addEventListener('close', () => localStorage.setItem(STORAGE_PREFIX + 'guide-seen', '1'), { once: true });
    }
  } catch (cause) {
    state.tabBlocked = true;
    document.querySelectorAll('button,input,select').forEach((element) => { element.disabled = true; });
    report(cause);
  }
}
initialize();
