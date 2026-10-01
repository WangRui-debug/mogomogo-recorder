class PcmRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = false;
    this.buffer = new Float32Array(4096);
    this.offset = 0;
    this.frames = 0;
    this.port.onmessage = ({data}) => {
      if (data.type === 'start') {
        this.offset = 0;
        this.frames = 0;
        this.active = true;
        this.port.postMessage({type: 'started'});
      } else if (data.type === 'stop') {
        this.active = false;
        this.flush();
        this.port.postMessage({type: 'stopped', frames: this.frames});
      }
    };
  }
  flush() {
    if (!this.offset) return;
    const chunk = this.buffer.slice(0, this.offset);
    this.port.postMessage({type: 'chunk', samples: chunk}, [chunk.buffer]);
    this.offset = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels || !channels.length || !this.active) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i];
      this.buffer[this.offset++] = sample / channels.length;
      this.frames++;
      if (this.offset === this.buffer.length) this.flush();
    }
    return true;
  }
}
registerProcessor('pcm-recorder', PcmRecorder);
