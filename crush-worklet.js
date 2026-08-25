// Bus bitcrush for the post-fx panel — same decimation/quantization formulas
// as the per-note crush in synth.js (hold = 1+11·amt samples, 12−8·amt bits),
// but applied to the whole mix as a realtime chain stage.
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
    const amt = parameters.amount[0];
    const hold = 1 + Math.floor(amt * 11);
    const levels = Math.pow(2, 11 - 8 * amt);
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
