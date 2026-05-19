/**
 * Shared MediaPipe FaceLandmarker singleton
 * Used by both faceLandmarkerDetector and occlusionDetector
 * to avoid loading the model twice and to detect multiple faces
 */
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

let landmarker = null

export async function getSharedLandmarker() {
  if (landmarker) return landmarker
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm'
  )
  landmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: '/models/face_landmarker.task',
      delegate: 'GPU'
    },
    runningMode: 'IMAGE',
    numFaces: 3,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: true
  })
  return landmarker
}
