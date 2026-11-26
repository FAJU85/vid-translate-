/**
 * A person's round profile picture: their photo when they set one, else the first letter of
 * their @handle on the accent colour.
 */
export function Avatar({ handle, url, className = 'w-9 h-9 text-sm' }: { handle: string; url?: string | null; className?: string }) {
  return url ? (
    <img src={url} alt="" className={`${className} rounded-full object-cover bg-slate-800 shrink-0`} />
  ) : (
    <span className={`${className} rounded-full bg-amber-400 text-slate-950 font-extrabold flex items-center justify-center shrink-0`}>{handle[0]?.toUpperCase()}</span>
  );
}

/** The longest side of a profile photo as uploaded. */
const SIZE = 256;

/**
 * A chosen picture made ready to upload: cropped to a centred square, 256×256, as a JPEG. Drawing
 * it anew also drops everything the camera wrote into the file (place, date, device).
 */
export async function squarePhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
  if (!blob) throw new Error('could not encode');
  return blob;
}
