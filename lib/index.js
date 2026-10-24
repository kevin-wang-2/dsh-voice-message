import { AUDIO_PATH, voiceInContent } from './contract.js';

export const name = 'voice-message';
export const inject = ['connection', 'sessionQuery', 'attachments'];

export function findVoiceAttachment(events, attachmentId) {
  for (const event of events) {
    if (event.type !== 'user/message') continue;
    const voice = voiceInContent(event.data?.content);
    if (voice?.file.attachmentId === attachmentId) return voice;
  }
  return null;
}

export async function audioResponse(ctx, request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('sessionId');
  const attachmentId = url.searchParams.get('attachmentId');
  if (!sessionId || !attachmentId) return new Response('Missing session or attachment', { status: 400 });
  let snapshot;
  try { snapshot = await ctx.sessionQuery.readSession(sessionId); }
  catch { return new Response('Session unavailable', { status: 404 }); }
  const voice = findVoiceAttachment(snapshot.events, attachmentId);
  if (!voice) return new Response('Audio not referenced by this session', { status: 404 });
  const iterator = ctx.attachments.readFileStream(voice.file, request.signal)[Symbol.asyncIterator]();
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const item = await iterator.next();
        if (item.done) controller.close();
        else controller.enqueue(item.value);
      } catch (error) { controller.error(error); }
    },
    async cancel() { await iterator.return?.(); },
  });
  return new Response(body, { headers: {
    'content-type': voice.meta.mediaType,
    'content-length': String(voice.file.bytes),
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
  } });
}

export function apply(ctx) {
  // Connection exact routes apply Host/Origin checks and owner authentication first.
  ctx.effect(() => ctx.connection.fetch.register({
    path: `/${AUDIO_PATH}`, methods: ['GET'], requestBody: 'buffered',
    fetch: request => audioResponse(ctx, request),
  }));
}
