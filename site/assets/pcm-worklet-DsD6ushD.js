// Runs on the audio thread: hands each block of microphone samples to the page, which keeps them in memory
// while recording. Nothing here stores, uploads or plays anything.
/* global AudioWorkletProcessor, registerProcessor */
class NabraPcmTap extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor('nabra-pcm-tap', NabraPcmTap);
