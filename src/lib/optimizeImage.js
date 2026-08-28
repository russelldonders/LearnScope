const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export const COURSE_IMAGE_MAX_INPUT_BYTES = 10 * 1024 * 1024
export const COURSE_IMAGE_TARGET_BYTES = 500 * 1024

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('This browser could not optimise the image.'))),
      type,
      quality,
    )
  })
}

async function loadImage(file) {
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = objectUrl
    await image.decode()
    return image
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export async function optimizeCourseImage(file) {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) throw new Error('Choose a JPEG, PNG, or WebP image.')
  if (file.size > COURSE_IMAGE_MAX_INPUT_BYTES) throw new Error('That image is too large (max 10MB).')

  const image = await loadImage(file)
  const longestEdge = Math.max(image.naturalWidth, image.naturalHeight)
  let scale = Math.min(1, 1600 / longestEdge)
  let quality = 0.82
  let result

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser could not optimise the image.')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    result = await canvasToBlob(canvas, 'image/webp', quality)
    if (result.size <= COURSE_IMAGE_TARGET_BYTES) break
    if (quality > 0.6) quality -= 0.08
    else scale *= 0.8
  }

  return result
}
