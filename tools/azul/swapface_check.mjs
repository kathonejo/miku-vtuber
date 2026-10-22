import { createMouthGate, createEyeGate, normalizeSwap } from '../../src/swapface.js';
const cfg = normalizeSwap({});
const g = createMouthGate(() => cfg.mouth);
const dt = 1/60; let line=''; let flips=0, prev=false;
for (let i=0;i<180;i++){ const t=i*dt;
  // habla: sílabas a 5 Hz, valles no nulos, amplitud variable
  const s = 0.05 + 0.25*Math.max(0,Math.sin(2*Math.PI*5*t))*(0.6+0.4*Math.sin(2*Math.PI*0.7*t));
  const o=g.step(s,dt); if(o!==prev){flips++;prev=o;} line+=o?'█':'·'; }
console.log('boca 3s habla 5Hz:', flips, 'cambios'); console.log(line);
// habla suave, amplitud baja
g.reset(); line=''; flips=0; prev=false;
for (let i=0;i<120;i++){ const t=i*dt; const s=0.03+0.09*Math.max(0,Math.sin(2*Math.PI*4*t)); const o=g.step(s,dt); if(o!==prev){flips++;prev=o;} line+=o?'█':'·'; }
console.log('suave 4Hz:', flips); console.log(line);
// silencio con ruido
g.reset(); line=''; flips=0; prev=false;
for (let i=0;i<120;i++){ const s=0.02+0.02*Math.random(); const o=g.step(s,dt); if(o!==prev){flips++;prev=o;} }
console.log('silencio ruido:', flips);
globalThis.localStorage = { d:{}, getItem(k){return this.d[k]??null}, setItem(k,v){this.d[k]=v}, removeItem(k){delete this.d[k]} };
const e = createEyeGate(() => cfg.eyes); e.bind('azul');
let l='', r='';
for (let i=0;i<300;i++){ const t=i*dt;
  // base abierta 0.12 (izq) 0.2 (der, persona con ojo más cerrado); parpadeos con pico 0.55
  const bl = (t%1.2)<0.15 ? 0.55 : 0.12; const br = (t%1.2)<0.15 ? 0.6 : 0.2;
  const res = e.step({face:true, blinkRawL: bl + (t>3.6&&t<4.2?0.4:0), blinkRawR: br, blinkOpenL:0.12, blinkOpenR:0.2, calibReady:true, calibEpoch:0}, {independentWink:true}, dt);
  l+=res.closedL?'█':'·'; r+=res.closedR?'█':'·'; }
console.log('ojo L'); console.log(l); console.log('ojo R'); console.log(r);
console.log('refs', e.state.refL.toFixed(3), e.state.refR.toFixed(3), localStorage.d);
