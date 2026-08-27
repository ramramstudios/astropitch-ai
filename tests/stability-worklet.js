/**
 * Test-only render-quantum watch. Lives in tests/, not src/audio/:
 * AudioWorklet on mobile WebViews is an unresolved risk (see
 * research/audio-implementation-plan.md) and this processor is only
 * ever loaded by tests/stability.test.html.
 *
 * A healthy graph calls process() once per 128-sample quantum, and
 * currentFrame advances by exactly that amount between calls. A larger
 * jump is a starved render: the audio thread missed one or more
 * callbacks. That is the dropout a listener hears as a crackle, which
 * an OfflineAudioContext can never produce.
 */
const QUANTUM = 128;

class QuantumWatch extends AudioWorkletProcessor {
  constructor() {
    super();
    this._reset();
    this.port.onmessage = (e) => {
      if (e.data?.type === 'reset') {
        this._reset();
        this.port.postMessage({ type: 'reset-ack' });
      } else if (e.data?.type === 'flush') this._flush();
    };
  }

  _reset() {
    this.lastFrame = null;
    this.calls = 0;
    this.drops = [];
    this.skippedFrames = 0;
  }

  _flush() {
    this.port.postMessage({
      type: 'report',
      calls: this.calls,
      drops: this.drops,
      skippedFrames: this.skippedFrames,
      lastFrame: this.lastFrame,
    });
  }

  process() {
    this.calls++;
    if (this.lastFrame != null) {
      const jump = currentFrame - this.lastFrame;
      if (jump > QUANTUM) {
        const skipped = jump - QUANTUM;
        const drop = { currentTime, currentFrame, skippedFrames: skipped };
        this.drops.push(drop);
        this.skippedFrames += skipped;
        this.port.postMessage({ type: 'drop', ...drop });
      }
    }
    this.lastFrame = currentFrame;
    return true;
  }
}

registerProcessor('quantum-watch', QuantumWatch);
