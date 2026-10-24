import React from 'react';
import { createRoot } from 'react-dom/client';
import { apply } from '../src/client.js';
import { encodeWave } from '../src/recording.js';

// Keep native decoding/playback clocks, but silence only the test speaker sink.
// Microphone MediaStreamDestination stays unmuted so recording tests retain signal.
const NativeAudioContext = globalThis.AudioContext;
globalThis.AudioContext = class SilentTestAudioContext extends NativeAudioContext {
 get destination() {
  if (!this.silentOutput) {
   this.silentOutput = this.createGain();
   this.silentOutput.gain.value = 0;
   this.silentOutput.connect(super.destination);
  }
  return this.silentOutput;
 }
};

const h=React.createElement;
const inputRoot=createRoot(document.getElementById('input'));
const messageRoot=createRoot(document.getElementById('messages'));
const state=window.voiceTest={sends:[],uploads:[],processed:[],phase:'ready',text:'识别正文',mode:'ok',tracks:[],contexts:[],entries:[], sessionId:'session-one'};
const bodies=new Map();let serial=0;let inputView;let nodeView;
const original=(props)=>props.renderFactorySlot('conversation.chat.user.content',{content:{text:props.node.data.content.filter(b=>b.type==='text').map(b=>b.text).join('\n'),attachments:props.node.data.content.filter(b=>b.type==='file').map(b=>({type:'file',file:b.attachment})),extraBlocks:[]}});
const shipped={component:original,locale:'chat',options:{key:'user',priority:0}};
const refresh=()=>{if(inputView)inputRoot.render(h(inputView,{key:state.sessionId,sessionId:state.sessionId,locked:false}));};
state.switchSession=()=>{state.sessionId='session-two';refresh();};
state.show=(content)=>messageRoot.render(h(nodeView??original,{node:{data:{content}},sessionId:state.sessionId,renderFactorySlot:(_name,input)=>h('div',{'data-default-content':true},input.content.text)}));
state.originalWave=()=>encodeWave(new Float32Array(16000).fill(.02));
let pendingPermission;
const getUserMedia=async()=>{
 if(state.mode==='denied')throw new DOMException('权限被拒绝','NotAllowedError');
 const context=new AudioContext();state.contexts.push(context);await context.resume();const source=context.createOscillator();const dest=context.createMediaStreamDestination();source.frequency.value=440;source.connect(dest);source.start();
 const track=dest.stream.getAudioTracks()[0];const stop=track.stop.bind(track);let stopped=false;track.stop=()=>{if(stopped)return;stopped=true;stop();source.stop();void context.close();};state.tracks.push(track);
 if(state.mode==='late')await new Promise(resolve=>pendingPermission=resolve);
 return dest.stream;
};
Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia,enumerateDevices:async()=>[{kind:'audioinput',deviceId:'default',label:'System microphone'},{kind:'audioinput',deviceId:'fixture-mic',label:'Test microphone'}]}});
state.resolvePermission=()=>pendingPermission();
const ctx={
 effect:fn=>{const dispose=fn();return dispose;},
 slots:{
  inject:(_name,fn)=>fn(),
  entriesOfSlot:()=>[shipped],subscribe:()=>()=>{},
  register(options,Component){
   if(options.name==='conversation.input.right'){inputView=Component;refresh();}
   else {nodeView=Component;state.entries.push(options);}
   return ()=>{nodeView=null;};
  },
 },
 connection:{rpc:{async call(_channel,endpoint,payload){
  if(endpoint==='speech/catalog')return {ok:true,value:{maxAudioBytes:4194304,maxDurationSeconds:120,selection:{providerId:'local',language:'auto'},providers:[{id:'local',location:'host-local',preparation:{phase:state.phase}}]}};
  if(endpoint==='speech/transcribe'){
   const bytes=Uint8Array.from(atob(payload.args.request.audioBase64),c=>c.charCodeAt(0));state.processed.push(bytes);
   if(state.mode==='late-asr')await new Promise(resolve=>state.resolveAsr=resolve);
   if(state.mode==='asr-error')return {ok:false,error:{message:'test ASR failed',code:'speech/transcription-failed'}};
   return {ok:true,value:{text:state.text,audioSeconds:1,inferenceSeconds:.01}};
  }
  return {ok:true,value:undefined};
 }}},
 fileUpload:{async upload(sessionId,blob,name){
  const data=new Uint8Array(await blob.arrayBuffer());const file={attachmentId:`audio-${++serial}`,name,bytes:data.length};const receiptId=`receipt-${serial}`;bodies.set(file.attachmentId,new Blob([data],{type:blob.type}));state.uploads.push({sessionId,data,file,blobType:blob.type,receiptId});return {ok:true,value:{file,receiptId}};
 }},
 remote:{session:{async prompt(request){
  state.sends.push(request);if(state.mode==='send-error'){state.mode='ok';return {ok:false,error:{message:'test acknowledgement lost',code:'gateway/internal'}};}const upload=state.uploads.find(u=>u.receiptId===request.content[1].receiptId);state.show([{type:'text',text:request.content[0].text},{type:'file',attachment:upload.file}]);return {ok:true,value:{accepted:true}};
 }}},
};
const nativeFetch=fetch;
window.fetch=async(url,options)=>{
 if(String(url).startsWith('api/voice-message/audio')){const id=new URL(String(url),location.href).searchParams.get('attachmentId');return new Response(bodies.get(id),{headers:{'content-type':bodies.get(id).type}});}
 return nativeFetch(url,options);
};
apply(ctx);
