import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Box, Download, Loader2, Maximize2 } from 'lucide-react';
import { ApiClient, resolveMediaUrl } from '../lib/api';
import { frameCamera, loadModel3D, LoadedModel3D, placeOnGround } from '../lib/model3dLoader';
import { Model3DViewerTarget } from '../types';

/**
 * Miniatura 3D no chat (estilo embed de vídeo do YouTube):
 * - carrega só quando aparece na tela, um modelo por vez
 * - mostra um "pôster" estático (sem gastar GPU) e vira interativo ao arrastar
 * - um único WebGLRenderer compartilhado por todas as miniaturas (economiza RAM/VRAM)
 */

const W = 400;
const H = 225;

// ---------- Renderer compartilhado ----------
let sharedRenderer: THREE.WebGLRenderer | null = null;
let sharedEnv: THREE.Texture | null = null;
let liveOwner: symbol | null = null;
const liveReleaseHandlers = new Map<symbol, () => void>();

function getRenderer() {
  if (!sharedRenderer) {
    sharedRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    sharedRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    sharedRenderer.outputColorSpace = THREE.SRGBColorSpace;
    sharedRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    const pmrem = new THREE.PMREMGenerator(sharedRenderer);
    sharedEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }
  return sharedRenderer;
}

function claimLive(owner: symbol) {
  if (liveOwner && liveOwner !== owner) liveReleaseHandlers.get(liveOwner)?.();
  liveOwner = owner;
}

// ---------- Fila de carregamento (um modelo por vez) ----------
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job);
  queue = next.catch(() => undefined);
  return next;
}

// Pôsteres já gerados (sobrevivem a re-render / troca de canal)
const posterCache = new Map<string, string>();

interface Stage {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  model: LoadedModel3D;
}

function buildStage(model: LoadedModel3D): Stage {
  getRenderer();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1e1f22');
  scene.environment = sharedEnv;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x2b2d31, 0.6));
  const dir = new THREE.DirectionalLight(0xffffff, 1.3);
  dir.position.set(5, 9, 6);
  scene.add(dir);
  placeOnGround(model.object);
  scene.add(model.object);
  const camera = new THREE.PerspectiveCamera(40, W / H, 0.01, 2000);
  return { scene, camera, model };
}

interface Props {
  target: Model3DViewerTarget;
  size?: number;
  api?: ApiClient | null;
  serverUrl: string;
  onExpand: (target: Model3DViewerTarget) => void;
}

