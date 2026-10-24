// A small photographic studio, baked once into an environment map: a large soft top box, a dim fill on the
// left and one narrow vertical strip light. Rotating the environment (scene.environmentRotation) makes the
// strip's reflection travel along the metal — the "light that moves across the duct" of scene 02.
import * as THREE from 'three';

function softbox(w: number, h: number, intensity: number) {
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(intensity), side: THREE.DoubleSide, toneMapped: false });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
}

export function studioEnvironment(renderer: THREE.WebGLRenderer) {
  const room = new THREE.Scene();
  room.background = new THREE.Color(0x0b0d10); // never pure black: metal mirrors its room

  const top = softbox(7, 3, 2.6);            // key: overhead, slightly in front → long sheen on the top panel
  top.position.set(0, 5.5, 1.2); top.lookAt(0, 0, 0); room.add(top);

  const front = softbox(16, 3.4, 0.4);        // broad, dim front wall: the face reads as metal, not as a hole
  front.position.set(0, 1.6, 6.5); front.lookAt(0, 0, 0); room.add(front);

  const fill = softbox(3, 4, 0.5);           // low fill from the left keeps the shadow side readable
  fill.position.set(-6, 0.5, 2); fill.lookAt(0, 0, 0); room.add(fill);

  const fillR = softbox(3, 4, 0.3);          // weaker fill on the right: the far flange reads as zinc, not black plastic
  fillR.position.set(6, 0.8, 1.5); fillR.lookAt(0, 0, 0); room.add(fillR);

  const back = softbox(17, 1.8, 1.3);        // low back wall: what the top panel mirrors at a shallow angle
  back.position.set(0, 1.4, -6.5); back.lookAt(0, 0, 0); room.add(back);

  const rim = softbox(6, 0.5, 1.4);          // thin rim from below-behind: defines the bottom edge against black
  rim.position.set(0, -4, -4); rim.lookAt(0, 0, 0); room.add(rim);

  const strip = softbox(0.42, 9, 9);         // the travelling strip light (azimuth 0 before rotation)
  strip.position.set(0, 0.4, 5.9); strip.lookAt(0, 0, 0); room.add(strip);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(room, 0.02).texture;
  pmrem.dispose();
  room.traverse(o => { if ((o as THREE.Mesh).isMesh) { (o as THREE.Mesh).geometry.dispose(); ((o as THREE.Mesh).material as THREE.Material).dispose(); } });
  return env;
}
