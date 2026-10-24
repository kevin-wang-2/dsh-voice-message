import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildVoiceText } from '../lib/contract.js';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const bundle=await build({entryPoints:['test/browser-fixture.js'],bundle:true,write:false,platform:'browser',format:'iife',target:'es2022'});
const fixture=bundle.outputFiles[0].text;
const theme=await readFile(new URL('./theme.css',import.meta.url),'utf8');
const browserErrors=new WeakMap();
async function checkedClose(page){
 assert.deepEqual(browserErrors.get(page),[]);
 await page.close();
}
async function boot(browser,options={}){
 const page=await browser.newPage({viewport:{width:390,height:844},...options});
 const errors=[];browserErrors.set(page,errors);
 page.setDefaultTimeout(7000); page.on('pageerror', e=>errors.push(e.message));
 await page.route('https://voice.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="messages"></div><div id="input" style="position:absolute;bottom:10px;right:20px"></div></body></html>'}));
 await page.goto('https://voice.test/');
 await page.addStyleTag({content:theme});
 await page.addScriptTag({content:fixture});
 const capabilities=await page.evaluate(()=>({recorder:typeof MediaRecorder,audioContext:typeof AudioContext}));
 assert.equal(capabilities.recorder,'function','This recording test requires a browser build with MediaRecorder');
 assert.equal(capabilities.audioContext,'function');
 return page;
}
const holdButton=page=>page.getByRole('button',{name:'按住说话，松开发送，上滑取消',exact:true});
async function hold(page){
 const box=await holdButton(page).boundingBox();
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
 await holdButton(page).evaluate(el=>el.addEventListener('pointerdown',event=>voiceTest.pointerId=event.pointerId,{once:true}));
 await page.mouse.down();
 return {x:box.x+box.width/2,y:box.y+box.height/2};
}
async function record(page){
 await hold(page);
 await page.getByText('正在录音',{exact:true}).waitFor();
 await page.waitForFunction(()=>voiceTest.contexts.at(-1)?.currentTime >= 1.3, null, {timeout:15000});
 await page.mouse.up();
}
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 test(`${name}: light and dark themes keep panel, controls and playback card readable`,async()=>{
  const browser=await engine.launch({headless:true});
  try{
   const page=await boot(browser);
   await page.getByRole('button',{name:'语音设置',exact:true}).click();
   const file={attachmentId:'theme-audio',name:'voice-theme-1s.wav',bytes:32044};
   const text=buildVoiceText({file,seconds:1,mediaType:'audio/wav',status:'transcribed',transcript:'主题可读性检查'});
   await page.evaluate(content=>voiceTest.show(content),[{type:'text',text},{type:'file',attachment:file}]);
   for(const dark of [false,true,false]){
    await page.evaluate(dark=>document.body.toggleAttribute('data-ds-dark-theme',dark),dark);
    const colors=await page.evaluate(()=>[...document.querySelectorAll('.dsh-voice-panel,.dsh-voice-card')].map(el=>{
     const style=getComputedStyle(el);
     return{background:style.backgroundColor,color:style.color,scheme:style.colorScheme,controls:[...el.querySelectorAll('button,select,summary')].map(control=>({color:getComputedStyle(control).color,background:getComputedStyle(control).backgroundColor}))};
    }));
    assert.equal(colors.length,2);
    const rgb=value=>value.match(/[\d.]+/g).map(Number);
    const luminance=value=>rgb(value).slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
    for(const color of colors){
     const bg=luminance(color.background);const fg=luminance(color.color);
     assert.ok((Math.max(bg,fg)+.05)/(Math.min(bg,fg)+.05)>=4.5,JSON.stringify(color));
     assert.ok(dark?bg<.1:bg>.8);
     assert.equal(color.scheme,dark?'dark':'light');
     for(const control of color.controls)assert.equal(control.color,color.color);
    }
   }
   await checkedClose(page);
  }finally{await browser.close();}
 });
 test(`${name}: recording preserves compressed original, ASR receives canonical WAV, release sends once, player decodes`,async()=>{
  const browser=await engine.launch({headless:true});
  try{
   const page=await boot(browser);const errors=[];page.on('pageerror',e=>errors.push(e.message));
   assert.equal(await page.getByRole('region',{name:'录制语音消息'}).count(),0);
   await hold(page);await page.getByText('正在录音',{exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'停止录音',exact:true}).count(),0);
   assert.equal(await page.evaluate(()=>voiceTest.sends.length),0);
   await page.waitForFunction(()=>voiceTest.contexts.at(-1)?.currentTime>=1.3);
   await page.mouse.up();
   await page.getByRole('region',{name:'语音消息',exact:true}).waitFor();
   const before=await page.evaluate(()=>({sends:voiceTest.sends.length,tracks:voiceTest.tracks.map(t=>t.readyState),wave:[...voiceTest.processed[0].slice(0,44)],hasSignal:voiceTest.processed[0].subarray(44).some(b=>b!==0)}));
   assert.equal(before.sends,1);assert.deepEqual(before.tracks,['ended']);assert.equal(before.hasSignal,true);
   const view=new DataView(Uint8Array.from(before.wave).buffer);
   assert.equal(view.getUint32(24,true),16000);assert.equal(view.getUint16(22,true),1);assert.equal(view.getUint16(34,true),16);
   const result=await page.evaluate(()=>({requests:voiceTest.sends.length,parts:voiceTest.sends[0].content.map(b=>b.type),mime:voiceTest.uploads[0].blobType,original:[...voiceTest.uploads[0].data.slice(0,12)],wave:[...voiceTest.processed[0].slice(0,12)]}));
   assert.equal(result.requests,1);assert.deepEqual(result.parts,['text','file']);assert.match(result.mime,/^audio\//);assert.notDeepEqual(result.original,result.wave);
   await page.getByRole('button',{name:'播放原音',exact:true}).click();
   const slider=page.getByRole('slider',{name:'语音播放进度'});
   await page.waitForFunction(()=>Number(document.querySelector('.dsh-voice-card input[type=range]')?.value)>.05,null,{timeout:10000});
   assert.ok(await slider.getAttribute('max').then(Number).then(n=>Number.isFinite(n)&&n>0));
   await page.getByRole('button',{name:'暂停原音',exact:true}).click();
   await slider.focus();await slider.press('Home');await slider.press('ArrowRight');
   assert.ok(Math.abs(Number(await slider.inputValue())-.1)<.06);
   assert.deepEqual(errors,[]);await checkedClose(page);
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
   await page.evaluate(()=>voiceTest.mode='late');await hold(page);
   await page.getByText('等待麦克风权限…').waitFor();await page.waitForTimeout(100);
   await page.mouse.up();await page.evaluate(()=>voiceTest.resolvePermission());
   await page.waitForFunction(()=>voiceTest.tracks.every(t=>t.readyState==='ended'));
   await page.evaluate(()=>voiceTest.mode='ok');
   await hold(page);await page.getByText('正在录音',{exact:true}).waitFor();
   await page.evaluate(()=>voiceTest.switchSession());await page.waitForFunction(()=>voiceTest.tracks.every(t=>t.readyState==='ended'));
   assert.equal(await page.evaluate(()=>voiceTest.sends.length),1);await checkedClose(page);
  }finally{await browser.close();}
 });
 test(`${name}: slide cancellation, slide back and short taps never need a recording popup`,async()=>{
  const browser=await engine.launch({headless:true});
  try{
   const page=await boot(browser);
   let point=await hold(page);await page.getByText('正在录音',{exact:true}).waitFor();
   await page.mouse.move(point.x,point.y-90);
   await page.getByRole('region',{name:'录制语音消息'}).getByText('松开取消',{exact:true}).waitFor();
   await page.mouse.up();
   await page.waitForFunction(()=>voiceTest.tracks.every(t=>t.readyState==='ended'));
   assert.deepEqual(await page.evaluate(()=>[voiceTest.sends.length,voiceTest.processed.length]),[0,0]);
   assert.equal(await page.getByRole('region',{name:'录制语音消息'}).count(),0);
   point=await hold(page);await page.getByText('正在录音',{exact:true}).waitFor();
   await page.mouse.move(point.x,point.y-90);await page.mouse.move(point.x,point.y);
   await page.getByRole('region',{name:'录制语音消息'}).getByText('正在录音',{exact:true}).waitFor();
   await page.waitForFunction(()=>voiceTest.contexts.at(-1)?.currentTime>=1.3);
   await page.mouse.up();await page.getByRole('region',{name:'语音消息',exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>voiceTest.sends.length),1);
   await hold(page);await page.getByText('正在录音',{exact:true}).waitFor();await page.mouse.up();
   await page.getByText('说话时间太短，请按住至少 1 秒',{exact:true}).waitFor();
   assert.deepEqual(await page.evaluate(()=>[voiceTest.sends.length,voiceTest.processed.length]),[1,1]);
   assert.ok(await page.evaluate(()=>voiceTest.tracks.every(t=>t.readyState==='ended')));
   await checkedClose(page);
  }finally{await browser.close();}
 });
 test(`${name}: pointer cancellation, capture loss, background and focus interruption discard held audio`,async()=>{
  const browser=await engine.launch({headless:true});
  try{
   const page=await boot(browser);
   for(const interruption of ['pointercancel','lostcapture','hidden','blur']){
    const point=await hold(page);await page.getByText('正在录音',{exact:true}).waitFor();
    await page.mouse.move(point.x+1,point.y);
    await page.evaluate(interruption=>{
     const button=document.querySelector('.dsh-voice-hold');
     if(interruption==='pointercancel')button.dispatchEvent(new PointerEvent('pointercancel',{pointerId:voiceTest.pointerId,bubbles:true}));
     if(interruption==='lostcapture')button.releasePointerCapture(voiceTest.pointerId);
     if(interruption==='hidden'){
      Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));
      delete document.hidden;
     }
     if(interruption==='blur')window.dispatchEvent(new Event('blur'));
    },interruption);
    await page.mouse.move(point.x+2,point.y);
    await page.mouse.up();await page.waitForFunction(()=>voiceTest.tracks.every(t=>t.readyState==='ended'));
    assert.equal(await page.getByRole('region',{name:'录制语音消息'}).count(),0,interruption);
   }
   assert.deepEqual(await page.evaluate(()=>[voiceTest.sends.length,voiceTest.processed.length]),[0,0]);await checkedClose(page);
  }finally{await browser.close();}
 });
 test(`${name}: keyboard hold supports release to send and Escape to cancel`,async()=>{
  const browser=await engine.launch({headless:true});
  try{
   const page=await boot(browser);
   await holdButton(page).focus();await page.keyboard.down('Space');await page.getByText('正在录音',{exact:true}).waitFor();
   await page.waitForFunction(()=>voiceTest.contexts.at(-1)?.currentTime>=1.3);
   await page.keyboard.up('Space');await page.getByRole('region',{name:'语音消息',exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>voiceTest.sends.length),1);
   await holdButton(page).focus();await page.keyboard.down('Enter');await page.getByText('正在录音',{exact:true}).waitFor();
   await page.keyboard.press('Escape');await page.keyboard.up('Enter');
   await page.waitForFunction(()=>voiceTest.tracks.every(t=>t.readyState==='ended'));
   assert.equal(await page.evaluate(()=>voiceTest.sends.length),1);await checkedClose(page);
  }finally{await browser.close();}
 });
 test(`${name}: reaching the duration limit retains audio without sending`,async()=>{
  const browser=await engine.launch({headless:true});
  try{
   const page=await boot(browser);await page.clock.install();
   await hold(page);await page.getByText('正在录音',{exact:true}).waitFor();
   await page.waitForFunction(()=>voiceTest.contexts.at(-1)?.currentTime>=1.3);
   await page.clock.runFor(120000);
   await page.getByRole('button',{name:'发送语音',exact:true}).waitFor();
   await page.mouse.up();
   assert.equal(await page.evaluate(()=>voiceTest.sends.length),0);
   assert.ok(await page.evaluate(()=>voiceTest.tracks.every(t=>t.readyState==='ended')));
   await page.getByText('已达到 120 秒上限，录音已保留',{exact:true}).waitFor();await checkedClose(page);
  }finally{await browser.close();}
 });
 test(`${name}: permission refusal is visible, ordinary content delegates, mobile panel fits`,async()=>{
  const browser=await engine.launch({headless:true});
  try{
   const page=await boot(browser);await page.evaluate(()=>voiceTest.mode='denied');
   await hold(page);await page.getByText(/麦克风权限被拒绝/).waitFor();await page.mouse.up();
   const box=await page.getByRole('region',{name:'录制语音消息'}).boundingBox();assert.ok(box.x>=0&&box.x+box.width<=390);
   await page.evaluate(()=>{const anchor=document.getElementById('input');anchor.style.right='auto';anchor.style.left='12px';window.dispatchEvent(new Event('resize'));});
   await page.waitForFunction(()=>{const rect=document.querySelector('.dsh-voice-panel').getBoundingClientRect();return rect.left>=15.5&&rect.right<=374.5;});
   await page.evaluate(()=>{document.getElementById('input').style.bottom='auto';document.getElementById('input').style.top='24px';window.dispatchEvent(new Event('resize'));});
   await page.waitForFunction(()=>{const rect=document.querySelector('.dsh-voice-panel').getBoundingClientRect();return rect.top>=24&&rect.bottom<=innerHeight-16;});
   await page.evaluate(()=>voiceTest.show([{type:'text',text:'ordinary message'}]));await page.getByText('ordinary message',{exact:true}).waitFor();
   assert.equal(await page.locator('.dsh-voice-card').count(),0);assert.equal(await page.evaluate(()=>voiceTest.sends.length),0);await checkedClose(page);
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
  await page.evaluate(()=>voiceTest.mode='send-error');await record(page);await page.getByText(/发送未确认/).waitFor();
  await page.getByRole('button',{name:'发送语音',exact:true}).click();await page.getByRole('region',{name:'语音消息',exact:true}).waitFor();
  const ids=await page.evaluate(()=>voiceTest.sends.map(r=>r.requestId));assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);await checkedClose(page);
 }finally{await browser.close();}
});

