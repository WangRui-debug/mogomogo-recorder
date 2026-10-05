'use strict';

class LiveSpectrum {
  constructor() {
    this.canvas = document.getElementById('frequency-canvas');
    this.status = document.getElementById('frequency-status');
    this.mode = 'spectrogram';
    this.analyser = null;
    this.lastFrame = 0;
    this.lastColumn = 0;
    this.history = document.createElement('canvas');
    this.history.width = 180;
    this.history.height = 128;
    this.historyContext = this.history.getContext('2d');
    this.column = this.historyContext.createImageData(1, 128);
    // Fixed six-second history, independent of display width and refresh rate.
    this.palette = Array.from({length: 256}, (_, index) => {
      const stops = [[24, 33, 39], [27, 110, 112], [77, 191, 153], [255, 217, 93]];
      const position = index / 255 * 3, start = Math.min(2, Math.floor(position));
      return stops[start].map((value, channel) => Math.round(value + (stops[start + 1][channel] - value) * (position - start)));
    });
    document.querySelectorAll('[data-frequency-view]').forEach((button) => {
      button.addEventListener('click', () => {
        this.mode = button.dataset.frequencyView;
        document.querySelectorAll('[data-frequency-view]').forEach((item) => {
          item.setAttribute('aria-pressed', String(item === button));
        });
        this.canvas.setAttribute('aria-label', this.mode === 'spectrum' ? 'マイク入力の周波数スペクトル' : 'マイク入力の直近6秒のスペクトログラム');
        document.getElementById('frequency-legend').hidden = this.mode !== 'spectrogram';
        this.lastFrame = 0;
      });
    });
  }

  peak(low, high, binHz) {
    const start = Math.max(0, Math.min(this.data.length - 1, Math.floor(low / binHz)));
    const end = Math.min(this.data.length - 1, Math.max(start, Math.ceil(high / binHz) - 1));
    let value = -100;
    for (let bin = start; bin <= end; bin++) value = Math.max(value, this.data[bin]);
    return Math.min(0, value);
  }

  draw(analyser, sampleRate, phase, now = performance.now()) {
    if (this.analyser !== analyser) {
      this.analyser = analyser;
      this.data = analyser ? new Float32Array(analyser.frequencyBinCount) : null;
      this.historyContext.clearRect(0, 0, 180, 128);
      this.lastColumn = now;
      this.lastFrame = 0;
    }
    if (now - this.lastFrame < 1000 / 30) return;
    this.lastFrame = now;
    const active = analyser && analyser.context.state === 'running';
    const label = !analyser ? 'マイク未接続' : active ? (phase === 'recording' ? '録音中' : 'モニター中') : 'マイク一時停止';
    if (this.status.textContent !== label) this.status.textContent = label;
    const maxHz = Math.min(8000, (sampleRate || 48000) / 2);
    const binHz = analyser ? sampleRate / analyser.fftSize : 1;
    if (active) analyser.getFloatFrequencyData(this.data);
    if (active && now - this.lastColumn >= 1000 / 30) {
      const elapsed = Math.floor((now - this.lastColumn) / (1000 / 30));
      const shift = Math.min(180, elapsed);
      this.lastColumn += elapsed * (1000 / 30);
      this.historyContext.drawImage(this.history, -shift, 0);
      this.historyContext.clearRect(180 - shift, 0, shift, 128);
      for (let row = 0; row < 128; row++) {
        const db = this.peak((127 - row) / 128 * maxHz, (128 - row) / 128 * maxHz, binHz);
        const color = this.palette[Math.round(Math.max(0, Math.min(1, (db + 100) / 80)) * 255)];
        this.column.data.set([...color, 255], row * 4);
      }
      this.historyContext.putImageData(this.column, 179, 0);
    } else if (!active) {
      this.historyContext.clearRect(0, 0, 180, 128);
      this.lastColumn = now;
    }

    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    if (!width || !height) return;
    const scale = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvas.width !== Math.round(width * scale) || this.canvas.height !== Math.round(height * scale)) {
      this.canvas.width = Math.round(width * scale);
      this.canvas.height = Math.round(height * scale);
    }
    const ctx = this.canvas.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.font = '11px sans-serif';
    const left = 36, top = 17, plotWidth = width - left - 12, plotHeight = height - top - 25;
    const heatmap = this.mode === 'spectrogram';
    ctx.fillStyle = heatmap ? '#182127' : '#ffffff';
    ctx.fillRect(left, top, plotWidth, plotHeight);
    if (heatmap && active) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.history, left, top, plotWidth, plotHeight);
    }
    ctx.lineWidth = 1;
    for (let index = 0; index <= 4; index++) {
      const y = top + index / 4 * plotHeight;
      ctx.strokeStyle = heatmap ? '#ffffff20' : '#e0e6e4';
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + plotWidth, y); ctx.stroke();
      ctx.fillStyle = '#576560'; ctx.textAlign = 'right';
      ctx.fillText(heatmap ? String((maxHz / 1000 * (1 - index / 4)).toFixed(0)) : String(-index * 25), left - 6, y + 4);
    }
    ctx.textAlign = 'left'; ctx.fillStyle = '#576560';
    ctx.fillText(heatmap ? 'kHz' : 'dB', 0, 10);
    for (let index = 0; index <= 3; index++) {
      ctx.textAlign = index === 3 ? 'right' : index === 0 ? 'left' : 'center';
      const label = heatmap ? `${-6 + index * 2}${index === 3 ? ' s' : ''}` : `${(maxHz / 1000 * index / 3).toFixed(1)}${index === 3 ? ' kHz' : ''}`;
      ctx.fillText(label, left + index / 3 * plotWidth, height - 6);
    }
    if (!heatmap && active) {
      ctx.strokeStyle = '#177467'; ctx.lineWidth = 1.5; ctx.beginPath();
      for (let x = 0; x <= plotWidth; x++) {
        const value = this.peak(x / plotWidth * maxHz, (x + 1) / plotWidth * maxHz, binHz);
        const y = top + -value / 100 * plotHeight;
        if (!x) ctx.moveTo(left + x, y); else ctx.lineTo(left + x, y);
      }
      ctx.stroke();
    }
  }
}

const liveSpectrum = new LiveSpectrum();
