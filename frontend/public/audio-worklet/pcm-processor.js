// PCM Processor AudioWorklet
// Captures raw audio data and converts to 16-bit PCM for streaming STT

class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 512;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input.length > 0) {
      const channelData = input[0];
      const output = outputs[0][0];

      for (let i = 0; i < channelData.length; i++) {
        const sample = channelData[i];

        // Output silence — never monitor the mic back to the speakers (prevents echo).
        if (output) output[i] = 0;

        // Buffer for PCM conversion
        this.buffer[this.bufferIndex++] = sample;

        if (this.bufferIndex >= this.bufferSize) {
          // Convert float32 to int16 PCM
          const pcmData = new Int16Array(this.bufferSize);
          for (let j = 0; j < this.bufferSize; j++) {
            const s = Math.max(-1, Math.min(1, this.buffer[j]));
            pcmData[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }

          // Send PCM data to main thread
          this.port.postMessage({ pcmData: pcmData.buffer }, [pcmData.buffer]);
          this.bufferIndex = 0;
        }
      }
    }

    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);