export const Model3DInlinePreview: React.FC<Props> = ({ target, size, api, serverUrl, onExpand }) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const ownerRef = useRef(Symbol('model-preview'));
  const stageRef = useRef<Stage | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const targetVec = useRef(new THREE.Vector3());
  const cacheKey = `${target.url}|${(target.companions || []).map((c) => c.url).join(',')}`;

  const [poster, setPoster] = useState<string>(() => posterCache.get(cacheKey) || '');
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [live, setLive] = useState(false);

  // Só carrega quando o card entra na tela
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const renderFrame = useCallback(() => {
    const st = stageRef.current;
    if (!st || !sharedRenderer) return;
    controlsRef.current?.update();
    sharedRenderer.render(st.scene, st.camera);
  }, []);

  const releaseStage = useCallback(() => {
    controlsRef.current?.dispose();
    controlsRef.current = null;
    const st = stageRef.current;
    if (st) {
      st.scene.remove(st.model.object);
      st.model.dispose();
    }
    stageRef.current = null;
  }, []);

  // Ao perder o "slot" ao vivo: tira foto do ângulo atual e libera tudo
  const deactivate = useCallback(() => {
    const r = sharedRenderer;
    if (r && stageRef.current) {
      renderFrame();
      try {
        const url = r.domElement.toDataURL('image/webp', 0.85);
        posterCache.set(cacheKey, url);
        setPoster(url);
      } catch {}
      if (r.domElement.parentElement === viewportRef.current) r.domElement.remove();
    }
    releaseStage();
    setLive(false);
    if (liveOwner === ownerRef.current) liveOwner = null;
  }, [cacheKey, releaseStage, renderFrame]);

  useEffect(() => {
    const owner = ownerRef.current;
    liveReleaseHandlers.set(owner, deactivate);
    return () => {
      liveReleaseHandlers.delete(owner);
      if (liveOwner === owner) {
        liveOwner = null;
        if (sharedRenderer?.domElement.parentElement === viewportRef.current) sharedRenderer?.domElement.remove();
      }
      releaseStage();
    };
  }, [deactivate, releaseStage]);

  const loadStage = useCallback(async () => {
    const model = await enqueue(() => loadModel3D({ target, api, serverUrl, onStatus: setStatus }));
    const st = buildStage(model);
    frameCamera(st.camera, targetVec.current, model.object);
    st.camera.lookAt(targetVec.current);
    return st;
  }, [target, api, serverUrl]);

  // Gera o pôster uma vez
  useEffect(() => {
    if (!visible || poster) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const st = await loadStage();
        if (cancelled) {
          st.model.dispose();
          return;
        }
        const r = getRenderer();
        // Não rouba o canvas de uma miniatura que está sendo girada
        const wasLiveElsewhere = liveOwner && liveOwner !== ownerRef.current;
        if (!wasLiveElsewhere) {
          r.setSize(W, H, false);
          r.render(st.scene, st.camera);
          const url = r.domElement.toDataURL('image/webp', 0.85);
          posterCache.set(cacheKey, url);
          setPoster(url);
        } else {
          setPoster('');
        }
        st.scene.remove(st.model.object);
        st.model.dispose();
      } catch (e) {
        if (!cancelled) setError((e as Error).message || 'Falha ao carregar modelo.');
      } finally {
        if (!cancelled) {
          setLoading(false);
          setStatus('');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, poster, loadStage, cacheKey]);

  // Começa a girar: ativa renderer ao vivo dentro do card
  const activate = useCallback(
    async (e: React.PointerEvent) => {
      if (live || loading || error) return;
      const startEvent = { clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId, button: e.button };
      claimLive(ownerRef.current);
      setLoading(true);
      try {
        const st = await loadStage();
        stageRef.current = st;
        const r = getRenderer();
        const vp = viewportRef.current;
        if (!vp) return;
        r.setSize(vp.clientWidth || W, vp.clientHeight || H, false);
        st.camera.aspect = (vp.clientWidth || W) / (vp.clientHeight || H);
        st.camera.updateProjectionMatrix();
        r.domElement.style.width = '100%';
        r.domElement.style.height = '100%';
        r.domElement.style.display = 'block';
        r.domElement.style.touchAction = 'none';
        vp.appendChild(r.domElement);
        const controls = new OrbitControls(st.camera, r.domElement);
        controls.target.copy(targetVec.current);
        controls.enableDamping = false; // render sob demanda: sem loop contínuo
        controls.addEventListener('change', renderFrame);
        controlsRef.current = controls;
        renderFrame();
        setLive(true);
        // Repassa o clique inicial para já começar a girar
        r.domElement.dispatchEvent(
          new PointerEvent('pointerdown', { ...startEvent, bubbles: true, isPrimary: true, pointerType: 'mouse' })
        );
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
        setStatus('');
      }
    },
    [live, loading, error, loadStage, renderFrame]
  );

  const fileUrl = resolveMediaUrl(serverUrl, target.url);
  const sizeLabel = size ? (size > 1048576 ? `${(size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`) : '';

  return (
    <div ref={wrapRef} className="w-[400px] max-w-full rounded-lg overflow-hidden bg-[#2b2d31] border border-[#1e1f22]">
      <div className="flex items-center gap-2.5 px-3 py-2">
        <Box className="w-5 h-5 text-[#b5bac1] shrink-0" />
        <div className="min-w-0 flex-1">
          <a
            href={fileUrl}
            download={target.name}
            className="block text-sm text-[#00a8fc] hover:underline truncate"
            title={target.name}
          >
            {target.name}
          </a>
          <div className="text-xs text-[#949ba4]">
            {sizeLabel ? `${sizeLabel} • ` : ''}Modelo 3D {target.ext.replace('.', '').toUpperCase()}
          </div>
        </div>
        <a
          href={fileUrl}
          download={target.name}
          className="p-1.5 rounded text-[#b5bac1] hover:text-[#dbdee1] hover:bg-[#35373c]"
          title="Baixar"
        >
          <Download className="w-4 h-4" />
        </a>
      </div>

      <div
        ref={viewportRef}
        onPointerDown={live ? undefined : activate}
        className={`group relative w-full aspect-video bg-[#1e1f22] select-none ${live ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
      >
        {!live && poster && <img src={poster} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover" />}

        {(loading || (!poster && !error)) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[#b5bac1] text-xs">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span>{status || 'Carregando prévia 3D...'}</span>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-xs text-[#b5bac1]">
            <Box className="w-8 h-8 text-[#80848e]" />
            <span>{error}</span>
          </div>
        )}

        {!live && poster && !loading && (
          <div className="absolute bottom-2 left-2 px-2 py-1 rounded bg-black/60 text-[11px] text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            Arraste para girar • roda do mouse para zoom
          </div>
        )}

        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (live) deactivate();
            onExpand(target);
          }}
          className="absolute top-2 right-2 p-1.5 rounded bg-black/60 hover:bg-black/80 text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
          title="Abrir em tela cheia"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export default Model3DInlinePreview;
