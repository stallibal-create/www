import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildPart,connectorsFor,validatePart} from '../../src/assets/js/assembly/geometry.js';
import {validateAssembly} from '../../scripts/assembly-validate.mjs';

const site=JSON.parse(readFileSync(new URL('../../content/site.json',import.meta.url)));
const s=site.ductAssembly.settings;
const c=type=>({id:'test',type,geometry:{demo:true,widthMm:300,heightMm:200,lengthMm:220}});

test('both site components reference control-dampers and assembly is valid',()=>{
  const ids=['damper-manual-1','damper-motorised-1','round-damper-manual-1','round-damper-motorised-1'];
  for(const id of ids){
    const comp=site.ductAssembly.components.find(x=>x.id===id);
    assert.ok(comp,`missing component ${id}`);
    assert.equal(comp.productSlug,'control-dampers');
  }
  assert.deepEqual(validateAssembly(site),[]);
});

test('same connector frames for both types',()=>{
  assert.deepEqual(connectorsFor(c('damper-manual'),s),connectorsFor(c('damper-motorised'),s));
  for(const type of ['damper-manual','damper-motorised']){
    const {inlet,outlet}=connectorsFor(c(type),s);
    assert.equal(inlet.o[0],0);
    assert.equal(outlet.o[0],220);
    assert.equal(inlet.w,300);
    assert.equal(inlet.h,200);
    assert.equal(outlet.w,300);
    assert.equal(outlet.h,200);
  }
});

test('motorised mesh bounds maxZ greater than manual',()=>{
  const manual=buildPart(c('damper-manual'),s);
  const motorised=buildPart(c('damper-motorised'),s);
  assert.ok(motorised.bounds.max[2]>manual.bounds.max[2]);
});

test('length 20 yields nonempty error array',()=>{
  const part={id:'test',type:'damper-manual',geometry:{demo:true,widthMm:300,heightMm:200,lengthMm:20}};
  const errors=validatePart(part,s);
  assert.ok(Array.isArray(errors));
  assert.ok(errors.length>0);
});
test('round variants share their duct connections while the motor is visibly external',()=>{
  const round=type=>({id:'round',type,geometry:{demo:true,diameterMm:300,lengthMm:380}});
  const manual=round('round-damper-manual'), motor=round('round-damper-motorised');
  assert.deepEqual(connectorsFor(manual,s),connectorsFor(motor,s));
  assert.equal(connectorsFor(manual,s).inlet.w,300);
  assert.ok(buildPart(motor,s).bounds.max[2]>buildPart(manual,s).bounds.max[2]);
});
