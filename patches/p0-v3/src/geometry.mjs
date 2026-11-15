// Portable, engine-agnostic X/Z road clearance auditor.
// Does NOT edit the user's deployed game. Requires integration with its scene graph.
const EPS = 1e-9;
const sq = n => n * n;
const dist2 = (a,b) => sq(a.x-b.x) + sq(a.z-b.z);
function orient(a,b,c){return (b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);}
function onSegment(a,b,p){return Math.min(a.x,b.x)-EPS<=p.x && p.x<=Math.max(a.x,b.x)+EPS && Math.min(a.z,b.z)-EPS<=p.z && p.z<=Math.max(a.z,b.z)+EPS && Math.abs(orient(a,b,p))<EPS;}
function intersects(a,b,c,d){const s1=orient(a,b,c),s2=orient(a,b,d),s3=orient(c,d,a),s4=orient(c,d,b);return ((s1>EPS&&s2<-EPS)||(s1<-EPS&&s2>EPS))&&((s3>EPS&&s4<-EPS)||(s3<-EPS&&s4>EPS))||[onSegment(a,b,c),onSegment(a,b,d),onSegment(c,d,a),onSegment(c,d,b)].some(Boolean);}
function pointOnSegmentDistance2(p,a,b){const dx=b.x-a.x,dz=b.z-a.z,denom=dx*dx+dz*dz;const t=denom ? Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/denom)):0;return dist2(p,{x:a.x+t*dx,z:a.z+t*dz});}
export function pointInPolygon(p,polygon){let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if(onSegment(a,b,p)) return true;const straddle=(a.z>p.z)!==(b.z>p.z); if(straddle && p.x < (b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)inside=!inside;}return inside;}
export function distanceSegmentPolygon(a,b,polygon){if(polygon.length<3)throw new Error('footprint polygon requires 3+ points');if(pointInPolygon(a,polygon)||pointInPolygon(b,polygon))return 0;let best=Infinity;for(let i=0;i<polygon.length;i++){const c=polygon[i],d=polygon[(i+1)%polygon.length];if(intersects(a,b,c,d))return 0;best=Math.min(best,pointOnSegmentDistance2(a,c,d),pointOnSegmentDistance2(b,c,d),pointOnSegmentDistance2(c,a,b),pointOnSegmentDistance2(d,a,b));}return Math.sqrt(best);}
export function rotatedRectFootprint({x,z,width,depth,angle=0}){const c=Math.cos(angle),s=Math.sin(angle);return [[-width/2,-depth/2],[width/2,-depth/2],[width/2,depth/2],[-width/2,depth/2]].map(([u,v])=>({x:x+u*c-v*s,z:z+u*s+v*c}));}
export function auditClearance(roads,physicalObjects,{safetyMargin=0.2}={}){
 const violations=[];
 for(const road of roads){if(!(road.points?.length>=2&&road.width>0))throw new Error('invalid road '+road.id);
  const halfWidth=road.width/2+safetyMargin;
  for(const object of physicalObjects){if(object.decorativeOnly||object.isGroundDecal||object.isVfx)continue;
   if(!object.footprint)throw new Error('physical object missing footprint: '+object.id);
   let min=Infinity;
   for(let i=1;i<road.points.length;i++) min=Math.min(min,distanceSegmentPolygon(road.points[i-1],road.points[i],object.footprint));
   if(min<halfWidth-EPS)violations.push({road:road.id,object:object.id,clearance:min,required:halfWidth,overlap:halfWidth-min});
  }
 }
 return violations.sort((a,b)=>b.overlap-a.overlap);
}
export function assertWalkable(roads,objects,options){const errors=auditClearance(roads,objects,options);if(errors.length)throw new Error('Road blocked: '+JSON.stringify(errors.slice(0,8)));return true;}
