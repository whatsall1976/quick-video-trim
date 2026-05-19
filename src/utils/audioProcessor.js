/**
 * Generate fade in/out envelopes using Web Audio API GainNode.
 * Returns { applyFades(audioBuffer, keepSegments, fps) => processedBuffer }
 */
export async function applyFadeEnvelopes(audioBuffer, keepSegments, fps) {
  const ctx = new OfflineAudioContext(
    audioBuffer.numberOfChannels,
    audioBuffer.length,
    audioBuffer.sampleRate
  )
  const source = ctx.createBufferSource()
  source.buffer = audioBuffer

  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0, 0)

  const frameDur = 1 / fps

  for (const seg of keepSegments) {
    const startSec = seg.startFrame / fps
    const endSec = seg.endFrame / fps
    const fadeIn = Math.min(frameDur, 0.05)
    const fadeOut = Math.min(frameDur, 0.05)
    gain.gain.setValueAtTime(0, Math.max(0, startSec - 0.001))
    gain.gain.exponentialRampToValueAtTime(1, startSec + fadeIn)
    gain.gain.setValueAtTime(1, Math.max(startSec + fadeIn, endSec - fadeOut))
    gain.gain.exponentialRampToValueAtTime(0.001, endSec)
    gain.gain.setValueAtTime(0, endSec + 0.001)
  }

  source.connect(gain)
  gain.connect(ctx.destination)
  source.start(0)
  return ctx.startRendering()
}

/**
 * Apply a 5-second fade out at the end of an audio buffer.
 */
export async function applyFadeOut(audioBuffer, fadeDuration = 5) {
  const ctx = new OfflineAudioContext(
    audioBuffer.numberOfChannels,
    audioBuffer.length,
    audioBuffer.sampleRate
  )
  const source = ctx.createBufferSource()
  source.buffer = audioBuffer
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(1, 0)

  const totalSec = audioBuffer.duration
  const fadeStart = Math.max(0, totalSec - fadeDuration)
  gain.gain.setValueAtTime(1, fadeStart)
  gain.gain.exponentialRampToValueAtTime(0.001, totalSec - 0.01)

  source.connect(gain)
  gain.connect(ctx.destination)
  source.start(0)
  return ctx.startRendering()
}

/**
 * Decode audio from a File using the Web Audio API.
 */
export async function decodeAudioFromFile(file) {
  const ctx = new AudioContext()
  const arrayBuffer = await file.arrayBuffer()
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
  await ctx.close()
  return audioBuffer
}

/**
 * Trim or pad an AudioBuffer to targetDuration seconds.
 */
export function fitAudioToLength(audioBuffer, targetDuration) {
  const sr = audioBuffer.sampleRate
  const targetSamples = Math.ceil(targetDuration * sr)
  const channels = audioBuffer.numberOfChannels
  const out = new AudioBuffer({ numberOfChannels: channels, length: targetSamples, sampleRate: sr })
  for (let c = 0; c < channels; c++) {
    const src = audioBuffer.getChannelData(c)
    const dst = out.getChannelData(c)
    dst.set(src.subarray(0, Math.min(src.length, targetSamples)))
  }
  return out
}
