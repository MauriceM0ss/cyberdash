// Turning a picked image file into something storable as an app icon.
//
// Icons set from Settings live in localStorage as data URLs, and the whole
// origin only gets ~5 MB, so everything here is about keeping them small
// without making them look bad.

// A dock icon renders at 34 px and a home tile at 30 px, so 128 covers hi-dpi
// with room to spare.
const MAX_PX = 128
const MAX_FILE = 2 * 1024 * 1024 // reject obviously-wrong files before decoding
const MAX_SVG = 64 * 1024 // SVGs are stored verbatim, so cap the text itself

/**
 * SVGs are kept as-is so they stay crisp at any size; rasters are drawn through
 * a canvas at MAX_PX, which both shrinks them and normalises whatever format
 * came in to PNG.
 */
export async function fileToIcon(file) {
  if (file.size > MAX_FILE) {
    throw new Error('That file is over 2 MB — pick a smaller one.')
  }

  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
    const text = await file.text()
    if (text.length > MAX_SVG) {
      throw new Error('That SVG is too large to store (over 64 KB).')
    }
    // btoa is byte-oriented, so encode to UTF-8 first — SVGs routinely carry
    // non-ASCII in titles and font names, and plain btoa would throw on them.
    return (
      'data:image/svg+xml;base64,' +
      btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    )
  }

  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const scale = Math.min(1, MAX_PX / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.width * scale))
    canvas.height = Math.max(1, Math.round(img.height * scale))
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  } catch {
    throw new Error('Couldn’t read that image.')
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Same emoji-or-image rule the dock, home tiles and settings previews use. */
export function isImageIcon(icon) {
  return /[\/.]/.test(icon || '') && (icon || '').length > 2
}
