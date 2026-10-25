// GPU sprite shading + lightweight CPU streamline advection. No textures, remote assets or video.
import { airwayPaths } from './flow.js';
const VERT = `
attribute float aSeed;
uniform float uHeat;
uniform float uPixelRatio;
varying float vSeed;
void main(){
 vSeed=aSeed;
 vec4 p=modelViewMatrix*vec4(position,1.0);
 gl_Position=projectionMatrix*p;
 gl_PointSize=clamp(mix(6.5,150.0,uHeat)*(0.7+0.6*aSeed)*uPixelRatio/max(0.6,-p.z),2.0,96.0);
}`;
const FRAG = `
precision highp float;
uniform float uTime;
uniform float uHeat;
varying float vSeed;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
void main(){
 vec2 uv=gl_PointCoord*2.0-1.0;
 float n=noise(uv*4.0+vec2(vSeed*19.0,-uTime*2.6));
 float taper=1.35+uv.y*0.5;
 float turbulence=n*0.38+noise(uv*9.0+vec2(vSeed*23.0,-uTime*3.9))*0.14;
 float plume=1.0-length(vec2((uv.x+sin(uv.y*4.0+uTime*3.0+vSeed*9.0)*0.14)*taper,uv.y*0.72));
 float fire=smoothstep(0.12,0.88,plume+turbulence)*0.045;
 float air=exp(-dot(uv,uv)*5.0)*0.85;
 vec3 fireColor=mix(vec3(1.0,0.08,0.008),vec3(1.0,0.45,0.045),clamp(plume*1.5,0.0,1.0));
 fireColor=mix(fireColor,vec3(1.0,0.82,0.32),smoothstep(0.82,1.18,plume+turbulence*0.3));
 vec3 color=mix(vec3(0.24,0.78,1.0),fireColor,uHeat);
 float alpha=mix(air,fire,uHeat);
 if(alpha<0.012)discard;
 gl_FragColor=vec4(color,alpha);
}`;
const fract = x => x - Math.floor(x);
const seed = i => fract(Math.sin(i * 127.1 + 43.7) * 43758.5453);

export function createFlowEffects(THREE, assembly, meshes, pixelRatio = 1, mobile = false, bakedTransforms = null) {
  const paths = airwayPaths(assembly), records = [], resources = [], material = new THREE.ShaderMaterial({
    uniforms: { uTime:{value:0},uHeat:{value:0},uPixelRatio:{value:pixelRatio} }, vertexShader:VERT,fragmentShader:FRAG,
    transparent:true,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending,
  });
  const trailMat = new THREE.LineBasicMaterial({color:0x56cfff,transparent:true,opacity:.48,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending});
  for (const [index,path] of paths.entries()) {
    const count=mobile?48:80, pos=new Float32Array(count*3), tails=new Float32Array(count*6), seeds=Float32Array.from({length:count},(_,i)=>seed(i+index*count));
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('aSeed',new THREE.BufferAttribute(seeds,1));
    const points=new THREE.Points(geo,material);points.frustumCulled=false;points.renderOrder=8;
    const lineGeo=new THREE.BufferGeometry();lineGeo.setAttribute('position',new THREE.BufferAttribute(tails,3));
    const lines=new THREE.LineSegments(lineGeo,trailMat);lines.frustumCulled=false;lines.renderOrder=7;
    const group=new THREE.Group();
    if (bakedTransforms) {
      const {r,t}=bakedTransforms.parts.get(path.id).installed;
      group.matrixAutoUpdate=false;
      group.matrix.set(r[0],r[1],r[2],t[0]/1000,r[3],r[4],r[5],t[1]/1000,r[6],r[7],r[8],t[2]/1000,0,0,0,1);
    }
    group.add(points,lines);meshes.get(path.id).add(group);
    records.push({path,count,pos,tails,seeds,geo,lineGeo,group});resources.push(geo,lineGeo);
  }
  let time=0,heat=false,paused=false,enabled=true;
  function point(path,t,lane,phase) {
    const p=t*64, i=Math.min(63,Math.floor(p)), f=p-i, a=path.samples[i],b=path.samples[i+1];
    const theta=lane*6.2831853+phase, r=.29*Math.sqrt(lane), y=Math.cos(theta)*r, z=Math.sin(theta)*r;
    return a.p.map((v,k)=>((v+(b.p[k]-v)*f)+(a.up[k]*(a.h+(b.h-a.h)*f)*y)+(a.side[k]*(a.w+(b.w-a.w)*f)*z))/1000);
  }
  function update(dt,exploded=0){
    if(!paused)time+=Math.min(.08,dt);
    material.uniforms.uTime.value=time;material.uniforms.uHeat.value=heat?1:0;
    for(const r of records){
      r.group.visible=enabled&&exploded<.025;
      for(let i=0;i<r.count;i++){
        const lane=r.seeds[i],t=fract(i/r.count+time*(heat?.23:.16)+(r.path.branch?.18:0));
        const phase=(heat?.35:.08)*Math.sin(time*.8+lane*12);
        const p=point(r.path,t,lane,phase),q=point(r.path,Math.max(0,t-(heat?.018:.045)),lane,phase);
        r.pos.set(p,i*3);r.tails.set(p,i*6);r.tails.set(q,i*6+3);
      }
      r.geo.attributes.position.needsUpdate=true;r.lineGeo.attributes.position.needsUpdate=true;
    }
    return enabled&&!paused&&exploded<.025;
  }
  return {update,setMode(on){heat=on;trailMat.color.set(on?0xff6a18:0x56cfff);trailMat.opacity=on?.12:.48;},setPaused(on){paused=on;},setEnabled(on){enabled=on;},destroy(){for(const r of records)r.group.removeFromParent();for(const g of resources)g.dispose();material.dispose();trailMat.dispose();}};
}
