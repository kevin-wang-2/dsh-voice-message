window.__ModuleLoader__.load({ id: "dsh-voice-message", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.js
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var import_react2 = __toESM(require("react"), 1);
var import_react_dom = require("react-dom");

// lib/contract.js
var MARKER = "[dsh-voice-message:v1] ";
var AUDIO_PATH = "api/voice-message/audio";
var GUIDANCE = "\u81EA\u52A8\u8BED\u97F3\u8F6C\u5199\u53EF\u80FD\u5B58\u5728\u8BEF\u8BC6\u522B\u6216\u9057\u6F0F\uFF0C\u4E5F\u4E0D\u5305\u542B\u5B8C\u6574\u7684\u8BED\u6C14\u53CA\u73AF\u5883\u58F0\u97F3\u4FE1\u606F\u3002\u82E5\u8F6C\u5199\u542B\u7CCA\u3001\u7591\u4F3C\u9519\u8BEF\uFF0C\u6216\u4E0D\u8DB3\u4EE5\u5B8C\u6210\u4EFB\u52A1\uFF0C\u5E94\u4E3B\u52A8\u4F7F\u7528\u5F53\u524D\u53EF\u7528\u7684\u97F3\u9891\u80FD\u529B\u8F85\u52A9\u7406\u89E3\u539F\u59CB\u5F55\u97F3\u3002\u82E5\u6CA1\u6709\u53EF\u7528\u80FD\u529B\uFF0C\u5E94\u8BF4\u660E\u7406\u89E3\u9650\u5236\uFF0C\u4E0D\u8981\u81C6\u6D4B\u3002\u539F\u59CB\u97F3\u9891\u4E3A\u4E8C\u8FDB\u5236\u6587\u4EF6\uFF0C\u4E0D\u8981\u7528 read \u4F5C\u4E3A\u6587\u672C\u6253\u5F00\u3002";
var STATUS_TEXT = { transcribed: "\u81EA\u52A8\u8F6C\u5199", empty: "\u65E0\u53EF\u7528\u8BED\u97F3\u8F6C\u5199", failed: "\u8F6C\u5199\u5931\u8D25\uFF0C\u4EC5\u53D1\u9001\u539F\u97F3" };
var isAudioType = (value) => typeof value === "string" && /^audio\/(?:webm|mp4|ogg|wav|x-wav|mpeg|aac)(?:;\s*codecs=[\w.,-]+)?$/i.test(value);
function valid(meta) {
  return meta && typeof meta.attachmentId === "string" && meta.attachmentId.length > 0 && typeof meta.name === "string" && /^voice-[\w.-]+$/.test(meta.name) && Number.isSafeInteger(meta.bytes) && meta.bytes > 0 && Number.isFinite(meta.seconds) && meta.seconds > 0 && isAudioType(meta.mediaType) && Object.hasOwn(STATUS_TEXT, meta.status);
}
function buildVoiceText({ file, mediaType, seconds, transcript = "", status }) {
  const meta = { ...file, mediaType, seconds: Math.round(seconds * 1e3) / 1e3, status };
  if (!valid(meta)) throw new Error("\u8BED\u97F3\u5143\u6570\u636E\u65E0\u6548");
  const body = status === "transcribed" ? transcript.trim() : `\uFF08${STATUS_TEXT[status]}\uFF09`;
  if (!body) throw new Error("\u8F6C\u5199\u6B63\u6587\u4E3A\u7A7A");
  return `[\u8BED\u97F3 v1 \xB7 ${meta.seconds.toFixed(1)}s \xB7 ${STATUS_TEXT[status]}]
${MARKER}${JSON.stringify(meta)}
${body}

${GUIDANCE}`;
}
function parseVoiceText(text) {
  if (typeof text !== "string") return null;
  const lines = text.split("\n");
  if (!/^\[语音 v1 · [\d.]+s · [^\]\r\n]+\]$/.test(lines[0]) || !lines[1]?.startsWith(MARKER)) return null;
  try {
    const meta = JSON.parse(lines[1].slice(MARKER.length));
    if (!valid(meta) || lines[0] !== `[\u8BED\u97F3 v1 \xB7 ${meta.seconds.toFixed(1)}s \xB7 ${STATUS_TEXT[meta.status]}]`) return null;
    return { meta, body: [lines[0], ...lines.slice(2)].join("\n") };
  } catch {
    return null;
  }
}
function matchesFile(meta, file) {
  return file && file.attachmentId === meta.attachmentId && file.name === meta.name && file.bytes === meta.bytes;
}

// src/recording.js
var MIME_TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"];
var MAX_SECONDS = 120;
var Recording = class {
  constructor(deviceId = "") {
    this.deviceId = deviceId;
    this.abort = new AbortController();
    this.chunks = [];
  }
  async start(onLimit) {
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) throw new Error("\u5F53\u524D\u6D4F\u89C8\u5668\u4E0D\u652F\u6301\u5F55\u97F3\uFF0C\u8BF7\u4F7F\u7528 HTTPS \u6216 localhost");
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, ...this.deviceId ? { deviceId: { exact: this.deviceId } } : {} } });
    } catch (error) {
      const messages = { NotAllowedError: "\u9EA6\u514B\u98CE\u6743\u9650\u88AB\u62D2\u7EDD\uFF0C\u8BF7\u5728\u6D4F\u89C8\u5668\u8BBE\u7F6E\u4E2D\u5141\u8BB8\u5F55\u97F3", NotFoundError: "\u6CA1\u6709\u627E\u5230\u53EF\u7528\u7684\u9EA6\u514B\u98CE", NotReadableError: "\u9EA6\u514B\u98CE\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6\uFF0C\u8BF7\u68C0\u67E5\u8BBE\u5907\u662F\u5426\u88AB\u5360\u7528" };
      throw new Error(messages[error.name] || error.message, { cause: error });
    }
    if (this.abort.signal.aborted) {
      stream.getTracks().forEach((track) => track.stop());
      this.abort.signal.throwIfAborted();
    }
    this.stream = stream;
    try {
      const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error("\u5F53\u524D\u6D4F\u89C8\u5668\u6CA1\u6709\u53EF\u7528\u7684\u97F3\u9891\u5F55\u5236\u683C\u5F0F");
      this.recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 48e3 });
      this.recorder.ondataavailable = (event) => {
        if (event.data.size) this.chunks.push(event.data);
      };
      this.finished = new Promise((resolve, reject) => {
        this.recorder.onstop = () => resolve();
        this.recorder.onerror = () => {
          reject(new Error("\u5F55\u97F3\u8BBE\u5907\u53D1\u751F\u9519\u8BEF"));
          this.release();
          onLimit();
        };
      });
      this.finished.catch(() => {
      });
      this.recorder.start(1e3);
      this.started = performance.now();
      this.timer = setTimeout(onLimit, MAX_SECONDS * 1e3);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  async stop() {
    clearTimeout(this.timer);
    const seconds = Math.max(1e-3, Math.min(MAX_SECONDS, (performance.now() - this.started) / 1e3));
    if (this.recorder?.state !== "inactive") this.recorder.stop();
    try {
      await this.finished;
      this.abort.signal.throwIfAborted();
      const blob = new Blob(this.chunks, { type: this.recorder.mimeType });
      if (!blob.size) throw new Error("\u6CA1\u6709\u5F55\u5230\u97F3\u9891");
      return { blob, seconds, mediaType: blob.type };
    } finally {
      this.release();
    }
  }
  release() {
    clearTimeout(this.timer);
    this.stream?.getTracks().forEach((track) => track.stop());
  }
  dispose() {
    this.abort.abort();
    if (this.recorder?.state === "recording") this.recorder.stop();
    this.release();
    this.chunks = [];
  }
};
function encodeWave(samples) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16e3, true);
  view.setUint32(28, 32e3, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}
