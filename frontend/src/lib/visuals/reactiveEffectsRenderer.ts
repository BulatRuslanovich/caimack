// SPDX-License-Identifier: AGPL-3.0-only
import { PLAYER_EFFECTS, type PlayerEffect } from "@/lib/playerEffects";
import type { EffectPalette } from "./effectPalette";
import type { AudioMotionFrame } from "./audioMotion";
import { InkFlow } from "./inkFlow";

export interface EffectFrame extends AudioMotionFrame {
  effect: PlayerEffect;
  time: number;
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
uniform vec2 resolution,spring;
uniform float time,bass,mid,high,pulse,presence,intensity,light;
uniform vec3 primary,secondary,accent;
uniform vec4 beatEvents[8],sparkEvents[6];
uniform sampler2D inkHistory;
uniform int effect;
${noise}

float travelingWave(float x){
 float wave=0.;
 for(int i=0;i<8;i++){
  float age=beatEvents[i].x,strength=beatEvents[i].y;
  if(age>=0.&&age<3.5){float d=x-(-.18+age*.58);wave+=sin(d*19.-age*2.)*exp(-d*d*22.)*exp(-age*.65)*strength;}
 }
 return wave;
}
float glints(vec2 p){
 float value=0.;
 for(int i=0;i<6;i++){
  float age=sparkEvents[i].x,seed=sparkEvents[i].z;
  if(age>=0.&&age<.8){float x=fract(seed+age*.9);value+=exp(-pow((p.x-x)*8.,2.))*exp(-age*5.)*sparkEvents[i].y;}
 }
 return value;
}

vec4 aurora(vec2 p){
 vec3 color=vec3(0.);float density=0.;
 float wave=travelingWave(p.x);
 for(int i=0;i<5;i++){
  float k=float(i),x=p.x;
  float flow=sin(x*2.2+time*.16+k*.9)*.16+sin(x*5.1-time*.11+k)*.055;
  float centre=.43+k*.065+flow*(1.+mid*.75)+wave*(.075+k*.009)-presence*.07;
  float d=p.y-centre;
  float fold=.45+.55*noise(vec2(x*(12.+mid*8.)+k*2.+mid*.65,time*.08));
  float curtain=exp(-abs(d)*(13.-presence*7.))*smoothstep(-.065,.08,d)*fold;
  float rim=exp(-d*d*(2200.-mid*900.))*(.3+mid*.55);
  float sparkle=glints(p)*exp(-abs(d)*45.)*(.15+high*.5);
  float a=(curtain*.8+rim*.32+sparkle*.42)*(1.-k*.09);
  color+=mix(primary,secondary,k/4.)*a+accent*sparkle*.3;
  density+=a;
 }
 return vec4(color,clamp(density*.85,0.,.92));
}

vec4 glass(vec2 p){
 vec2 q=p*vec2(resolution.x/resolution.y,1.)*2.8;
 q+=spring*2.2;
 q+=vec2(sin(q.y*1.3+time*.13+mid*.35),cos(q.x*.9-time*.11))*(.5+mid*.16);
 float ring=0.;
 for(int i=0;i<8;i++){
  float age=beatEvents[i].x;
  if(age>=0.&&age<1.3){vec2 origin=vec2(beatEvents[i].z,.5);float d=length((p-origin)*vec2(1.3,1.));ring+=sin(d*16.-age*10.)*exp(-age*3.)*beatEvents[i].y;}
 }
 q+=ring*.09;
 float a=sin(q.x*1.5+sin(q.y+time*.16));
 float b=cos(q.y*1.7-sin(q.x*.7-time*.12));
 float lens=a+b*.72;
 float edge=pow(.035/(abs(lens)+.035),.75);
 float dispersion=.07+high*.22+pulse*.08;
 float prism=pow(.045/(abs(lens+dispersion)+.045),.9);
 float caustic=pow(.04/(abs(a-b*.8-.15)+.04),1.05);
 float pool=smoothstep(-1.1,1.2,lens)*.35;
 float flash=glints(p)*(edge+caustic)*.85;
 vec3 color=primary*(pool+edge*.85)+secondary*prism*.65+accent*(caustic*(.3+high*.4)+flash);
 return vec4(color,clamp(.14+pool*.3+edge*.5+prism*.25+caustic*.3+flash*.25,0.,.94));
}

vec4 ink(vec2 p){
 vec2 q=(p-.5)*vec2(resolution.x/resolution.y,1.);
 vec2 drift=vec2(fbm(q*1.1+time*.03),fbm(q*1.2-vec2(0.,time*.04)+7.));
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
uniform float time,delta,bass,mid,high;
uniform vec4 sources[6];
uniform vec3 primary,secondary,accent;
void main(){
 vec2 centre=vec2(.5+sin(time*.11)*.18,.5+cos(time*.09)*.12);
 vec2 r=uv-centre;
 vec2 velocity=vec2(-r.y,r.x)*(.012+bass*.027)/(.09+dot(r,r));
 velocity+=vec2(sin(uv.y*7.+time*.12),cos(uv.x*6.-time*.08))*.012;
 velocity.y+=(.008+mid*.045)*sin(uv.x*5.+time*.08);
 velocity+=vec2(sin(uv.y*75.+time),cos(uv.x*62.-time))*.004*high;
 vec2 from=clamp(uv-velocity*delta,texel,1.-texel);
 vec4 old=texture2D(history,from);
 vec4 neighbors=(texture2D(history,from+vec2(texel.x,0.))+texture2D(history,from-vec2(texel.x,0.))+texture2D(history,from+vec2(0.,texel.y))+texture2D(history,from-vec2(0.,texel.y)))*.25;
 old=mix(old,neighbors,min(.08,delta*(.65+mid*.4)))*exp(-delta*.065);
 for(int i=0;i<6;i++){
  vec2 d=(uv-sources[i].xy)*vec2(1.,1.4+mid);
  float injection=exp(-dot(d,d)*(160.+high*60.))*sources[i].z;
  vec3 paintColor=mix(primary,mix(secondary,accent,sources[i].w),sources[i].w);
  old.rgb+=paintColor*injection*(1.-old.a*.55);
  old.a+=injection*(1.-old.a);
 }
 // Unbiased rounding lets low-density pigment dissipate in RGBA8 textures.
 float rounding=(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233))+time*91.73)*43758.5453)-.5)/255.;
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
    "spring",
    "time",
    "bass",
    "mid",
    "high",
    "pulse",
    "presence",
    "intensity",
    "light",
    "primary",
    "secondary",
    "accent",
    "effect",
    "beatEvents[0]",
    "sparkEvents[0]",
    "inkHistory",
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
  const bind = (p: NonNullable<typeof main>) => {
    gl.useProgram(p.handle);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(p.position);
    gl.vertexAttribPointer(p.position, 2, gl.FLOAT, false, 0, 0);
  };
  let simulation: ReturnType<typeof program> = null;
  const inkFlow = new InkFlow();
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
      "time",
      "delta",
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
      for (const name of ["time", "delta"] as const) gl.uniform1f(u[name], frame[name]);
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
      gl.uniform2fv(u.spring, frame.spring);
      for (const key of ["time", "bass", "mid", "high", "pulse", "presence", "intensity"] as const)
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
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
    destroy() {
      clearTargets();
      if (simulation) gl.deleteProgram(simulation.handle);
      gl.deleteTexture(blank);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(main.handle);
    },
  };
}

