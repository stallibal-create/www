import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../../src/assets/vendor/three/build/three.module.min.js';
import { sampleAirway, airwayPaths, worldAirwayPoint } from '../../src/assets/js/assembly/flow.js';
import { createFlowEffects } from '../../src/assets/js/assembly/flow-effects.js';
import { solveAssembly, worldConnector } from '../../src/assets/js/assembly/assembly.js';
import { connectorsFor } from '../../src/assets/js/assembly/geometry.js';
const site=JSON.parse(readFileSync(new URL('../../content/site.json',import.meta.url)));
for(const [name,a] of [['rectangular',site.ductAssembly],['spiral',site.ductSystems.spiral]]){
 test(`${name}: flow follows every part inlet/outlet and the branch airway`,()=>{
  const solved=solveAssembly(a);
  for(const c of a.components){
   const con=connectorsFor(c,a.settings),T=solved.parts.get(c.id).installed;
   for(const [t,k] of [[0,'inlet'],[1,'outlet']]){
    const got=worldAirwayPoint(c,T,t),want=worldConnector(T,con[k]).o;
    assert.ok(Math.hypot(...got.map((v,i)=>v-want[i]))<1e-6,`${c.id}.${k}`);
   }
   if(c.type==='tee')assert.deepEqual(sampleAirway(c,1,true).p,con.branch.o);
  }
  for(const p of airwayPaths(a))for(const f of p.samples){assert.ok(f.p.every(Number.isFinite));assert.ok(f.w>0&&f.h>0);}
 });
 test(`${name}: illustration animates, pauses exactly, changes to heat and hides when exploded`,()=>{
  const meshes=new Map(a.components.map(c=>[c.id,new THREE.Mesh()]));
  const fx=createFlowEffects(THREE,a,meshes,1,true);
  fx.update(.02);const group=meshes.get(a.components[0].id).children[0],points=group.children[0];
  const before=points.geometry.attributes.position.array.slice();fx.update(.04);assert.notDeepEqual(points.geometry.attributes.position.array,before);
  fx.setPaused(true);const paused=points.geometry.attributes.position.array.slice();fx.update(.08);assert.deepEqual(points.geometry.attributes.position.array,paused);
  fx.setMode(true);fx.update(0);assert.equal(points.material.uniforms.uHeat.value,1);
  fx.update(0,.5);assert.equal(group.visible,false);
  fx.setEnabled(false);fx.update(0);assert.equal(group.visible,false);
  fx.destroy();assert.equal(meshes.get(a.components[0].id).children.length,0);
 });
}

test('baked rectangular geometry: flow receives the same installed transforms as its airway',()=>{
 const a=site.ductAssembly,solved=solveAssembly(a),meshes=new Map(a.components.map(c=>[c.id,new THREE.Mesh()]));
 const fx=createFlowEffects(THREE,a,meshes,1,false,solved);
 for(const c of a.components){
  const group=meshes.get(c.id).children[0],p=new THREE.Vector3().applyMatrix4(group.matrix),want=solved.parts.get(c.id).installed.t;
  assert.ok(Math.hypot(p.x-want[0]/1000,p.y-want[1]/1000,p.z-want[2]/1000)<1e-9,c.id);
 }
 fx.destroy();
});
