/**
 * Read-only scene graph inspection. Never auto-disable frustum culling, hide a
 * building, or mutate materials without verifying intent in the actual game.
 * Assumes Three.js-like Object3D objects (children, visible, scale, material).
 */
const translucent=new Set(['window-glass','water','fog','particle','vfx','ui-overlay']);
const props=['visible','transparent','opacity','depthTest','depthWrite','colorWrite','alphaTest','side','blending'];
function categoryOf(mesh){
 const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
 return mesh.userData?.materialCategory||materials.find(m=>m?.userData?.materialCategory)?.userData.materialCategory||'solid';
}
function ownScale(obj){const s=obj.scale;return {x:Number.isFinite(s?.x)?s.x:1,y:Number.isFinite(s?.y)?s.y:1,z:Number.isFinite(s?.z)?s.z:1};}
function walk(root,fn,hidden=false,scale={x:1,y:1,z:1},path='root'){
 if(!root)return;
 const effectivelyHidden=hidden||root.visible===false;
 const nextScale=ownScale(root);
 const worldScale={x:scale.x*nextScale.x,y:scale.y*nextScale.y,z:scale.z*nextScale.z};
 fn(root,effectivelyHidden,hidden,worldScale,path);
 for(const [i,child] of (root.children||[]).entries())walk(child,fn,effectivelyHidden,worldScale,path+'/'+(child.name||i));
}
function isZeroScale(scale){return [scale.x,scale.y,scale.z].some(v=>Math.abs(v)<1e-7);}
export function scanMaterials(root){
 const issues=[],shared=new Map();
 walk(root,(mesh,hidden,parentHidden,worldScale,path)=>{
  if(!mesh.isMesh)return;
  const mats=Array.isArray(mesh.material)?mesh.material:[mesh.material];
  const cat=categoryOf(mesh),id=mesh.uuid||mesh.name||path;
  if(!translucent.has(cat)&&isZeroScale(worldScale)&&!mesh.userData?.intentionalHide)issues.push({object:id,code:'SOLID_ZERO_SCALE'});
  if(!translucent.has(cat)&&mesh.geometry===null)issues.push({object:id,code:'SOLID_GEOMETRY_MISSING'});
  mats.forEach((m,slot)=>{
   if(!m)return;
   if(!shared.has(m))shared.set(m,[]);shared.get(m).push(id);
   if(!translucent.has(cat)){
    if(m.transparent===true)issues.push({object:id,slot,code:'OPAQUE_MATERIAL_TRANSPARENT'});
    if(typeof m.opacity==='number'&&m.opacity<0.999)issues.push({object:id,slot,code:'OPAQUE_OPACITY_CHANGED',value:m.opacity});
    if(m.depthTest===false||m.depthWrite===false)issues.push({object:id,slot,code:'OPAQUE_DEPTH_DISABLED'});
    if(hidden&&!mesh.userData?.intentionalHide)issues.push({object:id,slot,code:parentHidden?'PARENT_HIDDEN':'MESH_HIDDEN'});
   }
  });
 });
 for(const [mat,objects] of shared){
  if(objects.length<=1)continue;
  if(issues.some(i=>objects.includes(i.object)&&['OPAQUE_OPACITY_CHANGED','OPAQUE_MATERIAL_TRANSPARENT'].includes(i.code))){
   issues.push({code:'SHARED_MATERIAL_WAS_MUTATED',objects,materialName:mat.name||''});
  }
 }
 return issues;
}
export function snapshotVisibility(root){
 const rows=[];
 walk(root,(mesh,hidden,parentHidden,worldScale,path)=>{
  if(!mesh.isMesh)return;
  const mats=Array.isArray(mesh.material)?mesh.material:[mesh.material];
  rows.push({
   object:mesh.uuid||mesh.name||path,
   path,
   effectiveVisible:!hidden,
   category:categoryOf(mesh),
   isZeroScale:isZeroScale(worldScale),
   hasGeometry:mesh.geometry!==null,
   frustumCulled:mesh.frustumCulled,
   materials:mats.map(m=>m?Object.fromEntries(props.filter(k=>k in m).map(k=>[k,m[k]])):{}),
  });
 });
 return rows;
}
export function compareSnapshots(before,after){
 const b=new Map(before.map(x=>[x.object,x]));
 const a=new Map(after.map(x=>[x.object,x]));
 const changes=[];
 for(const [id,old] of b){
  if(translucent.has(old.category))continue;
  const current=a.get(id);
  if(!current){changes.push({code:'SOLID_MESH_REMOVED',object:id,path:old.path});continue;}
  if(old.effectiveVisible&&!current.effectiveVisible)changes.push({code:'SOLID_DISAPPEARED',object:id});
  if(!old.isZeroScale&&current.isZeroScale)changes.push({code:'SOLID_ZERO_SCALE',object:id});
  if(old.hasGeometry&&!current.hasGeometry)changes.push({code:'SOLID_GEOMETRY_MISSING',object:id});
  if(JSON.stringify(old.materials)!==JSON.stringify(current.materials))changes.push({code:'SOLID_MATERIAL_CHANGED',object:id,before:old.materials,after:current.materials});
 }
 return changes;
}
