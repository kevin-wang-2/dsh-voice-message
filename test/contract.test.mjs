import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVoiceText, parseVoiceText, voiceInContent, MARKER } from '../lib/contract.js';
const file = { attachmentId: 'audio-id', name: 'voice-20261024T131900Z-1s.webm', bytes: 800 };
const spec = { file, seconds: 1.234, mediaType: 'audio/webm;codecs=opus', transcript: '测试\n第二行', status: 'transcribed' };
test('voice contract round trips original attachment, format, duration and multiline transcript', () => {
  const text = buildVoiceText(spec);
  const parsed = parseVoiceText(text);
  assert.equal(parsed.meta.attachmentId, file.attachmentId);
  assert.equal(parsed.meta.seconds, 1.234);
  assert.match(parsed.body, /测试\n第二行/);
  assert.doesNotMatch(text, /MMP|mmp_|triage|ffmpeg|librosa/);
  assert.match(text, /二进制文件，不要用 read/);
  assert.ok(voiceInContent([{ type: 'text', text }, { type: 'file', attachment: file }]));
});
test('ordinary files, broken markers, and mismatched references remain ordinary messages', () => {
  assert.equal(parseVoiceText('some.webm'), null);
  assert.equal(parseVoiceText(`${MARKER}{broken}\ntext`), null);
  assert.equal(voiceInContent([{ type: 'text', text: buildVoiceText(spec) }, { type: 'file', attachment: { ...file, attachmentId: 'other' } }]), null);
  assert.throws(() => buildVoiceText({ ...spec, seconds: -1 }));
  assert.throws(() => buildVoiceText({ ...spec, mediaType: 'text/html' }));
});
test('empty recognition and failed recognition have distinct durable status', () => {
  for (const status of ['empty', 'failed']) {
    const parsed = parseVoiceText(buildVoiceText({ ...spec, transcript: '', status }));
    assert.equal(parsed.meta.status, status);
    assert.doesNotMatch(parsed.body, /· 自动转写/);
  }
  assert.throws(() => buildVoiceText({ ...spec, transcript: '' }));
});
