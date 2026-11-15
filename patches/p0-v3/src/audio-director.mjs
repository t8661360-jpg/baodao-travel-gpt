/**
 * 寶島逗陣行 audio controller (portable integration candidate, NOT deployed).
 * adapter.load(id) -> Promise<clip>
 * adapter.start(clip, {kind,volume,loop}) -> handle { stop(),setVolume(v),
 *    ended?: Promise<void>, onEnded?: (cb)=>unsubscribe, addEventListener? }
 * Prefer an 'ended' callback or promise on EVERY one-shot handle; without it the
 * pool cap and scene reset prevent unbounded accumulation, but natural-end cleanup
 * is not instantaneous.
 */
export class AudioDirector {
 constructor(adapter,{musicVolume=0.5,ambienceVolume=0.25,sfxVolume=0.55,voiceVolume=0.85,maxSfx=12}={}){
  if(!adapter||typeof adapter.load!=='function'||typeof adapter.start!=='function')throw new Error('audio adapter requires load/start');
  this.adapter=adapter;
  this.vol={music:musicVolume,ambience:ambienceVolume,sfx:sfxVolume,voice:voiceVolume};
  this.music=null;this.ambience=null;this.sfx=new Set;this.voice=new Set;
  this.musicEpoch=0;this.sceneEpoch=0;this.voiceEpoch=0;
  this.musicId=null;this.sceneId=null;this.muted=false;
  this.maxSfx=Math.max(1,Math.trunc(maxSfx));
  this.cleanups=new WeakMap();
 }
 _stop(h){try{h?.stop?.()}catch{}}
 _volume(kind){return this.muted?0:this.vol[kind]*(kind==='music'&&this.voice.size?0.35:1);}
 _retune(){
  this.music?.setVolume?.(this._volume('music'));
  this.ambience?.setVolume?.(this._volume('ambience'));
  for(const h of this.sfx)h?.setVolume?.(this._volume('sfx'));
  for(const h of this.voice)h?.setVolume?.(this._volume('voice'));
 }
 setMuted(yes){this.muted=!!yes;this._retune();}
 setVolume(kind,value){
  if(!(kind in this.vol))throw new Error('unknown audio kind: '+kind);
  if(!Number.isFinite(value))throw new Error('invalid volume');
  this.vol[kind]=Math.max(0,Math.min(1,value));this._retune();
 }
 _untrack(h){
  let wasVoice=this.voice.delete(h);this.sfx.delete(h);
  const unsub=this.cleanups.get(h);
  this.cleanups.delete(h);
  if(typeof unsub==='function'){try{unsub()}catch{}}
  if(wasVoice)this._retune();
 }
 _halt(h){this._untrack(h);this._stop(h);}
 _haltPool(pool){for(const h of [...pool])this._halt(h);pool.clear();}
 _trackOneShot(h,kind){
  const pool=kind==='voice'?this.voice:this.sfx;
  if(!h||typeof h.stop!=='function')throw new Error('audio adapter start must return stop handle');
  pool.add(h);
  const release=()=>this._untrack(h);
  try{
   if(typeof h.onEnded==='function'){
    const unsubscribe=h.onEnded(release);
    if(typeof unsubscribe==='function')this.cleanups.set(h,unsubscribe);
   } else if(h.ended&&typeof h.ended.then==='function'){
    Promise.resolve(h.ended).then(release,release);
   } else if(typeof h.addEventListener==='function'){
    h.addEventListener('ended',release,{once:true});
    this.cleanups.set(h,()=>h.removeEventListener?.('ended',release));
   }
  }catch{ // If a custom ended observer fails, the bounded pool still protects the game.
  }
  if(kind==='voice')this._retune();
  return {status:'playing',stop:()=>this._halt(h)};
 }
 async changeMusic(id){
  if(id===this.musicId&&this.music)return {status:'unchanged'};
  const epoch=++this.musicEpoch;
  this._stop(this.music);this.music=null;this.musicId=id;
  if(!id)return {status:'stopped'};
  try{
   const clip=await this.adapter.load(id);
   if(epoch!==this.musicEpoch)return {status:'stale'};
   this.music=this.adapter.start(clip,{kind:'music',volume:this._volume('music'),loop:true});
   return {status:'playing',id};
  }catch(error){return epoch!==this.musicEpoch?{status:'stale'}:{status:'error',error:String(error)};}
 }
 async changeScene(sceneId,ambienceId=null){
  const epoch=++this.sceneEpoch;
  ++this.voiceEpoch;
  this.sceneId=sceneId;
  this._stop(this.ambience);this.ambience=null;
  this._haltPool(this.sfx);this._haltPool(this.voice);this._retune();
  if(!ambienceId)return {status:'silent'};
  try{
   const clip=await this.adapter.load(ambienceId);
   if(epoch!==this.sceneEpoch)return {status:'stale'};
   this.ambience=this.adapter.start(clip,{kind:'ambience',volume:this._volume('ambience'),loop:true});
   return {status:'playing',sceneId};
  }catch(error){return epoch!==this.sceneEpoch?{status:'stale'}:{status:'error',error:String(error)};}
 }
 async playSceneSfx(id){
  const epoch=this.sceneEpoch;
  try{
   const clip=await this.adapter.load(id);
   if(epoch!==this.sceneEpoch)return {status:'stale'};
   // Cap active effects even if a browser/adapter never reports 'ended'.
   while(this.sfx.size>=this.maxSfx)this._halt(this.sfx.values().next().value);
   const h=this.adapter.start(clip,{kind:'sfx',volume:this._volume('sfx'),loop:false});
   return this._trackOneShot(h,'sfx');
  }catch(error){return epoch!==this.sceneEpoch?{status:'stale'}:{status:'error',error:String(error)};}
 }
 async playVoice(id){
  const epoch=this.sceneEpoch, request=++this.voiceEpoch;
  try{
   const clip=await this.adapter.load(id);
   if(epoch!==this.sceneEpoch||request!==this.voiceEpoch)return {status:'stale'};
   // A new line replaces an older line; two characters won't speak at once.
   this._haltPool(this.voice);
   const h=this.adapter.start(clip,{kind:'voice',volume:this._volume('voice'),loop:false});
   return this._trackOneShot(h,'voice');
  }catch(error){return epoch!==this.sceneEpoch||request!==this.voiceEpoch?{status:'stale'}:{status:'error',error:String(error)};}
 }
 clear(){
  ++this.sceneEpoch;++this.musicEpoch;++this.voiceEpoch;
  this._stop(this.music);this._stop(this.ambience);
  this.music=this.ambience=null;
  this._haltPool(this.sfx);this._haltPool(this.voice);
  this.musicId=this.sceneId=null;
 }
}
