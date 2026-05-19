import { useCallback } from 'react'
import { useApp } from '../context/AppContext'
import { applyFadeEnvelopes, applyFadeOut, decodeAudioFromFile, fitAudioToLength } from '../utils/audioProcessor'

export function useAudioFades() {
  const { state, toast } = useApp()

  const processAudio = useCallback(async (videoFile, keepSegments, outputDuration) => {
    const { audioMode } = state.settings
    if (audioMode === 'Mute') return null

    try {
      const audioBuffer = await decodeAudioFromFile(videoFile)

      if (audioMode === 'SYNC') {
        return await applyFadeEnvelopes(audioBuffer, keepSegments, state.video.fps)
      }

      if (audioMode === 'Separate') {
        const fitted = fitAudioToLength(audioBuffer, outputDuration)
        return await applyFadeOut(fitted, 5)
      }
    } catch (err) {
      toast(`Audio processing failed: ${err.message}. Exporting without audio fades.`, 'warning')
      return null
    }
  }, [state.settings, state.video.fps, toast])

  return { processAudio }
}
