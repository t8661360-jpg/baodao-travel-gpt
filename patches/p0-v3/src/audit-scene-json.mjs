#!/usr/bin/env node
// node src/audit-scene-json.mjs export.json
// export.json schema: {roads: [{id,width,points:[{x,z},...]}], objects:[{id,rect|circle|footprint}], options:{pedestrianRadius,safetyMargin}}
import {readFileSync} from 'node:fs';
import {auditRoads} from './road-guard.mjs';
const file=process.argv[2];
if(!file){console.error('USAGE: node src/audit-scene-json.mjs scene-export.json');process.exit(2);}
try {
 const scene=JSON.parse(readFileSync(file,'utf8'));
 const errors=auditRoads(scene.roads,scene.objects,scene.options);
 const result={status:errors.length?'FAIL':'PASS',roads:scene.roads.length,objects:scene.objects.length,errors};
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
 if(errors.length)process.exitCode=1;
} catch(e){console.error('SCENE_EXPORT_INVALID: '+e.message);process.exitCode=2;}
