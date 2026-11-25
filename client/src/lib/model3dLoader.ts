import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { ApiClient, resolveMediaUrl } from './api';
import { getFileExtension } from './model3dUtils';
import { BlendMetadata, Model3DViewerTarget } from '../types';

export interface LoadedModel3D {
  object: THREE.Object3D;
  clips: THREE.AnimationClip[];
  blendMeta: BlendMetadata | null;
  missingTextures: string[];
  dispose: () => void;
}

export interface LoadModelOptions {
  target: Model3DViewerTarget;
  api?: ApiClient | null;
  serverUrl: string;
  onStatus?: (text: string) => void;
}

const baseName = (u: string) => {
  try {
    const clean = decodeURIComponent(u.split('?')[0].split('#')[0]);
    return clean.split(/[\\/]/).pop()!.toLowerCase();
  } catch {
    return u.split(/[\\/]/).pop()!.toLowerCase();
  }
};

/** Remove o prefixo "timestamp-hash-" que o servidor adiciona aos uploads */
const stripUploadPrefix = (n: string) => n.replace(/^\d{10,}-[0-9a-f]{6,}-?/i, '');

/**
 * Carrega qualquer formato suportado e devolve um Object3D pronto para a cena.
 * - .blend: converte via Blender do Host (ou deste PC) para GLB, com texturas embutidas
 * - .fbx/.obj/.gltf: resolve texturas pelos arquivos enviados junto (mesmo nome de arquivo)
 * - texturas ausentes são removidas (o modelo aparece com a cor do material, não preto)
 */
export async function loadModel3D({ target, api, serverUrl, onStatus }: LoadModelOptions): Promise<LoadedModel3D> {
  const ext = target.ext || getFileExtension(target.name);
  const objectUrls: string[] = [];
  const missing = new Set<string>();

  // Mapa nome-de-arquivo -> URL real (texturas enviadas junto)
  const companionMap = new Map<string, string>();
  for (const c of target.companions || []) {
    const resolved = resolveMediaUrl(serverUrl, c.url);
    const n = c.name.toLowerCase();
    companionMap.set(n, resolved);
    companionMap.set(stripUploadPrefix(n), resolved);
    // sem extensão também (FBX às vezes referencia .tga mas o usuário enviou .png)
    companionMap.set(n.replace(/\.[^.]+$/, ''), resolved);
  }

  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    if (companionMap.size === 0) return url;
    const b = baseName(url);
    return companionMap.get(b) || companionMap.get(b.replace(/\.[^.]+$/, '')) || url;
  });
  manager.onError = (url) => missing.add(baseName(url));
  // Contador próprio de itens pendentes (texturas começam a carregar depois do arquivo principal)
  let pending = 0;
  let idleWaiters: (() => void)[] = [];
  const origStart = manager.itemStart.bind(manager);
  const origEnd = manager.itemEnd.bind(manager);
  manager.itemStart = (url: string) => {
    pending++;
    origStart(url);
  };
  manager.itemEnd = (url: string) => {
    pending = Math.max(0, pending - 1);
    origEnd(url);
    if (pending === 0) {
      const w = idleWaiters;
      idleWaiters = [];
      w.forEach((fn) => fn());
    }
  };

  let blendMeta: BlendMetadata | null = null;
  let urlToLoad = resolveMediaUrl(serverUrl, target.url);
  let loadExt = ext;

  if (ext === '.blend') {
    onStatus?.('Convertendo .blend com o Blender...');
    let converted = false;
    let conversionError = '';
    if (api && !target.url.startsWith('blob:')) {
      try {
        const conv = await api.convertBlendUrl(target.url);
        if (conv.metadata) blendMeta = conv.metadata;
        if (conv.conversionError) conversionError = conv.conversionError;
        if (conv.convertedGlbUrl) {
          urlToLoad = resolveMediaUrl(serverUrl, conv.convertedGlbUrl);
          loadExt = '.glb';
          converted = true;
        }
      } catch (e) {
        conversionError = (e as Error).message;
      }
    }
    if (!converted && window.electronAPI?.convertLocalBlend) {
      onStatus?.('Convertendo com o Blender deste PC...');
      const fetched = await fetch(urlToLoad);
      const buf = await fetched.arrayBuffer();
      const localRes = await window.electronAPI.convertLocalBlend({ bytes: buf, fileName: target.name });
      if (localRes.metadata && !blendMeta) blendMeta = localRes.metadata;
      if (localRes.glbBytes) {
        const blob = new Blob([new Uint8Array(localRes.glbBytes)], { type: 'model/gltf-binary' });
        urlToLoad = URL.createObjectURL(blob);
        objectUrls.push(urlToLoad);
        loadExt = '.glb';
        converted = true;
      } else if (localRes.error) {
        conversionError = localRes.error;
      }
    }
    if (!converted) {
      const err = new Error(
        conversionError
          ? `Não foi possível converter o .blend: ${conversionError}`
          : 'Para abrir arquivos .blend é preciso ter o Blender instalado no PC do Host ou neste PC (Steam, site oficial ou Microsoft Store).'
      );
      (err as Error & { blendMeta?: BlendMetadata | null }).blendMeta = blendMeta;
      throw err;
    }
  }

  onStatus?.('Carregando geometria...');
  let object: THREE.Object3D;
  let clips: THREE.AnimationClip[] = [];

  if (loadExt === '.glb' || loadExt === '.gltf') {
    const gltf = await new GLTFLoader(manager).loadAsync(urlToLoad);
    object = gltf.scene;
    clips = gltf.animations || [];
  } else if (loadExt === '.obj') {
    const loader = new OBJLoader(manager);
    const mtlEntry = [...companionMap.entries()].find(([k]) => k.endsWith('.mtl'));
    if (mtlEntry) {
      try {
        const mtl = await new MTLLoader(manager).loadAsync(mtlEntry[1]);
        mtl.preload();
        loader.setMaterials(mtl);
      } catch {}
    }
    object = await loader.loadAsync(urlToLoad);
  } else if (loadExt === '.fbx') {
    const fbx = await new FBXLoader(manager).loadAsync(urlToLoad);
    object = fbx;
    clips = fbx.animations || [];
  } else if (loadExt === '.stl') {
    const geo = await new STLLoader(manager).loadAsync(urlToLoad);
    geo.computeVertexNormals();
    object = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xb5bac1, roughness: 0.5, metalness: 0.1 }));
  } else {
    throw new Error(`Formato ${ext} não suportado.`);
  }

  // Espera texturas terminarem (ou falharem) antes de limpar as quebradas
  if (pending > 0) {
    onStatus?.('Carregando texturas...');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 8000);
      idleWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  normalizeMaterials(object);

  const dispose = () => {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (!m) continue;
        for (const v of Object.values(m)) {
          if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose();
        }
        m.dispose();
      }
    });
    objectUrls.forEach((u) => URL.revokeObjectURL(u));
  };

  return { object, clips, blendMeta, missingTextures: [...missing], dispose };
}

