import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const bundle=await build({entryPoints:['test/browser-fixture.js'],bundle:true,write:false,platform:'browser',format:'iife',target:'es2022'});
const fixture=bundle.outputFiles[0].text;
async function boot(browser){
 const page=await browser.newPage({viewport:{width:390,height:844}});
 page.setDefaultTimeout(7000); page.on('pageerror', e=>console.log('BROWSER_ERROR',e.message));
 await page.route('https://voice.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><div id="messages"></div><div id="input" style="position:absolute;bottom:10px;right:20px"></div></body></html>'}));
 await page.goto('https://voice.test/');
 await page.addScriptTag({content:fixture});
 await page.getByRole('button',{name:'语音消息',exact:true}).click();
 return page;
}
async function record(page){
 await page.getByRole('button',{name:'开始录音',exact:true}).click();
 await page.getByText(/正在录音/).waitFor();
 await page.waitForFunction(()=>voiceTest.contexts.at(-1)?.currentTime >= 1, null, {timeout:15000});
 await page.getByRole('button',{name:'停止录音',exact:true}).click();
}
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 test(`${name}: recording preserves compressed original, ASR receives canonical WAV, send is explicit, player decodes`,async()=>{
  const browser=await engine.launch({headless:true});
  try{
   const page=await boot(browser);const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await record(page);await page.getByRole('button',{name:'发送语音',exact:true}).waitFor();
   const before=await page.evaluate(()=>({sends:voiceTest.sends.length,tracks:voiceTest.tracks.map(t=>t.readyState),wave:[...voiceTest.processed[0].slice(0,44)],hasSignal:voiceTest.processed[0].subarray(44).some(b=>b!==0)}));
   assert.equal(before.sends,0);assert.deepEqual(before.tracks,['ended']);assert.equal(before.hasSignal,true);
   const view=new DataView(Uint8Array.from(before.wave).buffer);
   assert.equal(view.getUint32(24,true),16000);assert.equal(view.getUint16(22,true),1);assert.equal(view.getUint16(34,true),16);
   await page.getByRole('button',{name:'发送语音',exact:true}).click();
   await page.getByRole('region',{name:'语音消息',exact:true}).waitFor();
   const result=await page.evaluate(()=>({requests:voiceTest.sends.length,parts:voiceTest.sends[0].content.map(b=>b.type),mime:voiceTest.uploads[0].blobType,original:[...voiceTest.uploads[0].data.slice(0,12)],wave:[...voiceTest.processed[0].slice(0,12)]}));
   assert.equal(result.requests,1);assert.deepEqual(result.parts,['text','file']);assert.match(result.mime,/^audio\//);assert.notDeepEqual(result.original,result.wave);
   await page.getByRole('button',{name:'播放原音',exact:true}).click();
   const slider=page.getByRole('slider',{name:'语音播放进度'});
   await page.waitForFunction(()=>Number(document.querySelector('.dsh-voice-card input[type=range]')?.value)>.05,null,{timeout:10000});
   assert.ok(await slider.getAttribute('max').then(Number).then(n=>Number.isFinite(n)&&n>0));
   await page.getByRole('button',{name:'暂停原音',exact:true}).click();
   await slider.focus();await slider.press('Home');await slider.press('ArrowRight');
   assert.ok(Math.abs(Number(await slider.inputValue())-.1)<.06);
   assert.deepEqual(errors,[]);await page.close();
  }finally{await browser.close();}
 });
 test(`${name}: ASR failure retains audio, cancellation stops late grants, session switch never sends`,async()=>{
  const browser=await engine.launch({headless:true});
  try{
   const page=await boot(browser);
   await page.evaluate(()=>voiceTest.mode='asr-error');await record(page);
   await page.getByRole('button',{name:'仅发送原音',exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>voiceTest.sends.length),0);
   await page.getByRole('button',{name:'仅发送原音',exact:true}).click();
   await page.getByRole('region',{name:'语音消息',exact:true}).waitFor();
   assert.match(await page.evaluate(()=>voiceTest.sends[0].content[0].text),/转写失败/);
   await page.getByRole('button',{name:'语音消息',exact:true}).click();
   await page.evaluate(()=>voiceTest.mode='late');await page.getByRole('button',{name:'开始录音',exact:true}).click();
   await page.getByText('等待麦克风权限…').waitFor();await page.waitForTimeout(100);
   await page.getByRole('button',{name:'取消',exact:true}).click();await page.evaluate(()=>voiceTest.resolvePermission());
   await page.waitForFunction(()=>voiceTest.tracks.every(t=>t.readyState==='ended'));
   await page.getByRole('button',{name:'语音消息',exact:true}).click();await page.evaluate(()=>voiceTest.mode='ok');
   await page.getByRole('button',{name:'开始录音',exact:true}).click();await page.getByText(/正在录音/).waitFor();
   await page.evaluate(()=>voiceTest.switchSession());await page.waitForFunction(()=>voiceTest.tracks.every(t=>t.readyState==='ended'));
   assert.equal(await page.evaluate(()=>voiceTest.sends.length),1);await page.close();
  }finally{await browser.close();}
 });
 test(`${name}: permission refusal is visible, ordinary content delegates, mobile panel fits`,async()=>{
  const browser=await engine.launch({headless:true});
  try{
   const page=await boot(browser);await page.evaluate(()=>voiceTest.mode='denied');
   await page.getByRole('button',{name:'开始录音',exact:true}).click();;await page.getByText(/麦克风权限被拒绝/).waitFor();
   const box=await page.getByRole('region',{name:'录制语音消息'}).boundingBox();assert.ok(box.x>=0&&box.x+box.width<=390);
   await page.evaluate(()=>voiceTest.show([{type:'text',text:'ordinary message'}]));await page.getByText('ordinary message',{exact:true}).waitFor();
   assert.equal(await page.locator('.dsh-voice-card').count(),0);assert.equal(await page.evaluate(()=>voiceTest.sends.length),0);await page.close();
  }finally{await browser.close();}
 });
}
test('late transcription cannot revive a cancelled draft; retries retain the same native request identity',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await boot(browser);
  await page.evaluate(()=>voiceTest.mode='late-asr');await record(page);
  await page.waitForFunction(()=>!!voiceTest.resolveAsr);await page.getByRole('button',{name:'取消',exact:true}).click();
  await page.evaluate(()=>voiceTest.resolveAsr());await page.waitForTimeout(100);
  assert.equal(await page.getByRole('region',{name:'录制语音消息'}).count(),0);assert.equal(await page.evaluate(()=>voiceTest.sends.length),0);
  await page.getByRole('button',{name:'语音消息',exact:true}).click();await page.evaluate(()=>voiceTest.mode='ok');await record(page);
  await page.getByRole('button',{name:'发送语音',exact:true}).waitFor();await page.evaluate(()=>voiceTest.mode='send-error');
  await page.getByRole('button',{name:'发送语音',exact:true}).click();await page.getByText(/发送未确认/).waitFor();
  await page.getByRole('button',{name:'发送语音',exact:true}).click();await page.getByRole('region',{name:'语音消息',exact:true}).waitFor();
  const ids=await page.evaluate(()=>voiceTest.sends.map(r=>r.requestId));assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);await page.close();
 }finally{await browser.close();}
});
