import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioDirector} from '../src/audio-director.mjs';
import {compareSnapshots, snapshotVisibility} from '../src/render-watch.mjs';
import {auditRoads} from '../src/road-guard.mjs';

function player() {
 const items=[];
 return {
  items,
  async load(x) {return x;},
  start(clip,options) {
   let fire;
   const ended=new Promise(resolve=>{fire=resolve});
   const h={clip,options,stopped:false,volume:options.volume,ended,
    stop() {this.stopped=true;fire();},setVolume(n){this.volume=n},finish(){fire()}};
   items.push(h);return h;
  }
 };
}
test('voice that ends naturally restores the soundtrack without manual stop',async()=>{
 const io=player();const dir=new AudioDirector(io,{musicVolume:.8});
 await dir.changeMusic('bg');const voice=await dir.playVoice('hello');
 assert.equal(io.items[0].volume,.8*.35);
 io.items[1].finish();await Promise.resolve();await Promise.resolve();
 assert.equal(io.items[0].volume,.8);
});
test('played one-shot SFX is removed on natural end, avoiding 96-round accumulation',async()=>{
 const io=player();const dir=new AudioDirector(io);
 for(let i=0;i<60;i++){await dir.playSceneSfx('step');io.items[i].finish();await Promise.resolve();await Promise.resolve();}
 assert.equal(dir.sfx.size,0);
});
test('scene watcher reports a solid mesh that disappears from scene graph',()=>{
 const roof={uuid:'roof',isMesh:true,visible:true,userData:{materialCategory:'solid'},material:{opacity:1,transparent:false},children:[]};
 const scene={visible:true,children:[roof]};const before=snapshotVisibility(scene);
 scene.children=[];const report=compareSnapshots(before,snapshotVisibility(scene));
 assert(report.some(i=>i.code==='SOLID_MESH_REMOVED'&&i.object==='roof'));
});
test('scene watcher tracks solid meshes accidentally scaled to zero',()=>{
 const wall={uuid:'wall',isMesh:true,visible:true,userData:{materialCategory:'solid'},scale:{x:1,y:1,z:1},material:{opacity:1,transparent:false},children:[]};
 const scene={visible:true,children:[wall]};const before=snapshotVisibility(scene);
 wall.scale.x=0;const report=compareSnapshots(before,snapshotVisibility(scene));
 assert(report.some(i=>i.code==='SOLID_ZERO_SCALE'&&i.object==='wall'));
});
test('exact circle edge detects a thin roadside blocker',()=>{
 const ang=Math.PI/20,c=Math.cos(ang),s=Math.sin(ang),offset=.6002;
 const road=[{id:'road',width:1,points:[{x:0,z:0},{x:10*c,z:10*s}]}];
 const obj={id:'pole',circle:{x:5*c-offset*s,z:5*s+offset*c,radius:.1004}};
 assert.equal(auditRoads(road,[obj],{pedestrianRadius:0,safetyMargin:0}).length,1);
});

test('SFX concurrency bound works even with adapters lacking ended events',async()=>{
 const handles=[];
 const io={load:async id=>id,start:(clip,opts)=>{const h={clip,opts,stopped:false,stop(){this.stopped=true},setVolume(){}};handles.push(h);return h;}};
 const dir=new AudioDirector(io,{maxSfx:3});
 for(let i=0;i<31;i++)await dir.playSceneSfx('step'+i);
 assert.equal(dir.sfx.size,3);
 assert.equal(handles.filter(h=>!h.stopped).length,3);
});
test('a new voice cuts the previous dialogue instead of overlapping',async()=>{
 const io=player(),dir=new AudioDirector(io);
 await dir.playVoice('hero');await dir.playVoice('god');
 assert.equal(io.items[0].stopped,true);
 assert.equal(dir.voice.size,1);
});
test('scene resets voice even if end notification is still pending',async()=>{
 const io=player(),dir=new AudioDirector(io,{musicVolume:.6});
 await dir.changeMusic('music');await dir.playVoice('old');
 await dir.changeScene('next');
 io.items[1].finish();await Promise.resolve();await Promise.resolve();
 assert.equal(dir.voice.size,0);
 assert.equal(io.items[0].volume,.6);
});
test('muting and restoring also adjusts already playing effects',async()=>{
 const io=player(),dir=new AudioDirector(io);
 await dir.changeMusic('music');await dir.playSceneSfx('walk');dir.setMuted(true);
 assert(io.items.every(h=>h.volume===0));dir.setMuted(false);
 assert(io.items.every(h=>h.volume>0));
});
test('invalid road coordinate must fail loudly rather than silently PASS',()=>{
 const road=[{id:'oops',width:1,points:[{x:0,z:0},{x:NaN,z:10}]}];
 assert.throws(()=>auditRoads(road,[]),/invalid road/);
});
test('parent transform collapsed to zero makes child mesh vanish and must be reported',()=>{
 const mesh={uuid:'window',isMesh:true,visible:true,userData:{materialCategory:'solid'},material:{opacity:1},children:[]};
 const parent={visible:true,scale:{x:1,y:1,z:1},children:[mesh]};
 const scene={visible:true,children:[parent]};const before=snapshotVisibility(scene);
 parent.scale.y=0;
 assert(compareSnapshots(before,snapshotVisibility(scene)).some(x=>x.code==='SOLID_ZERO_SCALE'&&x.object==='window'));
});
