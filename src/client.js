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
  const life = useRef({ generation: 0, recording: null, abort: null, draft: null, phase: 'idle' });
  const provider = catalog?.providers.find(p => p.id === catalog.selection.providerId && p.location === 'host-local') ?? catalog?.providers.find(p => p.location === 'host-local');
  const ready = ['ready', 'standby'].includes(provider?.preparation.phase);
  const busy = ['requesting', 'recording', 'transcribing', 'sending'].includes(phase);
  const setPhaseNow = value => { life.current.phase = value; setPhase(value); };

  function reset(close = true) {
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
    if (open) {
      void refreshCatalog();
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
    const timer = setInterval(() => setElapsed(Math.min(MAX_SECONDS, (performance.now() - life.current.recording.started) / 1000)), 200);
    return () => clearInterval(timer);
  }, [phase]);
  useEffect(() => {
    if (!draft) return;
    const url = URL.createObjectURL(draft.blob); setPreview(url);
    return () => { URL.revokeObjectURL(url); setPreview(''); };
  }, [draft?.blob]);
  useEffect(() => {
    const hidden = () => { if (document.hidden && ['requesting', 'recording'].includes(life.current.phase)) reset(); };
    document.addEventListener('visibilitychange', hidden);
    return () => { document.removeEventListener('visibilitychange', hidden); life.current.generation++; life.current.abort?.abort(); life.current.recording?.dispose(); };
  }, [sessionId]);

  async function transcribe(recording, generation = life.current.generation) {
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
    } catch (error) {
      if (generation !== life.current.generation || abort.signal.aborted) return;
      const value = { ...recording, transcript: '', status: 'failed' };
      life.current.draft = value; setDraft(value); setError(messageOf(error)); setPhaseNow('ready');
    }
  }
  async function stop() {
    if (life.current.phase !== 'recording') return;
    setPhaseNow('transcribing');
    const generation = life.current.generation;
    try {
      const recording = await life.current.recording.stop();
      if (generation !== life.current.generation) return;
      const value = { ...recording, requestId: crypto.randomUUID(), recordedAt: new Date() };
      value.name = recordingName(value, value.recordedAt);
      life.current.draft = value; setDraft(value);
      await transcribe(value, generation);
    } catch (error) { if (generation === life.current.generation) { setError(messageOf(error)); setPhaseNow('idle'); } }
  }
  async function start() {
    setPhaseNow('requesting'); setError('');
    const generation = ++life.current.generation;
    const recording = new Recording(device); life.current.recording = recording;
    try {
      await recording.start(() => void stop());
      if (generation !== life.current.generation) { recording.dispose(); return; }
      setPhaseNow('recording');
      const all = await navigator.mediaDevices.enumerateDevices();
      if (generation === life.current.generation) setDevices(all.filter(d => d.kind === 'audioinput'));
    } catch (error) { if (generation === life.current.generation) { setError(messageOf(error)); setPhaseNow('idle'); } }
  }
  async function send() {
    if (life.current.phase !== 'ready') return;
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
  return h('div', { ref: anchor, className: 'dsh-voice-input', key: sessionId },
    h('button', { type: 'button', disabled: locked && !open, 'aria-label': '语音消息', 'aria-expanded': open, onClick: () => { if (!busy && !draft) setOpen(!open); } }, '语音'),
    open && createPortal(h('section', { className: 'dsh-voice-panel', style: panelPosition ?? { visibility: 'hidden' }, 'aria-label': '录制语音消息' },
      h('strong', null, '语音消息'),
      devices.length > 1 && h('label', null, '麦克风 ', h('select', { value: device, disabled: busy || !!draft, onChange: e => setDevice(e.target.value) }, h('option', { value: '' }, '默认设备'), devices.filter(d => d.deviceId && d.deviceId !== 'default').map((d, i) => h('option', { key: d.deviceId, value: d.deviceId }, d.label || `麦克风 ${i + 1}`)))),
      !ready && h('div', null,
        h('p', null, provider ? `本地转写：${PREPARATION_TEXT[provider.preparation.phase] || '正在准备'}` : '本地转写服务未就绪'),
        provider?.downloadSources?.length > 0 && h('select', { 'aria-label': '模型下载来源', value: source, onChange: e => setSource(e.target.value) }, h('option', { value: '' }, '选择下载来源'), provider.downloadSources.map(s => h('option', { key: s, value: s }, s))),
        provider && h('button', { type: 'button', disabled: busy || (!!provider.downloadSources?.length && !source), onClick: prepare }, '下载并准备本地转写'),
        h('button', { type: 'button', disabled: busy, onClick: refreshCatalog }, '检查准备状态')),
      (setupError || provider?.preparation.phase === 'failed') && h('p', { role: 'alert' }, setupError || provider.preparation.message),
      phase === 'idle' && h('button', { type: 'button', disabled: locked, onClick: start }, '开始录音'),
      phase === 'requesting' && h('p', { role: 'status' }, '等待麦克风权限…'),
      phase === 'recording' && h(React.Fragment, null, h('p', { role: 'status' }, `正在录音 ${elapsed.toFixed(1)} / ${MAX_SECONDS}s`), h('button', { type: 'button', onClick: stop }, '停止录音')),
      phase === 'transcribing' && h('p', { role: 'status' }, '正在转写…'),
      phase === 'sending' && h('p', { role: 'status' }, '正在发送…'),
      draft && h(React.Fragment, null,
        h('audio', { controls: true, src: preview, 'aria-label': '待发送录音' }),
        h('p', null, STATUS_TEXT[draft.status] || '等待转写'),
        draft.transcript && h('pre', null, draft.transcript),
        phase === 'ready' && h('div', { className: 'dsh-voice-actions' },
          h('button', { type: 'button', disabled: locked, onClick: send }, draft.status === 'failed' ? '仅发送原音' : '发送语音'),
          draft.status === 'failed' && h('button', { type: 'button', disabled: !ready, onClick: () => transcribe(life.current.draft) }, '重试转写'))),
      error && h('p', { role: 'alert' }, error),
      h('button', { type: 'button', disabled: phase === 'sending', onClick: () => reset() }, '取消')), document.body));
}

