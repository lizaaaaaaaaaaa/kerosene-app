// src/utils/compressImage.ts
export async function compressImage(
  file: File,
  maxW = 1280,
  quality = 0.8
): Promise<Blob> {
  const img = await createImageBitmap(file)

  // 横幅が maxW を超える場合だけ縮小する
  const scale = Math.min(1, maxW / img.width)

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('2Dコンテキストの取得に失敗しました')
  }

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (!b) {
          return reject(new Error('画像圧縮に失敗しました'))
        }
        resolve(b)
      },
      'image/jpeg',
      quality
    )
  })
}