async function prepareWave(blob, signal) {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    signal.throwIfAborted();
    const offline = new OfflineAudioContext(1, Math.max(1, Math.floor(Math.min(decoded.duration, MAX_SECONDS) * 16e3)), 16e3);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const resampled = await offline.startRendering();
    signal.throwIfAborted();
    return { bytes: encodeWave(resampled.getChannelData(0)), seconds: decoded.duration };
  } finally {
    await context.close();
  }
}
function base64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}
function recordingName(recording, date = /* @__PURE__ */ new Date()) {
  const ext = recording.mediaType.split(";")[0].split("/")[1];
  return `voice-${date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}-${recording.seconds.toFixed(1)}s.${ext}`;
}

// src/wrap.js
var import_react = __toESM(require("react"), 1);
function wrapUserRenderer(ctx, renderVoice) {
  return ctx.slots.inject("conversation.chat.node", () => {
    let disposeWrapper;
    function install() {
      if (disposeWrapper) return;
      const entry = ctx.slots.entriesOfSlot("conversation.chat.node").find((item) => item.options.key === "user");
      if (!entry) return;
      if (entry.children || entry.store || entry.inject) throw new Error("\u5F53\u524D\u7528\u6237\u6D88\u606F\u6E32\u67D3\u5668\u4E0D\u80FD\u901A\u8FC7\u516C\u5F00\u63A5\u53E3\u5305\u88C5");
      const Original = entry.component;
      function VoiceMessageWrapper(props) {
        function renderFactorySlot(factory, input, options) {
          if (factory === "conversation.chat.user.content") {
            const custom = renderVoice(input, props, props.renderFactorySlot, options);
            if (custom !== null) return custom;
          }
          return props.renderFactorySlot(factory, input, options);
        }
        return import_react.default.createElement(Original, { ...props, renderFactorySlot });
      }
      disposeWrapper = ctx.slots.register({
        name: "conversation.chat.node",
        key: "user",
        priority: (entry.options.priority ?? 0) - 1,
        ...entry.locale ? { locale: entry.locale } : {}
      }, VoiceMessageWrapper);
    }
    const unsubscribe = ctx.slots.subscribe("conversation.chat.node", install);
    install();
    return () => {
      unsubscribe();
      disposeWrapper?.();
    };
  });
}

