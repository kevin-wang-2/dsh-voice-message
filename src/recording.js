const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
export const MAX_SECONDS = 120;

export class Recording {
  constructor(deviceId = '') {
    this.deviceId = deviceId;
    this.abort = new AbortController();
    this.chunks = [];
  }
  async start(onLimit) {
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) throw new Error('当前浏览器不支持录音，请使用 HTTPS 或 localhost');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, ...(this.deviceId ? { deviceId: { exact: this.deviceId } } : {}) } });
    } catch (error) {
      const messages = { NotAllowedError: '麦克风权限被拒绝，请在浏览器设置中允许录音', NotFoundError: '没有找到可用的麦克风', NotReadableError: '麦克风暂时无法读取，请检查设备是否被占用' };
      throw new Error(messages[error.name] || error.message, { cause: error });
    }
    if (this.abort.signal.aborted) { stream.getTracks().forEach(track => track.stop()); this.abort.signal.throwIfAborted(); }
    this.stream = stream;
    try {
      const mimeType = MIME_TYPES.find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('当前浏览器没有可用的音频录制格式');
      this.recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 48000 });
      this.recorder.ondataavailable = event => { if (event.data.size) this.chunks.push(event.data); };
      this.finished = new Promise((resolve, reject) => {
        this.recorder.onstop = () => resolve();
        this.recorder.onerror = () => { reject(new Error('录音设备发生错误')); this.release(); onLimit(); };
      });
      // Keep a rejection observed even if a device fails before Stop is clicked.
      this.finished.catch(() => {});
      this.recorder.start(1000);
      this.started = performance.now();
      this.timer = setTimeout(onLimit, MAX_SECONDS * 1000);
    } catch (error) { this.dispose(); throw error; }
  }
  async stop() {
    clearTimeout(this.timer);
    const seconds = Math.max(0.001, Math.min(MAX_SECONDS, (performance.now() - this.started) / 1000));
    if (this.recorder?.state !== 'inactive') this.recorder.stop();
    try {
      await this.finished;
      this.abort.signal.throwIfAborted();
      const blob = new Blob(this.chunks, { type: this.recorder.mimeType });
      if (!blob.size) throw new Error('没有录到音频');
      return { blob, seconds, mediaType: blob.type };
    } finally { this.release(); }
  }
  release() {
    clearTimeout(this.timer);
    this.stream?.getTracks().forEach(track => track.stop());
  }
  dispose() {
    this.abort.abort();
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.release();
    this.chunks = [];
  }
}

export function encodeWave(samples) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}

export async function prepareWave(blob, signal) {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    signal.throwIfAborted();
    const offline = new OfflineAudioContext(1, Math.max(1, Math.floor(Math.min(decoded.duration, MAX_SECONDS) * 16000)), 16000);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const resampled = await offline.startRendering();
    signal.throwIfAborted();
    return { bytes: encodeWave(resampled.getChannelData(0)), seconds: decoded.duration };
  } finally { await context.close(); }
}

export function base64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}

export function recordingName(recording, date = new Date()) {
  const ext = recording.mediaType.split(';')[0].split('/')[1];
  return `voice-${date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-${recording.seconds.toFixed(1)}s.${ext}`;
}
