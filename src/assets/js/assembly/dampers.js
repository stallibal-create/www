// Illustrative multi-blade control dampers. All dimensions below are modelling choices,
// not rated product specifications. The open blades are static; there is no control simulation.
function add(a,b){return a.map((x,i)=>x+b[i]);}
function scale(a,s){return a.map(x=>x*s);}
function box(m,mat,centre,axes,sizes){
  const p=(a,b,c)=>add(centre,add(scale(axes[0],a*sizes[0]/2),add(scale(axes[1],b*sizes[1]/2),scale(axes[2],c*sizes[2]/2))));
  for(let k=0;k<3;k++)for(const sign of [-1,1]){
    const i=(k+1)%3,j=(k+2)%3;
    const at=(a,b)=>{const v=[0,0,0];v[k]=sign;v[i]=a;v[j]=b;return p(...v);};
    m.quad(mat,at(-1,-1),at(1,-1),at(1,1),at(-1,1),scale(axes[k],sign));
  }
}
function shaft(m,centre,radius,length){
  const N=12;
  for(let k=0;k<N;k++){
    const a=k*2*Math.PI/N,b=(k+1)*2*Math.PI/N;
    const at=(t,z)=>add(centre,[radius*Math.cos(t),radius*Math.sin(t),z]);
    m.quad('hardware',at(a,-length/2),at(b,-length/2),at(b,length/2),at(a,length/2),[Math.cos((a+b)/2),Math.sin((a+b)/2),0]);
    for(const side of [-1,1])m.tri('hardware',add(centre,[0,0,side*length/2]),at(a,side*length/2),at(b,side*length/2),[0,0,side]);
  }
}
export function buildDamperControls(m,g,motorised){
  const X=[1,0,0],Y=[0,1,0],Z=[0,0,1],axes=[X,Y,Z];
  const count=3,step=g.heightMm/count,angle=Math.PI/3;
  // Blade chord starts along height when closed and turns towards the flow when open.
  const chord=[Math.sin(angle),Math.cos(angle),0],normal=[Math.cos(angle),-Math.sin(angle),0];
  const x=g.lengthMm/2,z=g.widthMm/2+16;
  for(let i=0;i<count;i++){
    const y=-g.heightMm/2+(i+.5)*step;
    box(m,'hardware',[x,y,0],[normal,chord,Z],[2,step-4,g.widthMm-4]);
    shaft(m,[x,y,8],3,g.widthMm+32);
    box(m,'hardware',[x+12,y,z],axes,[26,8,4]);
  }
  // An external linkage connects the three shafts. It is visible in the cutaway view.
  box(m,'hardware',[x+24,0,z],axes,[6,2*step+8,5]);
  shaft(m,[x,0,z+12],6,24);
  if(motorised){
    // Mount and generic unbranded motor actuator, deliberately without an electrical rating.
    box(m,'flange',[x,0,z+27],axes,[105,68,5]);
    box(m,'gasket',[x,0,z+57],axes,[98,60,54]);
    box(m,'hardware',[x,0,z+86],axes,[42,22,4]);
    box(m,'gasket',[x+57,-14,z+52],axes,[16,18,18]);
  }else{
    // Lever follows the blade angle and has a distinct hand grip.
    box(m,'hardware',add([x,0,z+26],scale(chord,32)),[normal,chord,Z],[9,72,6]);
    box(m,'gasket',add([x,0,z+26],scale(chord,70)),[normal,chord,Z],[15,25,14]);
  }
}

// Circular single-blade version for spiral round ductwork; the adjoining spiral seam
// belongs to the duct, while this short damper body remains a separate smooth fitting.
export function buildRoundDamperControls(m,g,motorised){
  const X=[1,0,0],Y=[0,1,0],Z=[0,0,1],axes=[X,Y,Z],x=g.lengthMm/2;
  const chord=[Math.sin(Math.PI/3),Math.cos(Math.PI/3),0],normal=[.5,-Math.sin(Math.PI/3),0];
  const radius=g.diameterMm/2-2,N=48;
  const at=(a,d)=>add([x,0,0],add(scale(normal,d),add(scale(chord,radius*Math.cos(a)),scale(Z,radius*Math.sin(a)))));
  for(let i=0;i<N;i++){
    const a=i*2*Math.PI/N,b=(i+1)*2*Math.PI/N;
    for(const side of [-1,1])m.tri('hardware',add([x,0,0],scale(normal,side)),at(a,side),at(b,side),scale(normal,side));
    m.quad('hardware',at(a,-1),at(b,-1),at(b,1),at(a,1),add(scale(chord,Math.cos((a+b)/2)),scale(Z,Math.sin((a+b)/2))));
  }
  const z=g.diameterMm/2+16;
  shaft(m,[x,0,8],3,g.diameterMm+32);
  shaft(m,[x,0,z+12],6,24);
  if(motorised){
    box(m,'flange',[x,0,z+27],axes,[105,68,5]);
    box(m,'gasket',[x,0,z+57],axes,[98,60,54]);
    box(m,'hardware',[x,0,z+86],axes,[42,22,4]);
    box(m,'gasket',[x+57,-14,z+52],axes,[16,18,18]);
  }else{
    box(m,'hardware',add([x,0,z+26],scale(chord,32)),[normal,chord,Z],[9,72,6]);
    box(m,'gasket',add([x,0,z+26],scale(chord,70)),[normal,chord,Z],[15,25,14]);
  }
}