// src/client.js
var inject = ["slots", "connection", "remote", "remote.session", "remote.fileUploads", "fileUpload"];
var h = import_react2.default.createElement;
var PREPARATION_TEXT = { unprepared: "\u5C1A\u672A\u51C6\u5907", ready: "\u5DF2\u5C31\u7EEA", standby: "\u5F85\u5524\u9192", checking: "\u6B63\u5728\u68C0\u67E5", downloading: "\u6B63\u5728\u4E0B\u8F7D\u6A21\u578B", loading: "\u6B63\u5728\u52A0\u8F7D", waking: "\u6B63\u5728\u5524\u9192", failed: "\u51C6\u5907\u5931\u8D25", cancelled: "\u5DF2\u53D6\u6D88", cancelling: "\u6B63\u5728\u53D6\u6D88" };
var messageOf = (error) => error?.message || String(error);
async function unwrap(result) {
  if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
  return result.value;
}
var speechCall = (ctx, method, args = {}, signal) => ctx.connection.rpc.call("/api", `speech/${method}`, { args }, signal).then(unwrap);
function VoicePlayer({ voice, sessionId }) {
  const resources = (0, import_react2.useRef)({ context: null, buffer: null, source: null, offset: 0, startedAt: 0, abort: null });
  const [playing, setPlaying] = (0, import_react2.useState)(false);
  const [loaded, setLoaded] = (0, import_react2.useState)(false);
  const [loading, setLoading] = (0, import_react2.useState)(false);
  const [position, setPosition] = (0, import_react2.useState)(0);
  const [duration, setDuration] = (0, import_react2.useState)(voice.meta.seconds);
  const [error, setError] = (0, import_react2.useState)("");
  function currentPosition() {
    const r = resources.current;
    return Math.min(r.buffer?.duration ?? duration, r.offset + (r.source ? r.context.currentTime - r.startedAt : 0));
  }
  function stopSource() {
    const r = resources.current;
    if (!r.source) return;
    r.source.onended = null;
    r.source.stop();
    r.source.disconnect();
    r.source = null;
  }
  function startSource() {
    const r = resources.current;
    const source = r.context.createBufferSource();
    source.buffer = r.buffer;
    source.connect(r.context.destination);
    r.source = source;
    r.startedAt = r.context.currentTime;
    source.onended = () => {
      if (r.source !== source) return;
      source.disconnect();
      r.source = null;
      r.offset = r.buffer.duration;
      setPosition(r.buffer.duration);
      setPlaying(false);
    };
    source.start(0, r.offset);
    setPlaying(true);
  }
  async function play() {
    const r = resources.current;
    if (loading || r.source) return;
    setError("");
    r.abort ??= new AbortController();
    try {
      r.context ??= new AudioContext();
      await r.context.resume();
      r.abort.signal.throwIfAborted();
      if (!r.buffer) {
        setLoading(true);
        const response = await fetch(`${AUDIO_PATH}?${new URLSearchParams({ sessionId, attachmentId: voice.meta.attachmentId })}`, { signal: r.abort.signal, credentials: "same-origin" });
        if (!response.ok) throw new Error("\u539F\u59CB\u97F3\u9891\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6\uFF0C\u8BF7\u68C0\u67E5\u8FDE\u63A5\u6216\u9644\u4EF6\u662F\u5426\u4ECD\u5B58\u5728");
        const buffer = await r.context.decodeAudioData(await response.arrayBuffer());
        r.abort.signal.throwIfAborted();
        r.buffer = buffer;
        setDuration(buffer.duration);
        setLoaded(true);
      }
      r.abort.signal.throwIfAborted();
      if (r.offset >= r.buffer.duration) r.offset = 0;
      startSource();
    } catch (error2) {
      if (!r.abort?.signal.aborted) setError(messageOf(error2));
    } finally {
      if (!r.abort?.signal.aborted) setLoading(false);
    }
  }
  function pause() {
    const r = resources.current;
    r.offset = currentPosition();
    stopSource();
    setPosition(r.offset);
    setPlaying(false);
  }
  function seek(event) {
    const r = resources.current;
    const wasPlaying = !!r.source;
    stopSource();
    r.offset = Number(event.target.value);
    setPosition(r.offset);
    if (wasPlaying && r.offset < r.buffer.duration) startSource();
    else setPlaying(false);
  }
  (0, import_react2.useEffect)(() => {
    if (!playing) return;
    const timer = setInterval(() => setPosition(currentPosition()), 100);
    return () => clearInterval(timer);
  }, [playing]);
  (0, import_react2.useEffect)(() => () => {
    const r = resources.current;
    r.abort?.abort();
    stopSource();
    if (r.context && r.context.state !== "closed") void r.context.close();
    r.buffer = null;
  }, []);
  const body = voice.body.split("\n").slice(1).join("\n").replace(`

${GUIDANCE}`, "");
  return h(
    "section",
    { className: "dsh-voice-card", "aria-label": "\u8BED\u97F3\u6D88\u606F" },
    h("div", { className: "dsh-voice-meta" }, `\u8BED\u97F3 ${voice.meta.seconds.toFixed(1)}s \xB7 ${Math.ceil(voice.meta.bytes / 1024)} KB`),
    h("button", { type: "button", disabled: loading, onClick: playing ? pause : play }, loading ? "\u8BFB\u53D6\u97F3\u9891\u2026" : playing ? "\u6682\u505C\u539F\u97F3" : loaded ? "\u7EE7\u7EED\u64AD\u653E" : "\u64AD\u653E\u539F\u97F3"),
    h("input", {
      type: "range",
      min: 0,
      max: duration,
      step: 0.1,
      value: position,
      disabled: !loaded,
      "aria-label": "\u8BED\u97F3\u64AD\u653E\u8FDB\u5EA6",
      onChange: seek
    }),
    h("span", null, `${position.toFixed(1)} / ${duration.toFixed(1)}s`),
    error && h("div", { role: "alert" }, error, h("button", { type: "button", onClick: play }, "\u91CD\u8BD5\u64AD\u653E")),
    h("details", null, h("summary", null, STATUS_TEXT[voice.meta.status]), h("pre", null, body))
  );
}
function voiceRenderer(input, props, original, options) {
  const voice = parseVoiceText(input.content.text);
  if (!voice) return null;
  const index = input.content.attachments.findIndex((a) => a.type === "file" && matchesFile(voice.meta, a.file));
  if (index < 0) return null;
  const attachments = input.content.attachments.filter((_, i) => i !== index);
  const remainder = { ...input, content: { ...input.content, text: "", attachments } };
  return h(
    import_react2.default.Fragment,
    null,
    h(VoicePlayer, { key: `${props.sessionId}:${voice.meta.attachmentId}`, voice, sessionId: props.sessionId }),
    attachments.length || input.content.extraBlocks.length || input.content.referenceLabels?.length ? original("conversation.chat.user.content", remainder, options) : null
  );
}
function VoiceInput({ ctx, sessionId, locked }) {
  const [open, setOpen] = (0, import_react2.useState)(false);
  const anchor = (0, import_react2.useRef)();
  const [panelPosition, setPanelPosition] = (0, import_react2.useState)(null);
  const [phase, setPhase] = (0, import_react2.useState)("idle");
  const [catalog, setCatalog] = (0, import_react2.useState)(null);
  const [setupError, setSetupError] = (0, import_react2.useState)("");
  const [error, setError] = (0, import_react2.useState)("");
  const [devices, setDevices] = (0, import_react2.useState)([]);
  const [device, setDevice] = (0, import_react2.useState)("");
  const [source, setSource] = (0, import_react2.useState)("");
  const [draft, setDraft] = (0, import_react2.useState)(null);
  const [elapsed, setElapsed] = (0, import_react2.useState)(0);
  const [preview, setPreview] = (0, import_react2.useState)("");
  const life = (0, import_react2.useRef)({ generation: 0, recording: null, abort: null, draft: null, phase: "idle" });
  const provider = catalog?.providers.find((p) => p.id === catalog.selection.providerId && p.location === "host-local") ?? catalog?.providers.find((p) => p.location === "host-local");
  const ready = ["ready", "standby"].includes(provider?.preparation.phase);
  const busy = ["requesting", "recording", "transcribing", "sending"].includes(phase);
  const setPhaseNow = (value) => {
    life.current.phase = value;
    setPhase(value);
  };
  function reset(close = true) {
    life.current.generation++;
    life.current.abort?.abort();
    life.current.recording?.dispose();
    life.current.recording = null;
    life.current.draft = null;
    setDraft(null);
    setError("");
    setElapsed(0);
    setPhaseNow("idle");
    if (close) setOpen(false);
  }
  async function refreshCatalog() {
    try {
      setCatalog(await speechCall(ctx, "catalog"));
      setSetupError("");
    } catch {
      setSetupError("\u672C\u5730\u8F6C\u5199\u670D\u52A1\u672A\u5C31\u7EEA\uFF0C\u8BF7\u68C0\u67E5\u8BED\u97F3\u63D2\u4EF6\u53CA Speech \u670D\u52A1\u662F\u5426\u5DF2\u542F\u7528");
    }
  }
  (0, import_react2.useLayoutEffect)(() => {
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
        ...aboveSpace >= belowSpace ? { bottom: window.innerHeight - above, maxHeight: Math.min(height * 0.65, aboveSpace) } : { top: below, maxHeight: Math.min(height * 0.65, belowSpace) }
      });
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    viewport?.addEventListener("resize", updatePosition);
    viewport?.addEventListener("scroll", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      viewport?.removeEventListener("resize", updatePosition);
      viewport?.removeEventListener("scroll", updatePosition);
    };
  }, [open]);
  (0, import_react2.useEffect)(() => {
    if (open) {
      void refreshCatalog();
      navigator.mediaDevices?.enumerateDevices().then((all) => setDevices(all.filter((d) => d.kind === "audioinput"))).catch(() => {
      });
    }
  }, [open]);
  (0, import_react2.useEffect)(() => {
    if (!open || !provider || ["unprepared", "ready", "standby", "failed", "cancelled"].includes(provider.preparation.phase)) return;
    const timer = setInterval(() => void refreshCatalog(), 1e3);
    return () => clearInterval(timer);
  }, [open, provider?.preparation.phase]);
  (0, import_react2.useEffect)(() => {
    if (phase !== "recording") return;
    const timer = setInterval(() => setElapsed(Math.min(MAX_SECONDS, (performance.now() - life.current.recording.started) / 1e3)), 200);
    return () => clearInterval(timer);
  }, [phase]);
  (0, import_react2.useEffect)(() => {
    if (!draft) return;
    const url = URL.createObjectURL(draft.blob);
    setPreview(url);
    return () => {
      URL.revokeObjectURL(url);
      setPreview("");
    };
  }, [draft?.blob]);
  (0, import_react2.useEffect)(() => {
    const hidden = () => {
      if (document.hidden && ["requesting", "recording"].includes(life.current.phase)) reset();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      life.current.generation++;
      life.current.abort?.abort();
      life.current.recording?.dispose();
    };
  }, [sessionId]);
  async function transcribe(recording, generation = life.current.generation) {
    setPhaseNow("transcribing");
    setError("");
    const abort = new AbortController();
    life.current.abort = abort;
    try {
      const prepared = await prepareWave(recording.blob, abort.signal);
      recording = { ...recording, seconds: prepared.seconds };
      recording.name = recordingName(recording, recording.recordedAt);
      const wave = prepared.bytes;
      if (!provider || !ready) throw new Error("\u672C\u5730\u8F6C\u5199\u672A\u51C6\u5907\u597D\uFF0C\u53EF\u4EE5\u51C6\u5907\u540E\u91CD\u8BD5\u6216\u4EC5\u53D1\u9001\u539F\u97F3");
      if (wave.length > catalog.maxAudioBytes) throw new Error("\u9884\u5904\u7406\u97F3\u9891\u8D85\u8FC7\u5F53\u524D\u8F6C\u5199\u670D\u52A1\u7684\u5B57\u8282\u4E0A\u9650");
      const result = await speechCall(ctx, "transcribe", { request: { audioBase64: base64(wave), providerId: provider.id, language: catalog.selection.language || "auto" } }, abort.signal);
      if (generation !== life.current.generation) return;
      const value = { ...recording, transcript: result.text.trim(), status: result.text.trim() ? "transcribed" : "empty" };
      life.current.draft = value;
      setDraft(value);
      setPhaseNow("ready");
    } catch (error2) {
      if (generation !== life.current.generation || abort.signal.aborted) return;
      const value = { ...recording, transcript: "", status: "failed" };
      life.current.draft = value;
      setDraft(value);
      setError(messageOf(error2));
      setPhaseNow("ready");
    }
  }
  async function stop() {
    if (life.current.phase !== "recording") return;
    setPhaseNow("transcribing");
    const generation = life.current.generation;
    try {
      const recording = await life.current.recording.stop();
      if (generation !== life.current.generation) return;
      const value = { ...recording, requestId: crypto.randomUUID(), recordedAt: /* @__PURE__ */ new Date() };
      value.name = recordingName(value, value.recordedAt);
      life.current.draft = value;
      setDraft(value);
      await transcribe(value, generation);
    } catch (error2) {
      if (generation === life.current.generation) {
        setError(messageOf(error2));
        setPhaseNow("idle");
      }
    }
  }
  async function start() {
    setPhaseNow("requesting");
    setError("");
    const generation = ++life.current.generation;
    const recording = new Recording(device);
    life.current.recording = recording;
    try {
      await recording.start(() => void stop());
      if (generation !== life.current.generation) {
        recording.dispose();
        return;
      }
      setPhaseNow("recording");
      const all = await navigator.mediaDevices.enumerateDevices();
      if (generation === life.current.generation) setDevices(all.filter((d) => d.kind === "audioinput"));
    } catch (error2) {
      if (generation === life.current.generation) {
        setError(messageOf(error2));
        setPhaseNow("idle");
      }
    }
  }
  async function send() {
    if (life.current.phase !== "ready") return;
    const generation = life.current.generation;
    const value = life.current.draft;
    setPhaseNow("sending");
    setError("");
    const abort = new AbortController();
    life.current.abort = abort;
    try {
      const uploaded = await unwrap(await ctx.fileUpload.upload(sessionId, value.blob, value.name, abort.signal));
      abort.signal.throwIfAborted();
      if (generation !== life.current.generation) return;
      const text = buildVoiceText({ file: uploaded.file, mediaType: value.mediaType, seconds: value.seconds, transcript: value.transcript, status: value.status });
      await unwrap(await ctx.remote.session.prompt({ sessionId, requestId: value.requestId, mode: "queue", content: [{ type: "text", text }, { type: "file", receiptId: uploaded.receiptId }] }, abort.signal));
      if (generation === life.current.generation) reset();
    } catch (error2) {
      if (generation === life.current.generation && !abort.signal.aborted) {
        setError(`\u53D1\u9001\u672A\u786E\u8BA4\uFF1A${messageOf(error2)}\u3002\u53EF\u91CD\u8BD5\u53D1\u9001\uFF0C\u540C\u4E00\u5F55\u97F3\u4F7F\u7528\u76F8\u540C\u6D88\u606F\u6807\u8BC6\u3002`);
        setPhaseNow("ready");
      }
    }
  }
  async function prepare() {
    try {
      setSetupError("");
      await speechCall(ctx, "prepare", { providerId: provider.id, ...source ? { options: { downloadSource: source } } : {} });
      await refreshCatalog();
    } catch (error2) {
      setSetupError(messageOf(error2));
    }
  }
  return h(
    "div",
    { ref: anchor, className: "dsh-voice-input", key: sessionId },
    h("button", { type: "button", disabled: locked && !open, "aria-label": "\u8BED\u97F3\u6D88\u606F", "aria-expanded": open, onClick: () => {
      if (!busy && !draft) setOpen(!open);
    } }, "\u8BED\u97F3"),
    open && (0, import_react_dom.createPortal)(h(
      "section",
      { className: "dsh-voice-panel", style: panelPosition ?? { visibility: "hidden" }, "aria-label": "\u5F55\u5236\u8BED\u97F3\u6D88\u606F" },
      h("strong", null, "\u8BED\u97F3\u6D88\u606F"),
      devices.length > 1 && h("label", null, "\u9EA6\u514B\u98CE ", h("select", { value: device, disabled: busy || !!draft, onChange: (e) => setDevice(e.target.value) }, h("option", { value: "" }, "\u9ED8\u8BA4\u8BBE\u5907"), devices.filter((d) => d.deviceId && d.deviceId !== "default").map((d, i) => h("option", { key: d.deviceId, value: d.deviceId }, d.label || `\u9EA6\u514B\u98CE ${i + 1}`)))),
      !ready && h(
        "div",
        null,
        h("p", null, provider ? `\u672C\u5730\u8F6C\u5199\uFF1A${PREPARATION_TEXT[provider.preparation.phase] || "\u6B63\u5728\u51C6\u5907"}` : "\u672C\u5730\u8F6C\u5199\u670D\u52A1\u672A\u5C31\u7EEA"),
        provider?.downloadSources?.length > 0 && h("select", { "aria-label": "\u6A21\u578B\u4E0B\u8F7D\u6765\u6E90", value: source, onChange: (e) => setSource(e.target.value) }, h("option", { value: "" }, "\u9009\u62E9\u4E0B\u8F7D\u6765\u6E90"), provider.downloadSources.map((s) => h("option", { key: s, value: s }, s))),
        provider && h("button", { type: "button", disabled: busy || !!provider.downloadSources?.length && !source, onClick: prepare }, "\u4E0B\u8F7D\u5E76\u51C6\u5907\u672C\u5730\u8F6C\u5199"),
        h("button", { type: "button", disabled: busy, onClick: refreshCatalog }, "\u68C0\u67E5\u51C6\u5907\u72B6\u6001")
      ),
      (setupError || provider?.preparation.phase === "failed") && h("p", { role: "alert" }, setupError || provider.preparation.message),
      phase === "idle" && h("button", { type: "button", disabled: locked, onClick: start }, "\u5F00\u59CB\u5F55\u97F3"),
      phase === "requesting" && h("p", { role: "status" }, "\u7B49\u5F85\u9EA6\u514B\u98CE\u6743\u9650\u2026"),
      phase === "recording" && h(import_react2.default.Fragment, null, h("p", { role: "status" }, `\u6B63\u5728\u5F55\u97F3 ${elapsed.toFixed(1)} / ${MAX_SECONDS}s`), h("button", { type: "button", onClick: stop }, "\u505C\u6B62\u5F55\u97F3")),
      phase === "transcribing" && h("p", { role: "status" }, "\u6B63\u5728\u8F6C\u5199\u2026"),
      phase === "sending" && h("p", { role: "status" }, "\u6B63\u5728\u53D1\u9001\u2026"),
      draft && h(
        import_react2.default.Fragment,
        null,
        h("audio", { controls: true, src: preview, "aria-label": "\u5F85\u53D1\u9001\u5F55\u97F3" }),
        h("p", null, STATUS_TEXT[draft.status] || "\u7B49\u5F85\u8F6C\u5199"),
        draft.transcript && h("pre", null, draft.transcript),
        phase === "ready" && h(
          "div",
          { className: "dsh-voice-actions" },
          h("button", { type: "button", disabled: locked, onClick: send }, draft.status === "failed" ? "\u4EC5\u53D1\u9001\u539F\u97F3" : "\u53D1\u9001\u8BED\u97F3"),
          draft.status === "failed" && h("button", { type: "button", disabled: !ready, onClick: () => transcribe(life.current.draft) }, "\u91CD\u8BD5\u8F6C\u5199")
        )
      ),
      error && h("p", { role: "alert" }, error),
      h("button", { type: "button", disabled: phase === "sending", onClick: () => reset() }, "\u53D6\u6D88")
    ), document.body)
  );
}
var CSS = `
.dsh-voice-input{position:relative;display:inline-flex;color:var(--dsw-alias-label-primary)}
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
`;
function apply(ctx) {
  ctx.effect(() => {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.append(style);
    return () => style.remove();
  });
  wrapUserRenderer(ctx, voiceRenderer);
  ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
    name: "conversation.input.right",
    id: "voice-message",
    order: 20
  }, (props) => h(VoiceInput, { ...props, key: props.sessionId, ctx })));
}
return module.exports; } });
