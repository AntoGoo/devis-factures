export const LOGO_MAX_SIDE = 400;
export const LOGO_MAX_CHARS = 280_000;

export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Redimensionne dans le navigateur ; refuse au-delà de ~200 Ko. */
export async function fileToLogoDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const size = fitWithin(bitmap.width, bitmap.height, LOGO_MAX_SIDE);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, size.width, size.height);
  const attempts = file.type === 'image/png' ? [canvas.toDataURL('image/png'), canvas.toDataURL('image/jpeg', 0.85)] : [canvas.toDataURL('image/jpeg', 0.85), canvas.toDataURL('image/jpeg', 0.7)];
  const ok = attempts.find((d) => d.length <= LOGO_MAX_CHARS);
  if (!ok) throw new Error('Ce logo reste trop lourd après réduction. Essayez une image plus simple.');
  return ok;
}
