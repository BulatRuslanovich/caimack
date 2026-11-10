// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { GLASS_LENSES, INK_FLOWS } from "./effectLayout";
import { spectrumGlsl } from "./soundGeometry";

export const vertex = `attribute vec2 position; varying vec2 uv;
void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`;

const noise = `
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);}
float fbm(vec2 p){float n=0.,a=.5;for(int i=0;i<4;i++){n+=a*noise(p);p=mat2(1.6,1.2,-1.2,1.6)*p+4.7;a*=.5;}return n;}
`;

export const fragment = `precision highp float;
varying vec2 uv;
uniform vec2 resolution;
uniform float bass,mid,high,pulse,presence,intensity,light,energy;
uniform vec3 primary,secondary,accent,material;
uniform vec4 lenses[${GLASS_LENSES}],lensOptics[${GLASS_LENSES}];
uniform float layoutSeed;
uniform vec4 beatEvents[8],sparkEvents[6];
uniform vec4 ribbons[5];
uniform float ribbonPhase[5];
uniform sampler2D inkHistory;
uniform sampler2D spectrum;
uniform int effect;
${noise}

${spectrumGlsl}
float glints(vec2 p,vec2 range){
 float value=0.;
 for(int i=0;i<6;i++){
  float age=sparkEvents[i].x,seed=sparkEvents[i].z;
  if(age>=0.&&age<.8){
   float width=range.y-range.x+1./23.;
   float coupling=exp(-2.*pow((seed-(range.x+range.y)*.5)/width,2.));
   float x=clamp((seed-range.x)/(range.y-range.x),.05,.95)+age*.12;
   value+=exp(-pow((p.x-x)*8.,2.))*(1.-exp(-age*age/.0016))*exp(-age*5.)*sparkEvents[i].y*coupling;
  }
 }
 return value;
}

vec4 aurora(vec2 p){
 vec3 color=vec3(0.);float density=0.;
 for(int line=0;line<5;line++){
 float k=float(line),power=ribbons[line].x,pitch=ribbons[line].y;
 vec2 range=ribbons[line].zw;
 float width=range.y-range.x+1./23.;
 float wave=0.;
 for(int i=0;i<8;i++){
  float age=beatEvents[i].x;
  if(age>=0.&&age<2.5){
   float frequency=beatEvents[i].z;
   float coupling=exp(-2.*pow((frequency-(range.x+range.y)*.5)/width,2.));
   float origin=clamp((frequency-range.x)/(range.y-range.x),.12,.88);
   float left=p.x-origin+age*1.5,right=p.x-origin-age*1.5;
   float launch=1.-exp(-age*age/0.0064);
   wave+=(cos(left*15.)*exp(-left*left*32.)+cos(right*15.)*exp(-right*right*32.))*.5*launch*exp(-age*2.5)*beatEvents[i].y*coupling;
  }
 }
 vec2 response=spectralLevel(mix(range.x,range.y,p.x));
 float local=response.x,attack=response.y;
 float rest=sin(p.x*2.7-.8)*.055;
 float centre=.5+(k-2.)*.085+rest+(power-.2)*.24+(local-power)*.16+attack*.045+.06*wave/(1.+abs(wave))+(pitch-.5)*power*.08*sin(p.x*3.14159265);
 float phase=ribbonPhase[line];
 float standing=sin(p.x*(1.25+pitch*1.5)*6.2831853-phase)+sin(p.x*(2.2+pitch)*6.2831853+phase*.6)*.25;
 centre+=standing*pow(power,1.5)*.12;
 float offset=centre-.5;
 centre=.5+.4*offset/sqrt(.16+offset*offset);
  float x=p.x;
  float d=p.y-centre;
  float fold=.45+.55*noise(vec2(x*16.+k*2.,local*1.2));
  float curtain=exp(-abs(d)*(22.-power*10.))*smoothstep(-.045,.07,d)*fold;
  float rim=exp(-d*d*(3200.-power*1600.))*(.08+local*.7+attack*.8);
  float sparkle=glints(p,range)*exp(-abs(d)*60.)*(.08+local*.65);
  float a=(curtain*(.12+power*.9)+rim*.48+sparkle*.35)*(1.-k*.06);
  color+=mix(primary,secondary,k/4.)*a+accent*(sparkle*.5+rim*(local*x*.16+attack*.35));
  density+=a;
 }
 // Output straight colour: alpha already carries optical density. Multiplying
 // the colour by density again made quiet notes and their accents disappear.
 return vec4(color/max(density,.001),1.-exp(-density*1.6));
}

vec4 glass(vec2 p){
 vec2 q=p*vec2(resolution.x/resolution.y,1.)*2.8;
 // Stationary glass: each part of the spectrum bends a fixed local lens.
 // No camera translation, rotation, or clock-driven change of coordinates.
 float crystal=0.,facet=0.;
 for(int i=0;i<${GLASS_LENSES};i++){
  vec4 lens=lenses[i],optics=lensOptics[i];
  vec2 d=(p-lens.xy)*vec2(resolution.x/resolution.y,1.);
  vec2 local=vec2(d.x*optics.x+d.y*optics.y,-d.x*optics.y+d.y*optics.x)/lens.zw;
  float radius=dot(local,local),falloff=exp(-radius*1.4);
  vec2 response=spectralLevel(optics.w);
  float lensForce=(.18+response.x*.85+response.y*.2)*optics.z;
  vec2 bend=local*lens.zw*falloff*lensForce;
  q+=vec2(bend.x*optics.x-bend.y*optics.y,bend.x*optics.y+bend.y*optics.x);
  crystal+=falloff*optics.z;
  facet+=exp(-pow(radius-.8,2.)*10.)*(.025+response.x*.08+response.y*.16);
 }
 q+=vec2(sin(q.y*1.3),cos(q.x*.9))*.45;
 float ring=0.,stress=0.;
 for(int i=0;i<8;i++){
  float age=beatEvents[i].x;
  if(age>=0.&&age<1.8){
   float frequency=beatEvents[i].z;
   vec2 origin=.12+vec2(hash(vec2(frequency*13.+layoutSeed,2.)),hash(vec2(frequency*17.,layoutSeed+4.)))*.76;
   vec2 r=(p-origin)*vec2(resolution.x/resolution.y,1.);
   float d=sqrt(dot(r,r)+.01)-age*.8;
   float launch=1.-exp(-age*age/.0036);
   float response=launch*exp(-age*4.)*beatEvents[i].y;
   ring+=cos(d*18.)*exp(-d*d*18.)*response;
   stress+=response;
  }
 }
 stress=clamp(stress,0.,1.);
 // Stress changes refraction locally; it does not push the entire surface.
 float a=sin(q.x*1.3+sin(q.y)+ring*.08+crystal*1.6);
 float b=cos(q.y*1.5-sin(q.x*.7)-ring*.06+crystal*.9);
 float lens=a+b*.72;
 float edge=pow(.035/(abs(lens)+.035),.75);
 float dispersion=.055+material.z*.24+stress*.08;
 float prism=pow(.045/(abs(lens+dispersion)+.045),.9);
 float caustic=pow(.04/(abs(a-b*.8-.15)+.04),1.05);
 float pool=smoothstep(-1.1,1.2,lens)*.35;
 float glint=0.;
 for(int i=0;i<6;i++){
  float age=sparkEvents[i].x;
  if(age>=0.&&age<.8){
   float frequency=sparkEvents[i].z;
   vec2 site=.12+vec2(hash(vec2(frequency*13.+layoutSeed,2.)),hash(vec2(frequency*17.,layoutSeed+4.)))*.76;
   vec2 d=(p-site)*vec2(resolution.x/resolution.y,1.);
   glint+=exp(-dot(d,d)*90.)*(1.-exp(-age*age/.0025))*exp(-age*6.)*sparkEvents[i].y;
  }
 }
 float flash=glint*(edge+caustic)*.8;
 vec3 color=primary*(pool+edge*(.75+stress*.22))+secondary*(prism*.65+facet*.4)+accent*(caustic*(.25+material.z*.5)+flash);
 return vec4(color,clamp(.14+pool*.3+edge*.5+prism*.25+caustic*.3+flash*.25+facet*.15,0.,.94));
}

vec4 ink(vec2 p){
 vec2 q=(p-.5)*vec2(resolution.x/resolution.y,1.);
 vec2 drift=vec2(fbm(q*1.1+material.y*.2),fbm(q*1.2-vec2(0.,material.x*.2)+7.));
 vec4 paint=texture2D(inkHistory,clamp(p+(drift-.5)*.075,0.,1.));
 vec3 color=clamp(paint.rgb/max(.04,paint.a),0.,1.);
 float cloud=fbm(q*2.7+drift*4.5);
 float body=smoothstep(.27,.7,cloud);
 float tendrils=pow(max(0.,1.-abs(cloud-.48)*3.),14.)*.3;
 float density=1.-exp(-paint.a*3.4);
 return vec4(color*(.45+body*.7),clamp((body*.75+tendrils)*density,0.,.94));
}

void main(){
 vec4 result;
 if(effect==0)result=aurora(uv);else if(effect==1)result=glass(uv);else result=ink(uv);
 float top=1.-smoothstep(.78,1.,uv.y);
 float edge=1.-smoothstep(.22,1.2,length((uv-.5)*vec2(1.,.8)));
 float readability=1.-smoothstep(.48,.85,uv.x)*.3;
 gl_FragColor=vec4(clamp(mix(result.rgb,result.rgb*.62,light),0.,1.),result.a*intensity*(.7+.3*edge)*(.65+.35*top)*readability);
}`;

