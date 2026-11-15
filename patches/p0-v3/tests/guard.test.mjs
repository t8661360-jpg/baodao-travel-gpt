import test from 'node:test';import assert from 'node:assert/strict';
import {auditRoads,placeSafely,testEveryVariation} from '../src/road-guard.mjs';
import {scanMaterials,snapshotVisibility,compareSnapshots} from '../src/render-watch.mjs';
import {AudioDirector} from '../src/audio-director.mjs';
const r=[{id:'R10',width:1.8,points:[{x:0,z:0},{x:5,z:0},{x:5,z:5}]}];
const tree={id:'T1',decorativeOnly:true,category:'tree',circle:{x:3,z:0.2,radius:0.25}};
const kiosk={id:'K1',rect:{x:5,z:4,width:.6,depth:.6}};
test('decorative tree physically blocks path and must NOT be ignored',()=>assert.equal(auditRoads(r,[tree]).length,1));
test('road curve and kiosk block detected',()=>assert.equal(auditRoads(r,[kiosk]).length,1));
test('ground-painted decals ignored',()=>assert.equal(auditRoads(r,[{id:'paint',isGroundDecal:true}]).length,0));
test('VFX ignored as nonphysical',()=>assert.equal(auditRoads(r,[{id:'fog',isVfx:true}]).length,0));
test('safely place flowerpot outside path',()=>assert.equal(placeSafely(r,[],{id:'p',circle:{x:0,z:4,radius:.1}}).placed,true));
test('reject unsafe popup stall placement',()=>assert.equal(placeSafely(r,[],kiosk).placed,false));
test('pedestrian radius expands clearance requirement',()=>{const o={id:'near',circle:{x:2,z:1.5,radius:.1}};assert.equal(auditRoads(r,[o],{pedestrianRadius:0.05,safetyMargin:0}).length,0);assert.equal(auditRoads(r,[o],{pedestrianRadius:.6,safetyMargin:.15}).length,1);});
test('full variations reveal seasonal blocking decoration',()=>assert.equal(testEveryVariation(r,[],[{id:'spring',objects:[]},{id:'winter',objects:[tree]}]).length,1));
test('physical objects missing geometry error loudly',()=>assert.throws(()=>auditRoads(r,[{id:'unmapped-tree',decorativeOnly:true}]),/no valid footprint/));
function sceneWith(meshes){return {visible:true,children:meshes};}
function mesh(name,mat,cat){return {name,uuid:name,isMesh:true,visible:true,children:[],material:mat,userData:{materialCategory:cat||'solid'}};}
const opaque=()=>({transparent:false,opacity:1,depthTest:true,depthWrite:true});
test('solid opaque materials pass',()=>assert.equal(scanMaterials(sceneWith([mesh('house',opaque())])).length,0));
test('opaque mesh with accidental alpha fails',()=>assert(scanMaterials(sceneWith([mesh('shop',{...opaque(),transparent:true,opacity:.3})])).some(x=>x.code==='OPAQUE_OPACITY_CHANGED')));
test('shared mutated materials identified',()=>{let m={...opaque(),opacity:.2};const report=scanMaterials(sceneWith([mesh('a',m),mesh('b',m)]));assert(report.some(x=>x.code==='SHARED_MATERIAL_WAS_MUTATED'));});
test('glass legitimately transparent',()=>assert.equal(scanMaterials(sceneWith([mesh('glass',{...opaque(),transparent:true,opacity:.4,depthWrite:false},'window-glass')])).length,0));
test('hidden parent reveals whole-building removal',()=>{const m=mesh('roof',opaque());const group={visible:false,children:[m]};assert(scanMaterials(sceneWith([group])).some(x=>x.code==='PARENT_HIDDEN'));});
test('pre/post camera snapshot catches solid vanished',()=>{const m=mesh('wall',opaque());const s=sceneWith([m]);const b=snapshotVisibility(s);m.visible=false;const a=snapshotVisibility(s);assert(compareSnapshots(b,a).some(x=>x.code==='SOLID_DISAPPEARED'));});
test('pre/post snapshot catches shared shader color/opacity changes',()=>{const m=mesh('windowframe',opaque());const s=sceneWith([m]);const b=snapshotVisibility(s);m.material.opacity=.1;assert(compareSnapshots(b,snapshotVisibility(s)).some(x=>x.code==='SOLID_MATERIAL_CHANGED'));});
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function fakeAudio(){const active=[];const loadRequests=[];return {active,loadRequests, load(id){const d=deferred();loadRequests.push({id,...d});return d.promise;}, start(clip,options){const h={clip,options,stopped:false,volume:options.volume,stop(){this.stopped=true},setVolume(n){this.volume=n}};active.push(h);return h;}};}
test('stale music must not play after rapid switches',async()=>{const io=fakeAudio();const a=new AudioDirector(io);const one=a.changeMusic('old');const two=a.changeMusic('new');io.loadRequests[1].resolve('new-clip');assert.equal((await two).status,'playing');io.loadRequests[0].resolve('old-clip');assert.equal((await one).status,'stale');assert.equal(io.active.length,1);});
test('old playing music stops before new begins',async()=>{const io=fakeAudio();const a=new AudioDirector(io);const p=a.changeMusic('a');io.loadRequests[0].resolve('a');await p;const old=io.active[0];const q=a.changeMusic('b');assert.equal(old.stopped,true);io.loadRequests[1].resolve('b');await q;assert.equal(io.active.filter(h=>!h.stopped).length,1);});
test('old boat ambience cannot start after changing to shop',async()=>{const io=fakeAudio();const a=new AudioDirector(io);const p=a.changeScene('boat','waves');const q=a.changeScene('shop','shop-loop');io.loadRequests[1].resolve('shop-loop');await q;io.loadRequests[0].resolve('waves');assert.equal((await p).status,'stale');assert.equal(io.active.filter(h=>!h.stopped).length,1);});
test('stale delayed SFX never starts in next scene',async()=>{const io=fakeAudio();const a=new AudioDirector(io);await a.changeScene('boat');const p=a.playSceneSfx('horn');await a.changeScene('hotel');io.loadRequests[0].resolve('horn');assert.equal((await p).status,'stale');assert.equal(io.active.length,0);});
test('voices lower current music and restore volume after stop',async()=>{const io=fakeAudio();const a=new AudioDirector(io,{musicVolume:.5});const music=a.changeMusic('theme');io.loadRequests[0].resolve('theme');await music;const p=a.playVoice('guide');io.loadRequests[1].resolve('guide');const res=await p;assert.equal(io.active[0].volume,.5*.35);res.stop();assert.equal(io.active[0].volume,.5);});
test('clear silences and cancels all active audio',async()=>{const io=fakeAudio();const a=new AudioDirector(io);const p=a.changeMusic('bgm');io.loadRequests[0].resolve('bgm');await p;a.clear();assert.equal(io.active[0].stopped,true);assert.equal(a.musicId,null);});

test('scene switch stops active narration and restores background volume',async()=>{const io=fakeAudio();const a=new AudioDirector(io,{musicVolume:.5});let m=a.changeMusic('theme');io.loadRequests[0].resolve('theme');await m;let voice=a.playVoice('old-talk');io.loadRequests[1].resolve('old-talk');await voice;assert.equal(io.active[0].volume,.175);await a.changeScene('next');assert.equal(io.active[1].stopped,true);assert.equal(io.active[0].volume,.5);});
