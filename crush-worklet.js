// Bus bitcrush for the post-fx panel — the same decimation/quantization as
// the per-note crush (crushParams in synth.js), applied to the whole mix as
// a realtime chain stage.
import { crushParams } from './synth.js';

class CrushProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'amount', defaultValue: 0.25, minValue: 0, maxValue: 1 }];
  }

  constructor() {
    super();
    this.state = [];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    const { hold, levels } = crushParams(parameters.amount[0]);
    for (let ch = 0; ch < output.length; ch++) {
      const src = input[ch];
      const dst = output[ch];
      if (!src) continue;
      const s = (this.state[ch] ??= { held: 0, left: 0 });
      for (let i = 0; i < dst.length; i++) {
        if (s.left === 0) {
          s.held = Math.round(src[i] * levels) / levels;
          s.left = hold;
        }
        s.left--;
        dst[i] = s.held;
      }
    }
    return true;
  }
}

registerProcessor('crush', CrushProcessor);
