// The 3D part of scenes 01–02, in plain three.js on a <canvas>. Every frame is rendered synchronously from
// useCurrentFrame() — nothing animates by itself — so Remotion can render frames in any order.
// (Plain three.js rather than @react-three/fiber: one mesh group, imperative camera; fewer moving parts.)
import { useLayoutEffect, useRef } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import * as THREE from 'three';
import { buildDuct } from './duct';
import { studioEnvironment } from './studio';
import { FOV, lightAt, poseAt } from './rig';
import type { Format } from '../lib/layout';

type Stage = { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera };

export const DuctScene = ({ format }: { format: Format }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<Stage | null>(null);
  const t = frame / fps;
  const light = lightAt(t, format);

  useLayoutEffect(() => {
    const renderer = new THREE.WebGLRenderer({ canvas: canvas.current!, antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    scene.environment = studioEnvironment(renderer);
    scene.add(buildDuct());
    // a faint key from the upper left gives the cross-breaks and frame edges their shading
    const key = new THREE.DirectionalLight(0xffffff, 0.6); key.position.set(-3, 5, 4); scene.add(key);
    const camera = new THREE.PerspectiveCamera(FOV, width / height, 0.05, 400);
    stage.current = { renderer, scene, camera };
    return () => {
      scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); const mat = m.material as THREE.MeshStandardMaterial; mat.map?.dispose(); mat.roughnessMap?.dispose(); mat.dispose(); } });
      (scene.environment as THREE.Texture | null)?.dispose();
      renderer.dispose();
      stage.current = null;
    };
  }, [width, height]);

  useLayoutEffect(() => {
    const s = stage.current; if (!s) return;
    const p = poseAt(t, format);
    const { camera, scene, renderer } = s;
    camera.position.set(
      p.distance * Math.sin(p.yaw) * Math.cos(p.pitch),
      p.distance * Math.sin(p.pitch),
      p.distance * Math.cos(p.yaw) * Math.cos(p.pitch),
    );
    camera.lookAt(0, 0, 0);
    // Shift the image so the duct centre lands on (centerX, centerY) without changing the perspective.
    camera.setViewOffset(width, height, width / 2 - p.centerX, height / 2 - p.centerY, width, height);
    camera.updateProjectionMatrix();
    scene.environmentIntensity = light.envIntensity;
    scene.environmentRotation.set(0, light.envRotation, 0);
    renderer.toneMappingExposure = light.exposure;
    renderer.render(scene, camera);
  }, [t, format, width, height, light.envIntensity, light.envRotation, light.exposure]);

  // Not rendered at all once handed over to the logo: saves GPU time on the remaining 90 frames.
  const visible = light.opacity > 0.001;
  return (
    <AbsoluteFill style={{ opacity: light.opacity, visibility: visible ? 'visible' : 'hidden' }}>
      <canvas ref={canvas} width={width} height={height} style={{ width, height, display: 'block' }} />
    </AbsoluteFill>
  );
};