/** Texturas que não carregaram deixam o material preto: remove o mapa e mantém a cor base. */
function normalizeMaterials(root: THREE.Object3D) {
  const isBroken = (t: THREE.Texture | null | undefined) => {
    if (!t) return false;
    const img = t.image as (HTMLImageElement & { width?: number }) | ImageBitmap | undefined | null;
    if (!img) return true;
    const w = (img as HTMLImageElement).naturalWidth ?? (img as ImageBitmap).width;
    return !w;
  };
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m) continue;
      const anyM = m as THREE.MeshStandardMaterial & THREE.MeshPhongMaterial;
      for (const key of ['map', 'normalMap', 'bumpMap', 'specularMap', 'emissiveMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap'] as const) {
        const tex = (anyM as unknown as Record<string, THREE.Texture | null>)[key];
        if (tex && isBroken(tex)) {
          (anyM as unknown as Record<string, THREE.Texture | null>)[key] = null;
          m.needsUpdate = true;
        }
      }
      if (anyM.map) anyM.map.colorSpace = THREE.SRGBColorSpace;
    }
  });
}

/** Centraliza no chão (XZ) e devolve estatísticas da malha */
export function placeOnGround(obj: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(obj);
  const center = box.getCenter(new THREE.Vector3());
  obj.position.x -= center.x;
  obj.position.z -= center.z;
  obj.position.y -= box.min.y;
  let vertices = 0;
  let triangles = 0;
  let meshes = 0;
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshes++;
    const geo = mesh.geometry;
    const pos = geo?.attributes?.position;
    if (pos) vertices += pos.count;
    triangles += geo?.index ? Math.round(geo.index.count / 3) : pos ? Math.round(pos.count / 3) : 0;
  });
  return { vertices, triangles, meshes };
}

export function frameCamera(camera: THREE.PerspectiveCamera, target: THREE.Vector3, obj: THREE.Object3D | null) {
  if (!obj) {
    camera.position.set(3.2, 2.2, 3.8);
    target.set(0, 0.5, 0);
    return;
  }
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.25);
  const dist = maxDim * 1.9;
  camera.position.set(center.x + dist * 0.72, center.y + dist * 0.48, center.z + dist * 0.85);
  target.copy(center);
  camera.near = Math.max(0.005, dist / 500);
  camera.far = Math.max(500, dist * 50);
  camera.updateProjectionMatrix();
}