test('Chromium: native mobile touch holds, slides to cancel and releases to send without scrolling',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await boot(browser,{hasTouch:true,isMobile:true});
  const session=await page.context().newCDPSession(page);
  const box=await holdButton(page).boundingBox();const point={x:box.x+box.width/2,y:box.y+box.height/2};
  const touch=(type,point)=>session.send('Input.dispatchTouchEvent',{type,touchPoints:point?[{...point,id:0}]:[]});
  await touch('touchStart',point);await page.getByText('正在录音',{exact:true}).waitFor();
  await touch('touchMove',{x:point.x,y:point.y-90});
  await page.getByRole('region',{name:'录制语音消息'}).getByText('松开取消',{exact:true}).waitFor();
  await touch('touchEnd');
  await page.waitForFunction(()=>voiceTest.tracks.every(t=>t.readyState==='ended'));
  assert.deepEqual(await page.evaluate(()=>[voiceTest.sends.length,voiceTest.processed.length,scrollY]),[0,0,0]);
  await touch('touchStart',point);await page.getByText('正在录音',{exact:true}).waitFor();
  await page.waitForFunction(()=>voiceTest.contexts.at(-1)?.currentTime>=1.3);
  await touch('touchEnd');await page.getByRole('region',{name:'语音消息',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>voiceTest.sends.length),1);await checkedClose(page);
 }finally{await browser.close();}
});