function fallback(canvas: HTMLCanvasElement): EffectsRenderer | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const ink = document.createElement("canvas"),
    paint = ink.getContext("2d");
  const inkFlow = new InkFlow();
  return {
    kind: "canvas",
    draw(f) {
      const w = canvas.width,
        h = canvas.height,
        t = f.time;
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
          paint.globalCompositeOperation = "copy";
          paint.drawImage(ink, Math.sin(t * 0.1) * flow.motion[1] * 0.25, -flow.motion[1] * 0.3);
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
        for (let i = 0; i < 8; i++) {
          ctx.save();
          ctx.translate(
            w * (0.5 + Math.sin(t * 0.1 + i) * 0.3 + f.spring[0]),
            h * (0.5 + f.spring[1]),
          );
          ctx.rotate(i * 0.7 + t * 0.04 + f.spring[0]);
          const g = ctx.createLinearGradient(-w * 0.3, 0, w * 0.3, 0);
          g.addColorStop(0, color(i, 0));
          g.addColorStop(0.48, color(i, 0.28));
          g.addColorStop(0.5, color(i, 0.7 + f.high * 0.3));
          g.addColorStop(1, color(i, 0));
          ctx.fillStyle = g;
          ctx.fillRect(-w * 0.5, -h, w, h * 2);
          ctx.restore();
        }
      } else {
        for (let i = 0; i < 8; i++) {
          ctx.beginPath();
          for (let x = 0; x <= w; x += w / 80) {
            let wave = 0;
            for (let j = 0; j < 8; j++) {
              const age = f.beatEvents[j * 4];
              if (age >= 0 && age < 3.5) {
                const d = x / w - (-0.18 + age * 0.58);
                wave +=
                  Math.sin(d * 19 - age * 2) *
                  Math.exp(-d * d * 22) *
                  Math.exp(-age * 0.65) *
                  f.beatEvents[j * 4 + 1];
              }
            }
            const y =
              h *
              (0.35 +
                i * 0.045 +
                Math.sin((x / w) * 5 + t * 0.15 + i * 0.3) * (0.12 + f.mid * 0.1) +
                wave * 0.09);
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = color(i, 0.3);
          ctx.lineWidth = h * (0.04 + f.presence * 0.03);
          ctx.stroke();
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
