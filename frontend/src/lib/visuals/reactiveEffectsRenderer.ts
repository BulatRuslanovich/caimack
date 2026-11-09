// SPDX-License-Identifier: AGPL-3.0-only
import { PLAYER_EFFECTS, type PlayerEffect } from "@/lib/playerEffects";
import type { EffectPalette } from "./effectPalette";
import type { AudioMotionFrame } from "./audioMotion";
import { InkFlow } from "./inkFlow";
import { MOTION_BANDS } from "./audioMotion";
import { materialLevels } from "./materialLevels";
import {
  auroraCentre,
  ribbonControls,
  RibbonWaves,
  sampleBand,
  spectrumGlsl,
} from "./soundGeometry";

export interface EffectFrame extends AudioMotionFrame {
  effect: PlayerEffect;
  delta: number;
  intensity: number;
  palette: EffectPalette;
  light: boolean;
}
export interface EffectsRenderer {
  draw(frame: EffectFrame): void;
  destroy(): void;
  kind: string;
}

const vertex = `attribute vec2 position; varying vec2 uv;
void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`;
const noise = `
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);}
float fbm(vec2 p){float n=0.,a=.5;for(int i=0;i<4;i++){n+=a*noise(p);p=mat2(1.6,1.2,-1.2,1.6)*p+4.7;a*=.5;}return n;}
`;
const fragment = `precision highp float;
varying vec2 uv;
uniform vec2 resolution;
uniform float bass,mid,high,pulse,presence,intensity,light,energy;
uniform vec3 primary,secondary,accent,material;
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
 for(int i=0;i<6;i++){
  float k=float(i);
  vec2 anchor=vec2(.12+k*.15,.4+mod(k,2.)*.22);
  vec2 d=(p-anchor)*vec2(resolution.x/resolution.y,1.);
  vec2 response=spectralLevel((k+.5)/6.);
  float lensForce=response.x*.9+response.y*.18;
  q+=d*exp(-dot(d,d)*7.)*lensForce;
 }
 q+=vec2(sin(q.y*1.3),cos(q.x*.9))*.45;
 float ring=0.,stress=0.;
 for(int i=0;i<8;i++){
  float age=beatEvents[i].x;
  if(age>=0.&&age<1.8){
   vec2 origin=vec2(.15+beatEvents[i].z*.7,.4+beatEvents[i].z*.2);
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
 float a=sin(q.x*1.5+sin(q.y)+ring*.08);
 float b=cos(q.y*1.7-sin(q.x*.7)-ring*.06);
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
   float x=.1+sparkEvents[i].z*.75+age*.12;
   glint+=exp(-pow((p.x-x)*11.,2.))*(1.-exp(-age*age/.0025))*exp(-age*6.)*sparkEvents[i].y;
  }
 }
 float flash=glint*(edge+caustic)*.8;
 vec3 color=primary*(pool+edge*(.75+stress*.22))+secondary*prism*.65+accent*(caustic*(.25+material.z*.5)+flash);
 return vec4(color,clamp(.14+pool*.3+edge*.5+prism*.25+caustic*.3+flash*.25,0.,.94));
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

// Semi-Lagrangian advection of an accumulated pigment field. Each pass reads
// the previous frame; newly released pigment stays in the simulation.
const inkFragment = `precision highp float;
varying vec2 uv;
uniform sampler2D history;
uniform vec2 texel;
uniform float delta,bass,mid,high,tick;
uniform vec4 sources[6];
uniform vec3 primary,secondary,accent;
void main(){
 vec2 centre=vec2(.5,.5);
 vec2 r=uv-centre;
 float activity=clamp(bass+mid+high,0.,1.);
 vec2 velocity=vec2(-r.y,r.x)*(.004+bass*.055)/(.09+dot(r,r))*activity;
 velocity+=vec2(sin(uv.y*7.+mid*2.),cos(uv.x*6.-bass*2.))*.018*mid;
 velocity.y+=mid*.065*sin(uv.x*5.+high*2.);
 velocity+=vec2(sin(uv.y*75.+high),cos(uv.x*62.-high))*.006*high;
 for(int i=0;i<6;i++){
  vec2 d=uv-sources[i].xy;
  float rate=min(2.,sources[i].z/max(delta,.001));
  velocity+=vec2(-d.y,d.x)*rate*.012/(.035+dot(d,d));
 }
 vec2 from=clamp(uv-velocity*delta,texel,1.-texel);
 vec4 old=texture2D(history,from);
 vec4 neighbors=(texture2D(history,from+vec2(texel.x,0.))+texture2D(history,from-vec2(texel.x,0.))+texture2D(history,from+vec2(0.,texel.y))+texture2D(history,from-vec2(0.,texel.y)))*.25;
 old=mix(old,neighbors,min(.08,delta*(.65+mid*.4)))*exp(-delta*.065);
 for(int i=0;i<6;i++){
  vec2 d=(uv-sources[i].xy)*vec2(1.,1.4+mid);
  float injection=exp(-dot(d,d)*(160.+high*60.))*sources[i].z;
  vec3 paintColor=mix(primary,mix(secondary,accent,sources[i].w),sources[i].w);
  float amount=1.-exp(-injection*1.8);
  old.rgb=mix(old.rgb,paintColor,amount);
  old.a+=amount*(1.-old.a);
 }
 // Unbiased rounding lets low-density pigment dissipate in RGBA8 textures.
 float rounding=(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233))+tick*91.73)*43758.5453)-.5)/255.;
 gl_FragColor=clamp(old+vec4(rounding),0.,1.);
}`;

export function createEffectsRenderer(canvas: HTMLCanvasElement): EffectsRenderer | null {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: false,
    antialias: false,
    depth: false,
    powerPreference: "low-power",
  });
  if (!gl) return fallback(canvas);
  const program = (source: string, names: string[]) => {
    const shaders = [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER].map((type, i) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, i ? source : vertex);
      gl.compileShader(shader);
      return shader;
    });
    if (shaders.some((shader) => !gl.getShaderParameter(shader, gl.COMPILE_STATUS))) {
      canvas.dataset.shaderError = shaders.map((s) => gl.getShaderInfoLog(s)).join(" ");
      shaders.forEach((s) => gl.deleteShader(s));
      return null;
    }
    const handle = gl.createProgram()!;
    shaders.forEach((s) => gl.attachShader(handle, s));
    gl.linkProgram(handle);
    shaders.forEach((s) => gl.deleteShader(s));
    if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) {
      canvas.dataset.shaderError = gl.getProgramInfoLog(handle) ?? "Link failed";
      gl.deleteProgram(handle);
      return null;
    }
    return {
      handle,
      position: gl.getAttribLocation(handle, "position"),
      uniforms: Object.fromEntries(
        names.map((name) => [name, gl.getUniformLocation(handle, name)]),
      ),
    };
  };
  const main = program(fragment, [
    "resolution",
    "bass",
    "mid",
    "high",
    "pulse",
    "presence",
    "energy",
    "intensity",
    "light",
    "primary",
    "secondary",
    "accent",
    "material",
    "effect",
    "beatEvents[0]",
    "sparkEvents[0]",
    "ribbons[0]",
    "ribbonPhase[0]",
    "inkHistory",
    "spectrum",
  ]);
  if (!main) return null;
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const blank = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, blank);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  const spectrumTexture = gl.createTexture()!;
  const spectrumPixels = new Uint8Array(MOTION_BANDS * 4);
  gl.bindTexture(gl.TEXTURE_2D, spectrumTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    MOTION_BANDS,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    spectrumPixels,
  );
  const bind = (p: NonNullable<typeof main>) => {
    gl.useProgram(p.handle);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(p.position);
    gl.vertexAttribPointer(p.position, 2, gl.FLOAT, false, 0, 0);
  };
  let simulation: ReturnType<typeof program> = null;
  const inkFlow = new InkFlow();
  const ribbonWaves = new RibbonWaves();
  let inkTick = 0;
  let targets: { texture: WebGLTexture; framebuffer: WebGLFramebuffer }[] = [];
  let inkWidth = 0,
    inkHeight = 0,
    read = 0;
  const clearTargets = () => {
    for (const target of targets) {
      gl.deleteTexture(target.texture);
      gl.deleteFramebuffer(target.framebuffer);
    }
    targets = [];
  };
  const drawInk = (frame: EffectFrame) => {
    simulation ??= program(inkFragment, [
      "history",
      "texel",
      "delta",
      "tick",
      "bass",
      "mid",
      "high",
      "sources[0]",
      "primary",
      "secondary",
      "accent",
    ]);
    if (!simulation) return;
    const width = Math.max(1, Math.min(640, canvas.width)),
      height = Math.max(1, Math.round((canvas.height * width) / canvas.width));
    if (width !== inkWidth || height !== inkHeight || !targets.length) {
      clearTargets();
      inkWidth = width;
      inkHeight = height;
      read = 0;
      const seed = new Uint8Array(width * height * 4);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const at = (y * width + x) * 4;
          let alpha = 0;
          const colors = [0, 0, 0];
          for (let i = 0; i < 3; i++) {
            const dx = x / width - (0.25 + i * 0.26),
              dy = y / height - (0.35 + (i % 2) * 0.25);
            const amount = Math.exp(-(dx * dx + dy * dy) * 15) * 0.22;
            alpha += amount;
            for (let c = 0; c < 3; c++) colors[c] += frame.palette[i][c] * amount;
          }
          seed[at] = colors[0];
          seed[at + 1] = colors[1];
          seed[at + 2] = colors[2];
          seed[at + 3] = Math.min(255, alpha * 255);
        }
      for (let i = 0; i < 2; i++) {
        const texture = gl.createTexture()!,
          framebuffer = gl.createFramebuffer()!;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, seed);
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        targets.push({ texture, framebuffer });
      }
      canvas.dataset.inkHistory = "ready";
    }
    const flow = inkFlow.step(frame, frame.delta);
    if (frame.delta > 0) {
      const write = 1 - read;
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets[write].framebuffer);
      gl.viewport(0, 0, width, height);
      bind(simulation);
      const u = simulation.uniforms;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, targets[read].texture);
      gl.uniform1i(u.history, 0);
      gl.uniform2f(u.texel, 1 / width, 1 / height);
      gl.uniform1f(u.delta, frame.delta);
      inkTick += frame.delta;
      gl.uniform1f(u.tick, inkTick);
      ["bass", "mid", "high"].forEach((name, i) => gl.uniform1f(u[name], flow.motion[i]));
      gl.uniform4fv(u["sources[0]"], flow.sources);
      frame.palette.forEach((color, i) =>
        gl.uniform3f(
          u[["primary", "secondary", "accent"][i]],
          color[0] / 255,
          color[1] / 255,
          color[2] / 255,
        ),
      );
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      read = write;
    }
  };
  return {
    kind: "webgl",
    draw(frame) {
      if (gl.isContextLost()) return;
      if (frame.effect === "ink") drawInk(frame);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      bind(main);
      const u = main.uniforms;
      gl.uniform2f(u.resolution, canvas.width, canvas.height);
      gl.uniform3fv(u.material, materialLevels(frame));
      const controls = ribbonControls(frame.spectrum);
      gl.uniform4fv(u["ribbons[0]"], controls);
      gl.uniform1fv(
        u["ribbonPhase[0]"],
        ribbonWaves.step(controls, frame.effect === "aurora" ? frame.delta : 0),
      );
      for (const key of [
        "bass",
        "mid",
        "high",
        "pulse",
        "presence",
        "energy",
        "intensity",
      ] as const)
        gl.uniform1f(u[key], frame[key]);
      gl.uniform1f(u.light, frame.light ? 1 : 0);
      gl.uniform1i(u.effect, PLAYER_EFFECTS.indexOf(frame.effect));
      frame.palette.forEach((color, i) =>
        gl.uniform3f(
          u[["primary", "secondary", "accent"][i]],
          color[0] / 255,
          color[1] / 255,
          color[2] / 255,
        ),
      );
      gl.uniform4fv(u["beatEvents[0]"], frame.beatEvents);
      gl.uniform4fv(u["sparkEvents[0]"], frame.sparkEvents);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, targets[read]?.texture ?? blank);
      gl.uniform1i(u.inkHistory, 0);
      for (let i = 0; i < MOTION_BANDS; i++) {
        spectrumPixels[i * 4 + 3] = Math.round(softBand(frame.spectrum, i) * 255);
        spectrumPixels[i * 4] = Math.round(softBand(frame.transients, i) * 255);
      }
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, spectrumTexture);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        MOTION_BANDS,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        spectrumPixels,
      );
      gl.uniform1i(u.spectrum, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
    destroy() {
      clearTargets();
      if (simulation) gl.deleteProgram(simulation.handle);
      gl.deleteTexture(blank);
      gl.deleteTexture(spectrumTexture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(main.handle);
    },
  };
}

// A little spatial diffusion lets narrow notes bend the material into rounded
// crests while preserving their position across the screen.
function softBand(spectrum: Float32Array, index: number): number {
  return (
    spectrum[Math.max(0, index - 1)] * 0.2 +
    spectrum[index] * 0.6 +
    spectrum[Math.min(MOTION_BANDS - 1, index + 1)] * 0.2
  );
}

function fallback(canvas: HTMLCanvasElement): EffectsRenderer | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const ink = document.createElement("canvas"),
    paint = ink.getContext("2d");
  const inkFlow = new InkFlow();
  const ribbonWaves = new RibbonWaves();
  const spectrum = new Float32Array(MOTION_BANDS);
  const transients = new Float32Array(MOTION_BANDS);
  return {
    kind: "canvas",
    draw(f) {
      const w = canvas.width,
        h = canvas.height;
      const color = (i: number, alpha: number) =>
        `rgba(${f.palette[i % 3].join(",")},${Math.max(0, Math.min(1, alpha))})`;
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = f.intensity;
      if (f.effect === "ink" && paint) {
        const flow = inkFlow.step(f, f.delta);
        if (ink.width !== w || ink.height !== h) {
          ink.width = w;
          ink.height = h;
          for (let i = 0; i < 3; i++) {
            const x = w * (0.25 + i * 0.26),
              y = h * (0.35 + (i % 2) * 0.25),
              r = w * 0.3;
            const g = paint.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0, color(i, 0.12));
            g.addColorStop(1, color(i, 0));
            paint.fillStyle = g;
            paint.fillRect(0, 0, w, h);
          }
        }
        if (f.delta > 0) {
          paint.save();
          paint.globalCompositeOperation = "copy";
          paint.translate(w * 0.5, h * 0.5);
          paint.rotate(flow.motion[0] * f.delta * 0.035);
          paint.drawImage(
            ink,
            -w * 0.5 + flow.motion[2] * f.delta * 7.5,
            -h * 0.5 - flow.motion[1] * f.delta * 9,
          );
          paint.restore();
          paint.globalCompositeOperation = "destination-out";
          paint.fillStyle = `rgba(0,0,0,${f.delta * 0.07})`;
          paint.fillRect(0, 0, w, h);
          paint.globalCompositeOperation = "source-over";
        }
        for (let source = 0; source < 6; source++) {
          const at = source * 4;
          if (flow.sources[at + 2] <= 0) continue;
          const x = flow.sources[at] * w,
            y = flow.sources[at + 1] * h,
            r = w * 0.13;
          const g = paint.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, color(Math.floor(flow.sources[at + 3] * 3), flow.sources[at + 2]));
          g.addColorStop(1, color(0, 0));
          paint.fillStyle = g;
          paint.fillRect(0, 0, w, h);
        }
        ctx.drawImage(ink, 0, 0);
      } else if (f.effect === "glass") {
        const material = materialLevels(f);
        let stress = 0;
        for (let i = 0; i < 8; i++) {
          const age = f.beatEvents[i * 4];
          if (age >= 0 && age < 1.8)
            stress +=
              (1 - Math.exp((-age * age) / 0.0036)) * Math.exp(-age * 4) * f.beatEvents[i * 4 + 1];
        }
        stress = Math.min(1, stress);
        for (let i = 0; i < 8; i++) {
          ctx.save();
          ctx.translate(w * (0.18 + (i / 7) * 0.64), h * (0.36 + (i % 2) * 0.22));
          ctx.rotate(i * 0.7);
          const g = ctx.createLinearGradient(-w * 0.3, 0, w * 0.3, 0);
          g.addColorStop(0, color(i, 0));
          g.addColorStop(0.48 - material[2] * 0.02, color(i, 0.28));
          g.addColorStop(0.5, color(i, 0.65 + material[2] * 0.25 + stress * 0.1));
          g.addColorStop(1, color(i, 0));
          ctx.fillStyle = g;
          ctx.fillRect(-w * 0.5, -h, w, h * 2);
          ctx.restore();
        }
      } else {
        f.spectrum.forEach((_, i) => (spectrum[i] = softBand(f.spectrum, i)));
        f.transients.forEach((_, i) => (transients[i] = softBand(f.transients, i)));
        const geometry = { spectrum, transients, beatEvents: f.beatEvents };
        const controls = ribbonControls(spectrum);
        const phases = ribbonWaves.step(controls, f.delta);
        const heightAt = (x: number, i: number) => {
          return h * (1 - auroraCentre(geometry, x, i, controls, phases[i]));
        };
        for (let i = 0; i < 5; i++) {
          ctx.beginPath();
          for (let step = 0; step <= 120; step++) {
            const x = step / 120;
            const y = heightAt(x, i);
            if (step === 0) ctx.moveTo(x * w, y);
            else ctx.lineTo(x * w, y);
          }
          const power = controls[i * 4];
          ctx.strokeStyle = color(i, 0.04 + power * 0.28);
          ctx.lineWidth = h * (0.018 + power * 0.035);
          ctx.stroke();
          const rim = ctx.createLinearGradient(0, 0, w, 0);
          const from = controls[i * 4 + 2],
            to = controls[i * 4 + 3];
          for (let bin = 0; bin < MOTION_BANDS; bin++) {
            const x = bin / (MOTION_BANDS - 1),
              frequency = from + (to - from) * x;
            rim.addColorStop(
              x,
              color(
                i,
                0.08 +
                  sampleBand(spectrum, frequency) * 0.7 +
                  sampleBand(transients, frequency) * 0.5,
              ),
            );
          }
          ctx.strokeStyle = rim;
          ctx.lineWidth = Math.max(1, h * 0.0025);
          ctx.stroke();
          for (let j = 0; j < 6; j++) {
            const age = f.sparkEvents[j * 4];
            if (age < 0 || age >= 0.8) continue;
            const seed = f.sparkEvents[j * 4 + 2];
            const coupling = Math.exp(-2 * ((seed - (from + to) / 2) / (to - from + 1 / 23)) ** 2);
            const x = Math.max(0.05, Math.min(0.95, (seed - from) / (to - from))) + age * 0.12;
            ctx.beginPath();
            ctx.arc(x * w, heightAt(x, i), Math.max(1, h * 0.003), 0, Math.PI * 2);
            ctx.fillStyle = color(
              2,
              (1 - Math.exp((-age * age) / 0.0016)) *
                Math.exp(-age * 5) *
                f.sparkEvents[j * 4 + 1] *
                coupling,
            );
            ctx.fill();
          }
        }
      }
      ctx.globalAlpha = 1;
    },
    destroy() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ink.width = ink.height = 0;
    },
  };
}