const CSS = `
.dsh-voice-input{position:relative;display:inline-flex}
.dsh-voice-panel,.dsh-voice-card{box-sizing:border-box;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-background-primary,#fff);border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:12px;padding:12px;font-size:14px;line-height:1.5}
.dsh-voice-panel{position:fixed;overflow:auto;z-index:1000;display:grid;gap:8px;box-shadow:0 4px 20px #0002}
.dsh-voice-card{max-width:min(360px,100%);display:grid;gap:8px}
.dsh-voice-panel audio{width:100%;min-width:0}
.dsh-voice-card pre,.dsh-voice-panel pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;margin:0}
.dsh-voice-panel p{margin:0}.dsh-voice-actions{display:flex;flex-wrap:wrap;gap:8px}
.dsh-voice-input button,.dsh-voice-panel button,.dsh-voice-card button{font:inherit;color:inherit;border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:6px;background:transparent;padding:4px 8px;cursor:pointer}
.dsh-voice-input button:disabled,.dsh-voice-panel button:disabled,.dsh-voice-card button:disabled{opacity:.5;cursor:default}
.dsh-voice-meta{font-size:13px;color:var(--dsw-alias-label-secondary)}
`;

export function apply(ctx) {
  ctx.effect(() => { const style = document.createElement('style'); style.textContent = CSS; document.head.append(style); return () => style.remove(); });
  wrapUserRenderer(ctx, voiceRenderer);
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right', id: 'voice-message', order: 20,
  }, props => h(VoiceInput, { ...props, key: props.sessionId, ctx })));
}
