import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AUDIO_PATH, GUIDANCE, STATUS_TEXT, buildVoiceText, matchesFile, parseVoiceText } from '../lib/contract.js';
import { Recording, MAX_SECONDS, base64, prepareWave, recordingName } from './recording.js';
import { wrapUserRenderer } from './wrap.js';

export const inject = ['slots', 'connection', 'remote', 'remote.session', 'remote.fileUploads', 'fileUpload'];
const h = React.createElement;
const PREPARATION_TEXT = { unprepared: '尚未准备', ready: '已就绪', standby: '待唤醒', checking: '正在检查', downloading: '正在下载模型', loading: '正在加载', waking: '正在唤醒', failed: '准备失败', cancelled: '已取消', cancelling: '正在取消' };
const messageOf = error => error?.message || String(error);
async function unwrap(result) {
  if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
  return result.value;
}
const speechCall = (ctx, method, args = {}, signal) => ctx.connection.rpc.call('/api', `speech/${method}`, { args }, signal).then(unwrap);

function VoicePlayer({ voice, sessionId }) {
  const resources = useRef({ context: null, buffer: null, source: null, offset: 0, startedAt: 0, abort: null });
  const [playing, setPlaying] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(voice.meta.seconds);
  const [error, setError] = useState('');
  function currentPosition() {
    const r = resources.current;
    return Math.min(r.buffer?.duration ?? duration, r.offset + (r.source ? r.context.currentTime - r.startedAt : 0));
  }
  function stopSource() {
    const r = resources.current;
    if (!r.source) return;
    r.source.onended = null; r.source.stop(); r.source.disconnect(); r.source = null;
  }
  function startSource() {
    const r = resources.current;
    const source = r.context.createBufferSource(); source.buffer = r.buffer; source.connect(r.context.destination);
    r.source = source; r.startedAt = r.context.currentTime;
    source.onended = () => {
      if (r.source !== source) return;
      source.disconnect(); r.source = null; r.offset = r.buffer.duration;
      setPosition(r.buffer.duration); setPlaying(false);
    };
    source.start(0, r.offset); setPlaying(true);
  }
  async function play() {
    const r = resources.current;
    if (loading || r.source) return;
    setError('');
    // Resume inside the click gesture before awaiting authenticated audio bytes.
    r.abort ??= new AbortController();
    try {
      r.context ??= new AudioContext();
      await r.context.resume();
      r.abort.signal.throwIfAborted();
      if (!r.buffer) {
        setLoading(true);
        const response = await fetch(`${AUDIO_PATH}?${new URLSearchParams({ sessionId, attachmentId: voice.meta.attachmentId })}`, { signal: r.abort.signal, credentials: 'same-origin' });
        if (!response.ok) throw new Error('原始音频暂时无法读取，请检查连接或附件是否仍存在');
        const buffer = await r.context.decodeAudioData(await response.arrayBuffer());
        r.abort.signal.throwIfAborted(); r.buffer = buffer; setDuration(buffer.duration); setLoaded(true);
      }
      r.abort.signal.throwIfAborted();
      if (r.offset >= r.buffer.duration) r.offset = 0;
      startSource();
    } catch (error) { if (!r.abort?.signal.aborted) setError(messageOf(error)); }
    finally { if (!r.abort?.signal.aborted) setLoading(false); }
  }
  function pause() {
    const r = resources.current; r.offset = currentPosition(); stopSource(); setPosition(r.offset); setPlaying(false);
  }
  function seek(event) {
    const r = resources.current; const wasPlaying = !!r.source;
    stopSource(); r.offset = Number(event.target.value); setPosition(r.offset);
    if (wasPlaying && r.offset < r.buffer.duration) startSource(); else setPlaying(false);
  }
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setPosition(currentPosition()), 100);
    return () => clearInterval(timer);
  }, [playing]);
  useEffect(() => () => {
    const r = resources.current; r.abort?.abort(); stopSource();
    if (r.context && r.context.state !== 'closed') void r.context.close();
    r.buffer = null;
  }, []);
  const body = voice.body.split('\n').slice(1).join('\n').replace(`\n\n${GUIDANCE}`, '');
  return h('section', { className: 'dsh-voice-card', 'aria-label': '语音消息' },
    h('div', { className: 'dsh-voice-meta' }, `语音 ${voice.meta.seconds.toFixed(1)}s · ${Math.ceil(voice.meta.bytes / 1024)} KB`),
    h('button', { type: 'button', disabled: loading, onClick: playing ? pause : play }, loading ? '读取音频…' : playing ? '暂停原音' : loaded ? '继续播放' : '播放原音'),
    h('input', { type: 'range', min: 0, max: duration, step: 0.1, value: position, disabled: !loaded,
      'aria-label': '语音播放进度', onChange: seek }),
    h('span', null, `${position.toFixed(1)} / ${duration.toFixed(1)}s`),
    error && h('div', { role: 'alert' }, error, h('button', { type: 'button', onClick: play }, '重试播放')),
    h('details', null, h('summary', null, STATUS_TEXT[voice.meta.status]), h('pre', null, body)));
}