export const inkFragment = `precision highp float;
varying vec2 uv;
uniform sampler2D history;
uniform vec2 texel;
uniform float delta,bass,mid,high,tick;
uniform vec4 sources[${INK_FLOWS}],flows[${INK_FLOWS}];
uniform vec3 primary,secondary,accent;
void main(){
 float aspect=texel.y/texel.x;
 vec2 velocity=vec2(0.);
 for(int i=0;i<${INK_FLOWS};i++){
  vec2 d=(uv-flows[i].xy)*vec2(aspect,1.);
  float radius=flows[i].w,frequency=float(i)/${INK_FLOWS - 1}.;
  float local=exp(-dot(d,d)/(radius*radius));
  vec2 curl=vec2(-d.y,d.x)/radius*local*flows[i].z*.16;
  velocity+=vec2(curl.x/aspect,curl.y);
  velocity+=vec2(sin(uv.y*(12.+frequency*45.)),cos(uv.x*(10.+frequency*40.)))*abs(flows[i].z)*local*.009*frequency;
  d=uv-sources[i].xy;
  float rate=min(2.,sources[i].z/max(delta,.001));
  velocity+=vec2(-d.y,d.x)*rate*.01/(.035+dot(d,d));
 }
 vec2 from=clamp(uv-velocity*delta,texel,1.-texel);
 vec4 old=texture2D(history,from);
 vec4 neighbors=(texture2D(history,from+vec2(texel.x,0.))+texture2D(history,from-vec2(texel.x,0.))+texture2D(history,from+vec2(0.,texel.y))+texture2D(history,from-vec2(0.,texel.y)))*.25;
 old=mix(old,neighbors,min(.08,delta*(.65+mid*.4)))*exp(-delta*.065);
 for(int i=0;i<${INK_FLOWS};i++){
  float frequency=sources[i].w;
  vec2 d=(uv-sources[i].xy)*vec2(aspect,1.2+sin(frequency*3.14159)*1.5);
  float radius=mix(.13,.035,frequency);
  float injection=exp(-dot(d,d)/(radius*radius))*sources[i].z;
  vec3 paintColor=mix(primary,mix(secondary,accent,sources[i].w),sources[i].w);
  float amount=1.-exp(-injection*1.8);
  old.rgb=mix(old.rgb,paintColor,amount);
  old.a+=amount*(1.-old.a);
 }
 // Unbiased rounding lets low-density pigment dissipate in RGBA8 textures.
 float rounding=(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233))+tick*91.73)*43758.5453)-.5)/255.;
 gl_FragColor=clamp(old+vec4(rounding),0.,1.);
}`;
