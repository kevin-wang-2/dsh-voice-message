import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioResponse } from '../lib/index.js';
import { buildVoiceText } from '../lib/contract.js';
const file={attachmentId:'audio-id',name:'voice-20261024T120000Z-1s.wav',bytes:3};
const text=buildVoiceText({file,seconds:1,mediaType:'audio/wav',status:'empty'});
const events=[{type:'user/message',data:{content:[{type:'text',text},{type:'file',attachment:file}]}}];
const request=(sessionId='own',attachmentId=file.attachmentId)=>new Request(`http://localhost/api/voice-message/audio?${new URLSearchParams({sessionId,attachmentId})}`);

test('only a voice attachment referenced by the selected session can be read',async()=>{
 let reads=0;
 const ctx={sessionQuery:{readSession:async id=>({events:id==='own'?events:[]})},attachments:{async *readFileStream(){reads++;yield new Uint8Array([1,2,3]);}}};
 for(const req of [request('other'),request('own','unknown')])assert.equal((await audioResponse(ctx,req)).status,404);
 assert.equal(reads,0);
 const response=await audioResponse(ctx,request());
 assert.equal(response.status,200);
 assert.equal(response.headers.get('content-type'),'audio/wav');
 assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[1,2,3]);
 assert.equal(reads,1);
});
test('marker text without matching durable file ref never grants access',async()=>{
 const ctx={sessionQuery:{readSession:async()=>({events:[{type:'user/message',data:{content:[{type:'text',text}]}}]})},attachments:{readFileStream(){assert.fail('must not read');}}};
 assert.equal((await audioResponse(ctx,request())).status,404);
});
test('storage verification failures reject the body rather than returning partial audio as success',async()=>{
 const ctx={sessionQuery:{readSession:async()=>({events})},attachments:{async *readFileStream(){yield new Uint8Array([1]);throw Error('integrity failure');}}};
 const response=await audioResponse(ctx,request());
 await assert.rejects(response.arrayBuffer(),/integrity failure/);
});