function voiceRenderer(input, props, original, options) {
  const voice = parseVoiceText(input.content.text);
  if (!voice) return null;
  const index = input.content.attachments.findIndex(a => a.type === 'file' && matchesFile(voice.meta, a.file));
  if (index < 0) return null;
  const attachments = input.content.attachments.filter((_, i) => i !== index);
  const remainder = { ...input, content: { ...input.content, text: '', attachments } };
  return h(React.Fragment, null,
    h(VoicePlayer, { key: `${props.sessionId}:${voice.meta.attachmentId}`, voice, sessionId: props.sessionId }),
    (attachments.length || input.content.extraBlocks.length || input.content.referenceLabels?.length) ? original('conversation.chat.user.content', remainder, options) : null);
}

function VoiceInput({ ctx, sessionId, locked }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef();
  const [panelPosition, setPanelPosition] = useState(null);
  const [phase, setPhase] = useState('idle');
  const [catalog, setCatalog] = useState(null);
  const [setupError, setSetupError] = useState('');
  const [error, setError] = useState('');
  const [devices, setDevices] = useState([]);
  const [device, setDevice] = useState('');
  const [source, setSource] = useState('');
  const [draft, setDraft] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [preview, setPreview] = useState('');
  const [settings, setSettings] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [hint, setHint] = useState('');
  const [willSend, setWillSend] = useState(false);
  const gesture = useRef(null);
  const stopAtLimit = useRef();
  const life = useRef({ generation: 0, recording: null, abort: null, draft: null, phase: 'idle' });
  const provider = catalog?.providers.find(p => p.id === catalog.selection.providerId && p.location === 'host-local') ?? catalog?.providers.find(p => p.location === 'host-local');
  const ready = ['ready', 'standby'].includes(provider?.preparation.phase);
  const busy = ['requesting', 'recording', 'transcribing', 'sending'].includes(phase);
  const setPhaseNow = value => { life.current.phase = value; setPhase(value); };

  function reset(close = true) {
    gesture.current = null;
    setCancelling(false); setSettings(false); setHint(''); setWillSend(false);
    life.current.generation++;
    life.current.abort?.abort();
    life.current.recording?.dispose();
    life.current.recording = null;
    life.current.draft = null;
    setDraft(null); setError(''); setElapsed(0); setPhaseNow('idle');
    if (close) setOpen(false);
  }
  async function refreshCatalog() {
    try { setCatalog(await speechCall(ctx, 'catalog')); setSetupError(''); }
    catch { setSetupError('本地转写服务未就绪，请检查语音插件及 Speech 服务是否已启用'); }
  }
  useLayoutEffect(() => {
    if (!open) return;
    const viewport = window.visualViewport;
    function updatePosition() {
      const rect = anchor.current.getBoundingClientRect();
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const panelWidth = Math.min(360, width - 32);
      const above = Math.max(top + 16, Math.min(rect.top - 8, top + height - 16));
      const below = Math.max(top + 16, Math.min(rect.bottom + 8, top + height - 16));
      const aboveSpace = above - top - 16;
      const belowSpace = top + height - below - 16;
      setPanelPosition({
        left: Math.max(left + 16, Math.min(rect.right - panelWidth, left + width - panelWidth - 16)),
        width: panelWidth,
        ...(aboveSpace >= belowSpace
          ? { bottom: window.innerHeight - above, maxHeight: Math.min(height * .65, aboveSpace) }
          : { top: below, maxHeight: Math.min(height * .65, belowSpace) }),
      });
    }
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    viewport?.addEventListener('resize', updatePosition);
    viewport?.addEventListener('scroll', updatePosition);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      viewport?.removeEventListener('resize', updatePosition);
      viewport?.removeEventListener('scroll', updatePosition);
    };
  }, [open]);
  useEffect(() => {
    void refreshCatalog();
  }, []);
  useEffect(() => {
    if (open) {
      navigator.mediaDevices?.enumerateDevices().then(all => setDevices(all.filter(d => d.kind === 'audioinput'))).catch(() => {});
    }
  }, [open]);
  useEffect(() => {
    if (!open || !provider || ['unprepared', 'ready', 'standby', 'failed', 'cancelled'].includes(provider.preparation.phase)) return;
    const timer = setInterval(() => void refreshCatalog(), 1000);
    return () => clearInterval(timer);
  }, [open, provider?.preparation.phase]);
  useEffect(() => {
    if (phase !== 'recording') return;
    const recording = life.current.recording;
    const timer = setInterval(() => {
      if (life.current.phase === 'recording' && life.current.recording === recording) setElapsed(Math.min(MAX_SECONDS, (performance.now() - recording.started) / 1000));
    }, 200);
    return () => clearInterval(timer);
  }, [phase]);
  useEffect(() => {
    if (!draft) return;
    const url = URL.createObjectURL(draft.blob); setPreview(url);
    return () => { URL.revokeObjectURL(url); setPreview(''); };
  }, [draft?.blob]);
  useEffect(() => {
    const hidden = () => { if (document.hidden && ['requesting', 'recording'].includes(life.current.phase)) reset(); };
    const interrupted = () => { if (['requesting', 'recording'].includes(life.current.phase)) reset(); };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('blur', interrupted);
    return () => { document.removeEventListener('visibilitychange', hidden); window.removeEventListener('blur', interrupted); gesture.current = null; life.current.generation++; life.current.abort?.abort(); life.current.recording?.dispose(); };
  }, [sessionId]);
  useEffect(() => {
    if (!open) return;
    const escape = event => { if (event.key === 'Escape' && life.current.phase !== 'sending') { event.preventDefault(); reset(); } };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [open]);

  async function transcribe(recording, generation = life.current.generation, sendOnReady = false) {
    setWillSend(sendOnReady);
    setPhaseNow('transcribing'); setError('');
    const abort = new AbortController(); life.current.abort = abort;
    try {
      const prepared = await prepareWave(recording.blob, abort.signal);
      recording = { ...recording, seconds: prepared.seconds };
      recording.name = recordingName(recording, recording.recordedAt);
      const wave = prepared.bytes;
      if (!provider || !ready) throw new Error('本地转写未准备好，可以准备后重试或仅发送原音');
      if (wave.length > catalog.maxAudioBytes) throw new Error('预处理音频超过当前转写服务的字节上限');
      const result = await speechCall(ctx, 'transcribe', { request: { audioBase64: base64(wave), providerId: provider.id, language: catalog.selection.language || 'auto' } }, abort.signal);
      if (generation !== life.current.generation) return;
      const value = { ...recording, transcript: result.text.trim(), status: result.text.trim() ? 'transcribed' : 'empty' };
      life.current.draft = value; setDraft(value); setPhaseNow('ready');
      if (sendOnReady) await send();
    } catch (error) {
      if (generation !== life.current.generation || abort.signal.aborted) return;
      const value = { ...recording, transcript: '', status: 'failed' };
      life.current.draft = value; setDraft(value); setError(messageOf(error)); setPhaseNow('ready');
    }
  }
  async function stop(sendOnReady = false) {
    if (life.current.phase !== 'recording') return;
    if (sendOnReady && performance.now() - life.current.recording.started < 1000) {
      reset(false); setHint('说话时间太短，请按住至少 1 秒'); return;
    }
    gesture.current = null; setCancelling(false);
    setPhaseNow('transcribing');
    const generation = life.current.generation;
    try {
      const recording = await life.current.recording.stop();
      if (generation !== life.current.generation) return;
      const value = { ...recording, requestId: crypto.randomUUID(), recordedAt: new Date() };
      value.name = recordingName(value, value.recordedAt);
      life.current.draft = value; setDraft(value);
      await transcribe(value, generation, sendOnReady);
    } catch (error) { if (generation === life.current.generation) { setError(messageOf(error)); setPhaseNow('idle'); } }
  }
  async function start() {
    setOpen(true); setSettings(false); setHint('');
    setPhaseNow('requesting'); setError('');
    const generation = ++life.current.generation;
    const recording = new Recording(device); life.current.recording = recording;
    try {
      await recording.start(() => {
        if (gesture.current?.cancel) { reset(); return; }
        setHint(`已达到 ${MAX_SECONDS} 秒上限，录音已保留`);
        void stopAtLimit.current();
      });
      if (generation !== life.current.generation) { recording.dispose(); return; }
      setPhaseNow('recording');
      const all = await navigator.mediaDevices.enumerateDevices();
      if (generation === life.current.generation) setDevices(all.filter(d => d.kind === 'audioinput'));
    } catch (error) { if (generation === life.current.generation) { gesture.current = null; setCancelling(false); setError(messageOf(error)); setPhaseNow('idle'); } }
  }
  stopAtLimit.current = stop;
  function beginGesture(event) {
    if (event.button !== 0 || !event.isPrimary || locked || life.current.phase !== 'idle' || life.current.draft) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { pointerId: event.pointerId, startY: event.clientY, cancel: false };
    void start();
  }
  function moveGesture(event) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.cancel = current.startY - event.clientY >= 64;
    setCancelling(current.cancel);
  }
  function finishGesture(event) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    moveGesture(event);
    const cancel = current.cancel;
    gesture.current = null;
    setCancelling(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (cancel) reset();
    else if (life.current.phase === 'recording') void stop(true);
    else if (life.current.phase === 'requesting') {
      reset(false);
      setHint('麦克风准备中，请允许录音后重新按住说话');
    }
  }
  function cancelGesture(event) {
    if (gesture.current?.pointerId === event.pointerId) reset();
  }
  function keyDown(event) {
    if (![' ', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    if (event.repeat || gesture.current || locked || life.current.phase !== 'idle' || life.current.draft) return;
    gesture.current = { key: event.key };
    void start();
  }
  function keyUp(event) {
    if (gesture.current?.key !== event.key) return;
    event.preventDefault(); gesture.current = null;
    if (life.current.phase === 'recording') void stop(true);
    else if (life.current.phase === 'requesting') { reset(false); setHint('麦克风准备中，请允许录音后重新按住说话'); }
  }
  async function send() {
    if (life.current.phase !== 'ready') return;
    if (locked) { setError('当前会话暂时无法发送，录音已保留'); return; }
    const generation = life.current.generation;
    const value = life.current.draft;
    setPhaseNow('sending'); setError('');
    const abort = new AbortController(); life.current.abort = abort;
    try {
      const uploaded = await unwrap(await ctx.fileUpload.upload(sessionId, value.blob, value.name, abort.signal));
      abort.signal.throwIfAborted();
      if (generation !== life.current.generation) return;
      const text = buildVoiceText({ file: uploaded.file, mediaType: value.mediaType, seconds: value.seconds, transcript: value.transcript, status: value.status });
      // Native request-id deduplication precedes receipt validation on retries.
      await unwrap(await ctx.remote.session.prompt({ sessionId, requestId: value.requestId, mode: 'queue', content: [{ type: 'text', text }, { type: 'file', receiptId: uploaded.receiptId }] }, abort.signal));
      if (generation === life.current.generation) reset();
    } catch (error) { if (generation === life.current.generation && !abort.signal.aborted) { setError(`发送未确认：${messageOf(error)}。可重试发送，同一录音使用相同消息标识。`); setPhaseNow('ready'); } }
  }
  async function prepare() {
    try {
      setSetupError('');
      await speechCall(ctx, 'prepare', { providerId: provider.id, ...(source ? { options: { downloadSource: source } } : {}) });
      await refreshCatalog();
    } catch (error) { setSetupError(messageOf(error)); }
  }
  const recordingActive = ['requesting', 'recording'].includes(phase);
  return h('div', { ref: anchor, className: 'dsh-voice-input', key: sessionId },
    h('button', {
      type: 'button', className: `dsh-voice-hold${recordingActive ? ' is-held' : ''}`,
      disabled: locked || ['transcribing', 'sending', 'ready'].includes(phase),
      'aria-label': '按住说话，松开发送，上滑取消',
      'aria-pressed': recordingActive, title: '按住说话，松开发送；上滑或按 Esc 取消',
      onPointerDown: beginGesture, onPointerMove: moveGesture, onPointerUp: finishGesture,
      onPointerCancel: cancelGesture, onLostPointerCapture: cancelGesture,
      onContextMenu: event => event.preventDefault(), onKeyDown: keyDown, onKeyUp: keyUp,
      onBlur: () => { if (gesture.current?.key) reset(); },
      onClick: event => event.preventDefault(),
    }, h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true },
      h('rect', { x: 9, y: 2, width: 6, height: 12, rx: 3 }),
      h('path', { d: 'M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8' })),
      phase === 'transcribing' ? '转写中…' : phase === 'sending' ? '发送中…' : cancelling ? '松开取消' : recordingActive ? '松开发送' : '按住说话'),
    h('button', { type: 'button', className: 'dsh-voice-settings', 'aria-label': '语音设置', disabled: busy || !!draft,
      onClick: () => { setSettings(!settings || !open); setOpen(!open || !settings); void refreshCatalog(); } },
      h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true },
        h('path', { d: 'M4 7h16M4 17h16' }), h('circle', { cx: 9, cy: 7, r: 3, fill: 'var(--dsw-alias-bg-layer-1)' }), h('circle', { cx: 15, cy: 17, r: 3, fill: 'var(--dsw-alias-bg-layer-1)' }))),
    open && createPortal(h('section', {
      className: `dsh-voice-panel${recordingActive ? ' is-recording' : ''}${cancelling ? ' is-cancelling' : ''}`,
      style: panelPosition ?? { visibility: 'hidden' }, 'aria-label': '录制语音消息',
    },
      !recordingActive && h('div', { className: 'dsh-voice-panel-header' },
        h('strong', null, settings ? '语音设置' : phase === 'sending' ? '发送语音' : '语音消息'),
        h('button', { type: 'button', className: 'dsh-voice-close', 'aria-label': '取消', disabled: phase === 'sending', onClick: () => reset() }, '×')),
      recordingActive && h('div', { className: 'dsh-voice-recording', role: 'status' },
        h('span', { className: 'dsh-voice-recording-dot', 'aria-hidden': true }),
        h('span', { className: 'dsh-voice-time' }, phase === 'requesting' ? '准备麦克风…' : `${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, '0')}`),
        h('strong', null, cancelling ? '松开取消' : phase === 'requesting' ? '等待麦克风权限…' : '正在录音'),
        h('span', { className: 'dsh-voice-meta' }, cancelling ? '移回原处继续录音' : '松开发送，上滑取消')),
      settings && h(React.Fragment, null,
        devices.length > 1 && h('label', null, '麦克风', h('select', { value: device, disabled: busy || !!draft, onChange: e => setDevice(e.target.value) }, h('option', { value: '' }, '默认设备'), devices.filter(d => d.deviceId && d.deviceId !== 'default').map((d, i) => h('option', { key: d.deviceId, value: d.deviceId }, d.label || `麦克风 ${i + 1}`)))),
        ready && h('p', { className: 'dsh-voice-meta' }, '本地转写已就绪')),
      !recordingActive && !ready && h('div', { className: 'dsh-voice-setup' },
        h('p', null, provider ? `本地转写：${PREPARATION_TEXT[provider.preparation.phase] || '正在准备'}` : '本地转写服务未就绪'),
        provider?.downloadSources?.length > 0 && h('select', { 'aria-label': '模型下载来源', value: source, onChange: e => setSource(e.target.value) }, h('option', { value: '' }, '选择下载来源'), provider.downloadSources.map(s => h('option', { key: s, value: s }, s))),
        provider && h('button', { type: 'button', disabled: busy || (!!provider.downloadSources?.length && !source), onClick: prepare }, '下载并准备本地转写'),
        h('button', { type: 'button', disabled: busy, onClick: refreshCatalog }, '检查准备状态')),
      !recordingActive && (setupError || provider?.preparation.phase === 'failed') && h('p', { role: 'alert' }, setupError || provider.preparation.message),
      phase === 'transcribing' && h('p', { className: 'dsh-voice-progress', role: 'status' }, willSend ? '正在转写，完成后发送…' : '正在转写…'),
      phase === 'sending' && h('p', { className: 'dsh-voice-progress', role: 'status' }, '正在发送…'),
      hint && !recordingActive && h('p', { role: 'status', className: 'dsh-voice-meta' }, hint),
      draft && phase === 'ready' && h(React.Fragment, null,
        h('audio', { controls: true, src: preview, 'aria-label': '待发送录音' }),
        h('p', { className: 'dsh-voice-meta' }, STATUS_TEXT[draft.status] || '等待转写'),
        draft.transcript && h('pre', null, draft.transcript),
        h('div', { className: 'dsh-voice-actions' },
          h('button', { type: 'button', className: 'dsh-voice-send', disabled: locked, onClick: send }, draft.status === 'failed' ? '仅发送原音' : '发送语音'),
          draft.status === 'failed' && h('button', { type: 'button', disabled: !ready, onClick: () => transcribe(life.current.draft, life.current.generation, true) }, '重试转写并发送'))),
      error && h('p', { role: 'alert' }, error)), document.body));
}

