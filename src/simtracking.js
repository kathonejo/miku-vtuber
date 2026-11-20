/**
 * Seguimiento simulado (sin cámara) para probar un personaje: activar con `?sim=1`.
 * Devuelve los mismos valores que entrega la cámara, en un guion de 20 s que se repite:
 * parpadeos, inclinación de cabeza a los dos lados, giro y movimiento combinado.
 * No hay boca ni cejas: la boca se queda quieta y las cejas no se usan.
 */

export const SIM_PERIOD = 20;
const OPEN = 0.05;
const CLOSED = 0.9;

function pulse(t, a, b, ramp = 0.12) {
  if (t <= a || t >= b) return 0;
  return Math.min(1, (t - a) / ramp, (b - t) / ramp);
}

export function simTargets(timeSec) {
  const t = ((timeSec % SIM_PERIOD) + SIM_PERIOD) % SIM_PERIOD;
  // parpadeos (0.18 s cada uno), solos y en tanda
  const blink = Math.max(
    pulse(t, 1.2, 1.38, 0.05), pulse(t, 3.0, 3.18, 0.05), pulse(t, 3.5, 3.68, 0.05),
    pulse(t, 8.8, 8.98, 0.05), pulse(t, 13.4, 13.58, 0.05), pulse(t, 17.6, 17.78, 0.05), pulse(t, 18.9, 19.08, 0.05),
  );
  let roll = 0;
  let yaw = 0;
  // 4–10 s: inclinación a izquierda y derecha (rebote de orejas)
  if (t > 4 && t < 10) roll = 1.0 * Math.sin((t - 4) * 1.6) * Math.min(1, (t - 4) / 0.6, (10 - t) / 0.6);
  if (t > 4 && t < 10) yaw = 0.3 * Math.sin((t - 4) * 1.6 + 0.8);
  // 10–16 s: giro a izquierda y derecha
  if (t > 10 && t < 16) yaw = 0.8 * Math.sin((t - 10) * 1.5) * Math.min(1, (t - 10) / 0.6, (16 - t) / 0.6);
  if (t > 10 && t < 16) roll = 0.6 * Math.sin((t - 10) * 1.5 + 1) * Math.min(1, (t - 10) / 0.6, (16 - t) / 0.6);
  const pitch = 0.2 * Math.sin(t * 0.9);
  const raw = OPEN + (CLOSED - OPEN) * blink;
  return {
    yaw, pitch, roll,
    jaw: 0, jawLive: 0,
    gazeX: 0.5 * Math.sin(t * 0.8), gazeY: 0.2 * Math.sin(t * 0.6),
    blinkL: blink, blinkR: blink,
    blinkRawL: raw, blinkRawR: raw, blinkOpenL: OPEN, blinkOpenR: OPEN, calibReady: true,
    smile: 0,
  };
}
