export const MODEL_3D_EXTENSIONS = ['.glb', '.gltf', '.obj', '.fbx', '.stl', '.blend'];

export function is3DModelFilename(name: string): boolean {
  const lower = (name || '').toLowerCase().trim();
  return MODEL_3D_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function getFileExtension(name: string): string {
  const idx = (name || '').lastIndexOf('.');
  return idx >= 0 ? name.slice(idx).toLowerCase() : '';
}

/** Arquivos que acompanham um modelo (texturas, .mtl, .bin) */
export function isTextureLikeName(name: string): boolean {
  return /\.(png|jpe?g|webp|bmp|tga|gif|mtl|bin|ktx2|dds)$/i.test(name || '');
}
