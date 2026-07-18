/**
 * Downscales an image file client-side before upload. A phone photo can be
 * 4-8 MB straight off the camera, but a menu thumbnail never needs more than
 * ~1600px on the long edge — campus uplink is the bottleneck, not storage.
 * Falls back to the original file untouched on any decode/canvas failure
 * (unsupported format, browser quirk) rather than blocking the upload.
 */
export async function downscaleImage(file: File, maxEdge = 1600, quality = 0.8): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1) {
      bitmap.close();
      return file; // already within budget
    }
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) return file;
    const resizedName = file.name.replace(/\.\w+$/, '') + '.jpg';
    return new File([blob], resizedName, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}