const CSS = `
.dsh-voice-input{position:relative;display:inline-flex;align-items:center;gap:2px;color:var(--dsw-alias-label-primary)}
.dsh-voice-panel,.dsh-voice-card{box-sizing:border-box;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l1);border-radius:12px;padding:12px;font-size:14px;line-height:1.5;color-scheme:light}
.dsh-voice-panel{position:fixed;overflow:auto;z-index:1000;display:grid;gap:8px;box-shadow:0 4px 20px #0002}
.dsh-voice-card{max-width:min(360px,100%);display:grid;gap:8px}
.dsh-voice-panel audio{width:100%;min-width:0}
.dsh-voice-card pre,.dsh-voice-panel pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;margin:0}
.dsh-voice-panel p{margin:0}.dsh-voice-actions{display:flex;flex-wrap:wrap;gap:8px}
.dsh-voice-input button,.dsh-voice-panel button,.dsh-voice-card button{font:inherit;color:inherit;border:.5px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-specific-selector);padding:4px 8px;cursor:pointer}
.dsh-voice-input button:disabled,.dsh-voice-panel button:disabled,.dsh-voice-card button:disabled{opacity:.5;cursor:default}
body[data-ds-dark-theme] .dsh-voice-panel,body[data-ds-dark-theme] .dsh-voice-card{color-scheme:dark}
.dsh-voice-input button:hover:not(:disabled),.dsh-voice-panel button:hover:not(:disabled),.dsh-voice-card button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}
.dsh-voice-input button:focus-visible,.dsh-voice-panel :is(button,select):focus-visible,.dsh-voice-card :is(button,input,summary):focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.dsh-voice-panel label{display:grid;gap:6px}
.dsh-voice-panel select{box-sizing:border-box;width:100%;min-width:0;font:inherit;color:inherit;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l1);border-radius:6px;padding:6px 10px}
.dsh-voice-panel [role=alert],.dsh-voice-card [role=alert]{color:var(--dsw-alias-state-error-primary)}
.dsh-voice-card input[type=range]{accent-color:var(--dsw-alias-state-business-primary)}
.dsh-voice-meta{font-size:13px;color:var(--dsw-alias-label-secondary)}
.dsh-voice-input .dsh-voice-hold{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:36px;padding:6px 10px;white-space:nowrap;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
.dsh-voice-input .dsh-voice-hold.is-held{background:var(--dsw-alias-interactive-bg-hover-solid);box-shadow:inset 0 0 0 1px var(--dsw-alias-state-business-primary)}
.dsh-voice-input .dsh-voice-settings{display:inline-flex;align-items:center;justify-content:center;width:28px;min-height:36px;padding:4px;border:0;background:transparent}
.dsh-voice-panel-header{display:flex;align-items:center;justify-content:space-between;gap:12px}
.dsh-voice-panel .dsh-voice-close{display:grid;place-items:center;font-size:22px;line-height:1;width:28px;height:28px;padding:0;border:0;background:transparent}
.dsh-voice-panel.is-recording{pointer-events:none;padding:24px 16px;box-shadow:0 8px 32px #0003}
.dsh-voice-panel.is-cancelling{border-color:var(--dsw-alias-state-error-primary)}
.dsh-voice-recording{display:flex;align-items:center;flex-direction:column;gap:8px;text-align:center}
.dsh-voice-time{font-size:28px;line-height:1.3;font-variant-numeric:tabular-nums;font-weight:600}
.dsh-voice-recording-dot{width:10px;height:10px;border-radius:50%;background:var(--dsw-alias-state-business-primary);animation:dsh-voice-pulse 1s ease-in-out infinite}
.is-cancelling .dsh-voice-recording-dot{background:var(--dsw-alias-state-error-primary);animation:none}
.dsh-voice-setup{display:grid;gap:8px}
.dsh-voice-progress{padding:12px 0}
.dsh-voice-panel .dsh-voice-send{font-weight:600;border-color:var(--dsw-alias-state-business-primary)}
@keyframes dsh-voice-pulse{50%{opacity:.35}}
@media(prefers-reduced-motion:reduce){.dsh-voice-recording-dot{animation:none}}
`;

export function apply(ctx) {
  ctx.effect(() => { const style = document.createElement('style'); style.textContent = CSS; document.head.append(style); return () => style.remove(); });
  wrapUserRenderer(ctx, voiceRenderer);
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right', id: 'voice-message', order: 20,
  }, props => h(VoiceInput, { ...props, key: props.sessionId, ctx })));
}
