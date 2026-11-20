/**
 * Seguimiento simulado (sin cámara) para probar un personaje: activar con `?sim=1`.
 * Devuelve los mismos valores que entrega la cámara, en un guion de 26 s que se repite:
 * parpadeos, boca cerrada / media / abierta, cejas arriba, inclinación y giro de cabeza.
 */

const PERIOD = 26;
const OPEN = 0.05;
const CLOSED = 0.9;

function pulse(t, a, b, ramp = 0.12) {
  if (t <= a || t >= b) return 0;
  return Math.min(1, (t - a) / ramp, (b - t) / ramp);
}

export function simTargets(timeSec) {
  const t = ((timeSec % PERIOD) + PERIOD) % PERIOD;
  // parpadeos (0.18 s cada uno)
  const blink = Math.max(pulse(t, 2.4, 2.58, 0.05), pulse(t, 3.9, 4.08, 0.05), pulse(t, 21.2, 21.38, 0.05));
  // boca: cerrada -> media -> abierta -> media -> cerrada, y luego hablando
  let jaw = 0;
  jaw += 0.2 * pulse(t, 5, 6.4, 0.1);
  jaw += 0.62 * pulse(t, 6.6, 8, 0.1);
  jaw += 0.2 * pulse(t, 8.2, 9.4, 0.1);
  if (t > 10 && t < 13) jaw = Math.max(jaw, 0.1 + 0.3 * Math.abs(Math.sin((t - 10) * 7)) + 0.25 * (Math.sin((t - 10) * 3) > 0 ? 1 : 0));
  if (t > 21.5 && t < 25) jaw = Math.max(jaw, 0.08 + 0.55 * Math.abs(Math.sin((t - 21.5) * 5.5)));
  // cejas
  const brow = pulse(t, 14, 16.5, 0.25);
  // cabeza: inclinación a ambos lados, y luego giro
  let roll = 0;
  let yaw = 0;
  let pitch = 0;
  if (t > 16.8 && t < 21) roll = 0.95 * Math.sin((t - 16.8) * 1.6);
  if (t > 21 && t < 26) yaw = 0.8 * Math.sin((t - 21) * 1.5);
  if (t > 21 && t < 26) roll = 0.5 * Math.sin((t - 21) * 1.5 + 1);
  if (t > 16.8 && t < 21) yaw = 0.35 * Math.sin((t - 16.8) * 1.6 + 0.8);
  pitch = 0.2 * Math.sin(t * 0.9);
  const raw = OPEN + (CLOSED - OPEN) * blink;
  return {
    yaw, pitch, roll,
    jaw, jawLive: jaw,
    browUp: brow,
    gazeX: 0.5 * Math.sin(t * 0.8), gazeY: 0.2 * Math.sin(t * 0.6),
    blinkL: blink, blinkR: blink,
    blinkRawL: raw, blinkRawR: raw, blinkOpenL: OPEN, blinkOpenR: OPEN, calibReady: true,
    smile: 0,
  };
}
