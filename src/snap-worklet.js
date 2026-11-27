/*
 * Jentik Debu — AudioWorklet pendengar jentikan.
 * Input 2 kanal: [0] suara penuh, [1] suara frekuensi tinggi (high-pass).
 * Tiap render quantum (128 sampel) dihitung RMS-nya, dikirim per 4 quantum
 * sebagai pasangan [rmsTinggi, rmsPenuh, ...] ke skrip halaman.
 */
class JentikSnapProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(8);
    this.n = 0;
  }
  process(inputs) {
    const inp = inputs[0];
    if (inp && inp.length) {
      const full = inp[0], hi = inp[1] || inp[0];
      let eh = 0, ef = 0;
      for (let i = 0; i < hi.length; i++) { eh += hi[i] * hi[i]; ef += full[i] * full[i]; }
      this.buf[this.n * 2] = Math.sqrt(eh / hi.length);
      this.buf[this.n * 2 + 1] = Math.sqrt(ef / full.length);
      if (++this.n === 4) {
        this.port.postMessage({ rms: this.buf.slice(), sub: hi.length });
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('jentik-snap', JentikSnapProcessor);
