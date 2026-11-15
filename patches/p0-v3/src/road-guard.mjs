/**
 * Conservative ground-space road clearance. Use real scene export and nav path;
 * do not claim an arbitrary visual mesh is walkable just because it passes this.
 * Circular colliders use exact segment distance, not polygon approximations.
 */
import {distanceSegmentPolygon,rotatedRectFootprint} from './geometry.mjs';
const EPS=1e-8;
const finite=(...v)=>v.every(Number.isFinite);
function isPhysical(o){return !o.isGroundDecal&&!o.isVfx&&o.collidable!==false&&o.blocksMovement!==false;}
function validPoint(p){return p&&finite(p.x,p.z);}
function collider(o){
 if(Array.isArray(o.footprint)){
  if(o.footprint.length<3||!o.footprint.every(validPoint))throw new Error('invalid polygon footprint: '+o.id);
  return {kind:'polygon',vertices:o.footprint};
 }
 if(o.rect){
  const r=o.rect;
  if(!finite(r.x,r.z,r.width,r.depth,r.angle??0)||r.width<=0||r.depth<=0)throw new Error('invalid rectangular footprint: '+o.id);
  return {kind:'polygon',vertices:rotatedRectFootprint(r)};
 }
 if(o.circle){
  const c=o.circle;
  if(!finite(c.x,c.z,c.radius)||c.radius<=0)throw new Error('invalid radius/circle: '+o.id);
  return {kind:'circle',center:{x:c.x,z:c.z},radius:c.radius};
 }
 throw new Error('physical object has no valid footprint: '+o.id);
}
function pointSegmentDistance(p,a,b){
 const dx=b.x-a.x,dz=b.z-a.z,den=dx*dx+dz*dz;
 const t=den?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/den)):0;
 return Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz);
}
function distanceToRoad(road,shape){
 let min=Infinity;
 for(let i=1;i<road.points.length;i++){
  const a=road.points[i-1],b=road.points[i];
  const distance=shape.kind==='circle'
   ? Math.max(0,pointSegmentDistance(shape.center,a,b)-shape.radius)
   : distanceSegmentPolygon(a,b,shape.vertices);
  min=Math.min(min,distance);
 }
 return min;
}
export function auditRoads(roads,objects,{pedestrianRadius=0.28,safetyMargin=0.15}={}){
 if(!Array.isArray(roads)||!Array.isArray(objects))throw new Error('roads and objects arrays required');
 if(!finite(pedestrianRadius,safetyMargin)||pedestrianRadius<0||safetyMargin<0)throw new Error('invalid clearance options');
 const collisions=[];
 for(const road of roads){
  if(!road.id||!Array.isArray(road.points)||road.points.length<2||!(road.width>0)||!Number.isFinite(road.width)||!road.points.every(validPoint))throw new Error('invalid road '+road.id);
  const required=road.width/2+pedestrianRadius+safetyMargin;
  for(const obj of objects){
   if(!isPhysical(obj))continue;
   const distance=distanceToRoad(road,collider(obj));
   if(distance<required-EPS)collisions.push({
    roadId:road.id,objectId:obj.id,category:obj.category||'unknown',
    required:Math.round(required*1000)/1000,
    distance:Math.round(distance*1000)/1000,
    intrusion:Math.round((required-distance)*1000)/1000,
   });
  }
 }
 return collisions.sort((a,b)=>b.intrusion-a.intrusion||String(a.roadId).localeCompare(String(b.roadId)));
}
export function placeSafely(roads,placedObjects,candidate,options){
 const issues=auditRoads(roads,[candidate],options);
 if(issues.length)return {placed:false,reasons:issues};
 return {placed:true,objects:placedObjects.concat(candidate)};
}
export function testEveryVariation(roads,sharedObjects,tileVariations,options){
 const failures=[];
 for(const variant of tileVariations){
  const issues=auditRoads(roads,[...sharedObjects,...variant.objects],options);
  if(issues.length)failures.push({variantId:variant.id,issues});
 }
 return failures;
}
