// Center-crop to a square and resize to maxSize x maxSize, returning a data URL.
// 600x600 JPEG @ 0.85 typically lands at 40–80KB — small enough to store inline.
export async function resizePhoto(file: File, maxSize = 600): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const side = Math.min(img.width, img.height);
    const cropX = (img.width - side) / 2;
    const cropY = (img.height - side) / 2;

    const canvas = document.createElement("canvas");
    canvas.width = maxSize;
    canvas.height = maxSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas_unavailable");
    ctx.drawImage(img, cropX, cropY, side, side, 0, 0, maxSize, maxSize);

    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image_load_failed"));
    img.src = src;
  });
}
