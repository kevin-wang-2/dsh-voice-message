export const MARKER = '[dsh-voice-message:v1] ';
export const AUDIO_PATH = 'api/voice-message/audio';
export const GUIDANCE = '自动语音转写可能存在误识别或遗漏，也不包含完整的语气及环境声音信息。若转写含糊、疑似错误，或不足以完成任务，应主动使用当前可用的音频能力辅助理解原始录音。若没有可用能力，应说明理解限制，不要臆测。原始音频为二进制文件，不要用 read 作为文本打开。';
export const STATUS_TEXT = { transcribed: '自动转写', empty: '无可用语音转写', failed: '转写失败，仅发送原音' };
export const isAudioType = value => typeof value === 'string' && /^audio\/(?:webm|mp4|ogg|wav|x-wav|mpeg|aac)(?:;\s*codecs=[\w.,-]+)?$/i.test(value);

function valid(meta) {
  return meta && typeof meta.attachmentId === 'string' && meta.attachmentId.length > 0 &&
    typeof meta.name === 'string' && /^voice-[\w.-]+$/.test(meta.name) &&
    Number.isSafeInteger(meta.bytes) && meta.bytes > 0 &&
    Number.isFinite(meta.seconds) && meta.seconds > 0 &&
    isAudioType(meta.mediaType) && Object.hasOwn(STATUS_TEXT, meta.status);
}

export function buildVoiceText({ file, mediaType, seconds, transcript = '', status }) {
  const meta = { ...file, mediaType, seconds: Math.round(seconds * 1000) / 1000, status };
  if (!valid(meta)) throw new Error('语音元数据无效');
  const body = status === 'transcribed' ? transcript.trim() : `（${STATUS_TEXT[status]}）`;
  if (!body) throw new Error('转写正文为空');
  return `[语音 v1 · ${meta.seconds.toFixed(1)}s · ${STATUS_TEXT[status]}]\n${MARKER}${JSON.stringify(meta)}\n${body}\n\n${GUIDANCE}`;
}

export function parseVoiceText(text) {
  if (typeof text !== 'string') return null;
  const lines = text.split('\n');
  if (!/^\[语音 v1 · [\d.]+s · [^\]\r\n]+\]$/.test(lines[0]) || !lines[1]?.startsWith(MARKER)) return null;
  try {
    const meta = JSON.parse(lines[1].slice(MARKER.length));
    if (!valid(meta) || lines[0] !== `[语音 v1 · ${meta.seconds.toFixed(1)}s · ${STATUS_TEXT[meta.status]}]`) return null;
    return { meta, body: [lines[0], ...lines.slice(2)].join('\n') };
  } catch { return null; }
}

export function voiceInContent(content) {
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (block.type !== 'text') continue;
    const voice = parseVoiceText(block.text);
    if (!voice) continue;
    const file = content.find(b => b.type === 'file' && matchesFile(voice.meta, b.attachment));
    if (file) return { ...voice, file: file.attachment };
  }
  return null;
}

export function matchesFile(meta, file) {
  return file && file.attachmentId === meta.attachmentId && file.name === meta.name && file.bytes === meta.bytes;
}
