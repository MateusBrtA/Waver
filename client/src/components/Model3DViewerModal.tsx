import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  Box,
  Download,
  Grid,
  ImagePlus,
  Layers,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react';
import { ApiClient, resolveMediaUrl } from '../lib/api';
import { frameCamera, loadModel3D, LoadedModel3D, placeOnGround } from '../lib/model3dLoader';
import { getFileExtension, isTextureLikeName, MODEL_3D_EXTENSIONS } from '../lib/model3dUtils';
import { BlendMetadata, Model3DViewerTarget } from '../types';

interface Model3DViewerModalProps {
  initialTarget?: Model3DViewerTarget | null;
  api?: ApiClient | null;
  serverUrl: string;
  onClose: () => void;
}

type ShadingMode = 'pbr' | 'clay' | 'wireframe' | 'normals';

export const Model3DViewerModal: React.FC<Model3DViewerModalProps> = ({
  initialTarget,
  api,
  serverUrl,
  onClose,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  // URLs de blob dos arquivos locais abertos: liberadas ao trocar de modelo e ao fechar (senão o modelo inteiro fica na memória)
  const blobUrlsRef = useRef<string[]>([]);
  const makeBlobUrl = (f: File) => {
    const u = URL.createObjectURL(f);
    blobUrlsRef.current.push(u);
    return u;
  };
  const revokeBlobUrls = () => {
    for (const u of blobUrlsRef.current) URL.revokeObjectURL(u);
    blobUrlsRef.current = [];
  };
  useEffect(() => revokeBlobUrls, []);
  const [target, setTarget] = useState<Model3DViewerTarget | null>(initialTarget || null);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState('');
  const [blendMeta, setBlendMeta] = useState<BlendMetadata | null>(null);
  const [stats, setStats] = useState<{ vertices: number; triangles: number; meshes: number }>({
    vertices: 0,
    triangles: 0,
    meshes: 0,
  });

  const [shading, setShading] = useState<ShadingMode>('pbr');
  const [showGrid, setShowGrid] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [hasAnimations, setHasAnimations] = useState(false);
  const [animPlaying, setAnimPlaying] = useState(true);

  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    grid: THREE.GridHelper;
    rootObj: THREE.Object3D | null;
    mixer: THREE.AnimationMixer | null;
    originalMats: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
    resetView: () => void;
    loaded: LoadedModel3D | null;
    requestRender: () => void;
  } | null>(null);
  const [missingTextures, setMissingTextures] = useState<string[]>([]);

  const autoRotateRef = useRef(autoRotate);
  const animPlayingRef = useRef(animPlaying);
  useEffect(() => {
    autoRotateRef.current = autoRotate;
    if (sceneRef.current) sceneRef.current.controls.autoRotate = autoRotate;
  }, [autoRotate]);
  useEffect(() => {
    animPlayingRef.current = animPlaying;
  }, [animPlaying]);

  // Setup Three.js WebGL stage once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth || 800, container.clientHeight || 500);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#1e1f22');

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    const camera = new THREE.PerspectiveCamera(
      45,
      Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
      0.01,
      2000
    );
    camera.position.set(3.2, 2.2, 3.8);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.autoRotate = autoRotateRef.current;
    controls.autoRotateSpeed = 1.4;

    const hemi = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.7);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(6, 10, 7);
    scene.add(dir);

    const grid = new THREE.GridHelper(20, 20, 0x5865f2, 0x222736);
    scene.add(grid);

    let needsRender = true;
    const requestRender = () => {
      needsRender = true;
    };
    const resetView = () => {
      frameCamera(camera, controls.target, sceneRef.current?.rootObj || null);
      controls.update();
      requestRender();
    };

    sceneRef.current = {
      scene,
      camera,
      controls,
      grid,
      rootObj: null,
      mixer: null,
      originalMats: new Map(),
      resetView,
      loaded: null,
      requestRender,
    };
    controls.addEventListener('change', requestRender);

    const ro = new ResizeObserver(() => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        requestRender();
      }
    });
    ro.observe(container);

    const clock = new THREE.Clock();
    let raf = 0;
    // Só desenha quando algo muda (câmera, animação, auto-girar): parado, CPU/GPU ficam em ~0
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const dt = clock.getDelta();
      const mixer = sceneRef.current?.mixer;
      const animating = Boolean(mixer && animPlayingRef.current);
      if (animating && mixer) mixer.update(dt);
      const moved = controls.update();
      if (animating || moved || controls.autoRotate || needsRender) {
        needsRender = false;
        renderer.render(scene, camera);
      }
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      sceneRef.current?.loaded?.dispose();
      controls.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
    };
  }, []);

  // Toggle grid visibility
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.grid.visible = showGrid;
      sceneRef.current.requestRender();
    }
  }, [showGrid]);

  // Apply shading mode cleanly (PBR / Clay / Wireframe / Normals)
  useEffect(() => {
    const st = sceneRef.current;
    if (!st || !st.rootObj) return;
    const clayMat = new THREE.MeshStandardMaterial({ color: 0xbac2d4, roughness: 0.55, metalness: 0.08 });
    const normMat = new THREE.MeshNormalMaterial();

    st.rootObj.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const orig = st.originalMats.get(mesh);
        if (!orig) return;

        if (shading === 'clay') {
          mesh.material = clayMat;
        } else if (shading === 'normals') {
          mesh.material = normMat;
        } else {
          mesh.material = orig;
          const mats = Array.isArray(orig) ? orig : [orig];
          for (const m of mats) {
            if ('wireframe' in m) {
              (m as THREE.MeshStandardMaterial).wireframe = shading === 'wireframe';
            }
          }
        }
      }
    });
    st.requestRender();
  }, [shading]);

  // Load 3D asset when target changes
  useEffect(() => {
    if (!target || !sceneRef.current) return;
    let cancelled = false;

    const clearCurrentModel = () => {
      const st = sceneRef.current;
      if (!st) return;
      if (st.rootObj) st.scene.remove(st.rootObj);
      st.loaded?.dispose();
      st.loaded = null;
      st.rootObj = null;
      st.mixer = null;
      st.originalMats.clear();
      setHasAnimations(false);
      st.requestRender();
    };

    (async () => {
      clearCurrentModel();
      setLoading(true);
      setError('');
      setBlendMeta(null);
      setMissingTextures([]);
      setStats({ vertices: 0, triangles: 0, meshes: 0 });
      setStatusText('Carregando cena 3D...');

      try {
        const loaded = await loadModel3D({
          target,
          api,
          serverUrl,
          onStatus: (t) => {
            if (!cancelled) setStatusText(t);
          },
        });
        const st = sceneRef.current;
        if (cancelled || !st) {
          loaded.dispose();
          return;
        }
        if (loaded.blendMeta) setBlendMeta(loaded.blendMeta);
        setMissingTextures(loaded.missingTextures);
        const obj = loaded.object;
        const meshStats = placeOnGround(obj);
        obj.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (mesh.isMesh && mesh.material) st.originalMats.set(mesh, mesh.material);
        });
        st.loaded = loaded;
        st.rootObj = obj;
        st.scene.add(obj);
        if (loaded.clips.length > 0) {
          const mixer = new THREE.AnimationMixer(obj);
          loaded.clips.forEach((clip) => mixer.clipAction(clip).play());
          st.mixer = mixer;
          setHasAnimations(true);
        }
        setStats(meshStats);
        st.resetView();
      } catch (err: unknown) {
        if (!cancelled) {
          const meta = (err as { blendMeta?: BlendMetadata | null }).blendMeta;
          if (meta) setBlendMeta(meta);
          setError((err as Error).message || 'Não foi possível carregar este modelo 3D.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setStatusText('');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [target, api, serverUrl]);

  // Abrir/soltar várias coisas de uma vez: modelo + texturas (.png/.jpg/.mtl/.bin)
  const handleOpenLocalFiles = (files: File[]) => {
    const model = files.find((f) => MODEL_3D_EXTENSIONS.includes(getFileExtension(f.name)));
    const extras = files.filter((f) => isTextureLikeName(f.name));
    if (model) {
      // modelo novo: libera o anterior (o carregamento antigo já terminou ou será descartado)
      revokeBlobUrls();
      const companions = extras.map((f) => ({ name: f.name, url: makeBlobUrl(f) }));
      setTarget({ name: model.name, url: makeBlobUrl(model), ext: getFileExtension(model.name), companions });
      return;
    }
    const companions = extras.map((f) => ({ name: f.name, url: makeBlobUrl(f) }));
    if (companions.length > 0 && target) {
      // Só texturas: recarrega o modelo atual usando-as
      setTarget({ ...target, companions: [...(target.companions || []), ...companions] });
      return;
    }
    if (!target) revokeBlobUrls();
    setError('Escolha um arquivo .blend, .glb, .gltf, .fbx, .obj ou .stl (e, se quiser, as texturas junto).');
  };

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const fl = Array.from(e.dataTransfer.files || []);
        if (fl.length) handleOpenLocalFiles(fl);
      }}
      className="fixed inset-0 z-[130] bg-black/80 flex items-center justify-center p-4"
    >
      <div className="w-[min(1500px,96vw)] h-[92vh] bg-[#1e1f22] rounded-lg shadow-2xl overflow-hidden flex flex-col">
        {/* Top Header */}
        <div className="px-4 py-3 bg-[#2b2d31] border-b border-white/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#ea7600]/20 text-[#fb923c] flex items-center justify-center shrink-0">
              <Box className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white truncate">
                {target ? target.name : 'Visualizador 3D / Blender Studio'}
              </h3>
              <p className="text-[11px] text-[#949ba4] truncate">
                Suporta .blend, .glb, .gltf, .fbx, .obj e .stl • Arraste um modelo ou abra pelo chat
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <label className="px-3 py-1.5 rounded-lg bg-[#383a40] hover:bg-[#5865f2] text-xs font-bold text-white flex items-center gap-1.5 cursor-pointer transition">
              <Upload className="w-3.5 h-3.5" />
              Abrir Arquivo 3D
              <input
                type="file"
                accept=".glb,.gltf,.obj,.fbx,.stl,.blend,.png,.jpg,.jpeg,.webp,.tga,.bmp,.mtl,.bin"
                multiple
                className="hidden"
                onChange={(e) => {
                  const fl = Array.from(e.target.files || []);
                  if (fl.length) handleOpenLocalFiles(fl);
                  e.target.value = '';
                }}
              />
            </label>
            {target && (
              <label
                className="px-3 py-1.5 rounded bg-[#4e5058] hover:bg-[#6d6f78] text-xs font-medium text-white flex items-center gap-1.5 cursor-pointer transition"
                title="Aplicar texturas (mesmo nome de arquivo usado no FBX/OBJ)"
              >
                <ImagePlus className="w-3.5 h-3.5" />
                Texturas
                <input
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,.tga,.bmp,.mtl,.bin"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const fl = Array.from(e.target.files || []);
                    if (fl.length) handleOpenLocalFiles(fl);
                    e.target.value = '';
                  }}
                />
              </label>
            )}
            {target && !target.url.startsWith('blob:') && (
              <a
                href={resolveMediaUrl(serverUrl, target.url)}
                download={target.name}
                className="px-3 py-1.5 rounded-lg bg-[#383a40] hover:bg-[#23a55a] text-xs font-bold text-white flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Baixar
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#949ba4] hover:text-white hover:bg-white/10 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Viewport + Optional .blend Metadata Sidebar */}
        <div className="flex-1 flex min-h-0 relative">
          <div ref={mountRef} className="flex-1 min-w-0 h-full relative">
            {loading && (
              <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2 z-20">
                <Loader2 className="w-8 h-8 animate-spin text-[#fb923c]" />
                <span className="text-xs font-bold text-white">{statusText || 'Processando geometria 3D...'}</span>
              </div>
            )}

            {!target && !loading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 pointer-events-none">
                <Box className="w-14 h-14 text-[#fb923c]/70 mb-3" />
                <p className="text-sm font-bold text-white">Arraste qualquer modelo 3D ou arquivo .blend aqui</p>
                <p className="text-xs text-[#949ba4] max-w-md mt-1">
                  Ou clique em &ldquo;Visualizar em 3D&rdquo; em qualquer arquivo enviado nos canais do chat ou DMs.
                </p>
              </div>
            )}

            {/* Shading & Camera Toolbar */}
            <div className="absolute top-3 left-3 z-10 flex flex-wrap items-center gap-1.5 bg-[#1e1f22]/85 border border-white/10 px-2.5 py-1.5 rounded-lg text-[11px]">
              {(['pbr', 'clay', 'wireframe', 'normals'] as ShadingMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setShading(mode)}
                  className={`px-2 py-1 rounded font-bold uppercase cursor-pointer transition ${
                    shading === mode ? 'bg-[#fb923c] text-[#111214]' : 'text-[#dbdee1] hover:bg-white/10'
                  }`}
                >
                  {mode}
                </button>
              ))}
              <div className="w-px h-4 bg-white/15 mx-0.5" />
              <button
                type="button"
                onClick={() => setShowGrid((v) => !v)}
                className={`p-1.5 rounded cursor-pointer ${showGrid ? 'bg-[#5865f2] text-white' : 'text-[#949ba4]'}`}
                title="Grade"
              >
                <Grid className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setAutoRotate((v) => !v)}
                className={`p-1.5 rounded cursor-pointer ${autoRotate ? 'bg-[#5865f2] text-white' : 'text-[#949ba4]'}`}
                title="Auto-girar"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => sceneRef.current?.resetView()}
                className="p-1.5 rounded text-[#dbdee1] hover:bg-white/10 cursor-pointer"
                title="Centralizar Câmera"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              {hasAnimations && (
                <button
                  type="button"
                  onClick={() => setAnimPlaying((v) => !v)}
                  className="px-2 py-1 rounded bg-[#23a55a] text-white font-bold flex items-center gap-1 cursor-pointer"
                >
                  {animPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                  Anim
                </button>
              )}
            </div>

            {/* Mesh Stats HUD */}
            {stats.meshes > 0 && (
              <div className="absolute bottom-3 left-3 z-10 bg-[#1e1f22]/85 border border-white/10 px-3 py-1.5 rounded-lg text-[11px] font-mono text-[#dbdee1] flex items-center gap-3">
                <span>Meshes: <strong className="text-white">{stats.meshes}</strong></span>
                <span>Vértices: <strong className="text-[#4ade80]">{stats.vertices.toLocaleString()}</strong></span>
                <span>Triângulos: <strong className="text-[#60a5fa]">{stats.triangles.toLocaleString()}</strong></span>
              </div>
            )}

            {missingTextures.length > 0 && !error && (
              <div className="absolute bottom-3 right-3 max-w-sm z-10 bg-[#2b2d31] text-[#dbdee1] px-3 py-2 rounded text-xs shadow-xl">
                <div className="font-semibold mb-1">Texturas não encontradas ({missingTextures.length})</div>
                <div className="text-[#b5bac1] break-words">{missingTextures.slice(0, 6).join(', ')}</div>
                <div className="text-[#949ba4] mt-1">
                  Envie as imagens junto com o modelo (mesma mensagem) ou use o botão &ldquo;Texturas&rdquo;. No Blender,
                  exporte o FBX com <b>Path Mode: Copy</b> + <b>Embed Textures</b>.
                </div>
              </div>
            )}

            {error && (
              <div className="absolute bottom-3 right-3 max-w-md z-10 bg-[#181b26]/95 border border-[#f0b232]/50 text-[#fde68a] px-3.5 py-2.5 rounded-lg text-xs shadow-xl">
                {error}
              </div>
            )}
          </div>

          {/* Blender File Structural Inspector Sidebar (shown for .blend files!) */}
          {blendMeta && (
            <aside className="w-72 shrink-0 bg-[#2b2d31] border-l border-white/10 p-4 overflow-y-auto space-y-4 text-xs">
              <div className="flex items-center gap-2 font-bold text-[#fb923c]">
                <Layers className="w-4 h-4" />
                <span>Estrutura do .blend</span>
              </div>
              <div className="bg-[#1e1f22] rounded-lg p-3 space-y-1.5 border border-white/5">
                <div className="flex justify-between">
                  <span className="text-[#949ba4]">Versão Blender</span>
                  <strong className="text-white font-mono">v{blendMeta.version} ({blendMeta.pointerBits}-bit)</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#949ba4]">Objetos / Meshes</span>
                  <strong className="text-white font-mono">{blendMeta.counts.objects} / {blendMeta.counts.meshes}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#949ba4]">Materiais</span>
                  <strong className="text-white font-mono">{blendMeta.counts.materials}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#949ba4]">Armaduras / Luzes</span>
                  <strong className="text-white font-mono">{blendMeta.counts.armatures} / {blendMeta.counts.lights}</strong>
                </div>
              </div>

              {blendMeta.objectNames.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold uppercase text-[#949ba4] mb-1.5">Objetos na Cena</div>
                  <div className="space-y-1">
                    {blendMeta.objectNames.map((n, i) => (
                      <div key={i} className="px-2 py-1 rounded bg-[#1e1f22] text-[#dbdee1] font-mono text-[11px] truncate">
                        🧊 {n}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {blendMeta.materialNames.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold uppercase text-[#949ba4] mb-1.5">Materiais</div>
                  <div className="flex flex-wrap gap-1">
                    {blendMeta.materialNames.map((n, i) => (
                      <span key={i} className="px-2 py-0.5 rounded bg-[#383a40] text-[#dbdee1] text-[10px]">
                        🎨 {n}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </aside>
          )}
        </div>
      </div>
    </div>
  );
};
