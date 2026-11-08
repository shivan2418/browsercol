import { expect, test } from 'vitest';
import { frameStats, meterText } from './fps-meter';

test('a steady 60 Hz second shows 60 fps and its longest frame', () => {
  const second = Array.from({ length: 60 }, () => 1000 / 60);
  expect(frameStats(second)).toEqual({ fps: 60, worst: 17 });
});

test('a stutter shows in the worst frame and lowers the frame rate', () => {
  const second = [...Array.from({ length: 50 }, () => 16.7), 50, 115];
  const stats = frameStats(second);
  expect(stats.worst).toBe(115);
  expect(stats.fps).toBe(52);
});

test('no frames yet shows zero, not a division by zero', () => {
  expect(frameStats([])).toEqual({ fps: 0, worst: 0 });
});

test('the text names the frame rate, the worst frame and the renderer', () => {
  expect(meterText({ fps: 58, worst: 33 }, 'pixi')).toBe('58 fps · worst 33 ms · pixi');
});
