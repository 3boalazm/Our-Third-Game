// The 3D garage on the Garage page: the player's kart on a slowly turning
// turntable in a lit workshop. Drag (or swipe) to turn it by hand.

import * as THREE from "three";
import { buildKartModel } from "./render3d.js";

function makeTexture(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createGarageView(canvas) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  } catch {
    return null;
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b111c);
  scene.fog = new THREE.Fog(0x0b111c, 520, 1100);
  const camera = new THREE.PerspectiveCamera(36, 1, 10, 3000);

  // ---- the room
  const floorTex = makeTexture(512, 512, (c, w, h) => {
    c.fillStyle = "#1a2130";
    c.fillRect(0, 0, w, h);
    c.strokeStyle = "rgba(255,255,255,0.06)";
    c.lineWidth = 3;
    for (let i = 0; i <= 8; i += 1) {
      c.beginPath();
      c.moveTo((i * w) / 8, 0);
      c.lineTo((i * w) / 8, h);
      c.moveTo(0, (i * h) / 8);
      c.lineTo(w, (i * h) / 8);
      c.stroke();
    }
  });
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(6, 6);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(2400, 2400),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.35, metalness: 0.25 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x18202e, roughness: 0.9 });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(2400, 700), wallMat);
  back.position.set(0, 350, -420);
  scene.add(back);
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(1400, 700), wallMat);
    wall.position.set(side * 620, 350, 200);
    wall.rotation.y = -side * Math.PI / 2;
    scene.add(wall);
  }
  // glowing light strips on the back wall
  const stripMat = new THREE.MeshBasicMaterial({ color: 0x7fd8ff });
  for (const y of [120, 300]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(900, 5, 4), stripMat);
    strip.position.set(0, y, -416);
    scene.add(strip);
  }
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(420, 70),
    new THREE.MeshBasicMaterial({
      map: makeTexture(1024, 170, (c, w, h) => {
        c.fillStyle = "#0e1626";
        c.fillRect(0, 0, w, h);
        c.fillStyle = "#ffffff";
        c.font = "900 92px system-ui, sans-serif";
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText("KART RACE  GARAGE", w / 2, h / 2 + 4);
        c.fillStyle = "#e23d3a";
        c.fillRect(0, h - 10, w, 10);
      }),
    }),
  );
  sign.position.set(0, 210, -414);
  scene.add(sign);

  // tool cabinets and a stack of tyres on the sides
  const cabinetMat = new THREE.MeshStandardMaterial({ color: 0xc8352f, roughness: 0.5, metalness: 0.3 });
  const drawerMat = new THREE.MeshStandardMaterial({ color: 0xdedfe4, roughness: 0.4, metalness: 0.6 });
  for (const side of [-1, 1]) {
    const cab = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(120, 110, 50), cabinetMat);
    body.position.set(0, 55, 0);
    cab.add(body);
    for (let i = 0; i < 4; i += 1) {
      const handle = new THREE.Mesh(new THREE.BoxGeometry(60, 3, 3), drawerMat);
      handle.position.set(0, 20 + i * 24, 26);
      cab.add(handle);
    }
    cab.position.set(side * 380, 0, -340);
    scene.add(cab);
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x15161b, roughness: 0.95 });
    for (let i = 0; i < 4; i += 1) {
      const tyre = new THREE.Mesh(new THREE.TorusGeometry(24, 11, 10, 24), tyreMat);
      tyre.rotation.x = Math.PI / 2;
      tyre.position.set(side * 470, 11 + i * 22, -230);
      tyre.castShadow = true;
      scene.add(tyre);
    }
  }

  // the turntable
  const table = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(150, 156, 10, 64),
    new THREE.MeshStandardMaterial({ color: 0x2a3344, roughness: 0.3, metalness: 0.7 }),
  );
  base.position.y = 5;
  base.receiveShadow = true;
  table.add(base);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(153, 2.2, 8, 96),
    new THREE.MeshBasicMaterial({ color: 0x7fd8ff }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 10;
  table.add(ring);
  scene.add(table);

  // ---- lights: a soft fill, a key spotlight from above with shadows, a cool rim light
  scene.add(new THREE.HemisphereLight(0xbcd8ff, 0x1a1f2a, 0.9));
  const key = new THREE.SpotLight(0xffffff, 3.2, 1500, 0.55, 0.45, 0);
  key.position.set(140, 520, 260);
  key.target.position.set(0, 20, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0005;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0x7fd8ff, 1.2);
  rim.position.set(-300, 200, -300);
  scene.add(rim);

  // ---- the kart
  let kart = null;
  let lastKey = "";
  function setKart({ color, livery, wheels, spoiler }) {
    const keyStr = [color, livery, wheels, spoiler].join("|");
    if (keyStr === lastKey) return;
    lastKey = keyStr;
    if (kart) {
      table.remove(kart.group);
      kart.group.traverse((o) => o.geometry?.dispose?.());
    }
    kart = buildKartModel(color, livery, { wheels, spoiler });
    kart.group.position.y = 10;
    kart.group.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    table.add(kart.group);
    pop = 1;
  }

  // ---- turning: automatic, or by dragging
  let angle = -0.7;
  let spinSpeed = 0.35;
  let dragging = false;
  let lastX = 0;
  let pop = 0;
  canvas.style.touchAction = "none";
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    lastX = e.clientX;
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    angle += dx * 0.01;
    spinSpeed = dx * 0.6;
  });
  const stop = () => {
    dragging = false;
  };
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);

  let running = false;
  let last = 0;
  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w > 0 && h > 0 && (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio()))) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    if (!dragging) {
      spinSpeed += (0.35 - spinSpeed) * Math.min(1, dt * 1.5);
      angle += spinSpeed * dt;
    }
    table.rotation.y = angle;
    if (kart) {
      // a little bounce when a new part is fitted
      pop = Math.max(0, pop - dt * 2.5);
      const s = 1.75 * (1 + 0.06 * Math.sin(pop * Math.PI));
      kart.group.scale.setScalar(s);
      for (const wheel of kart.wheels) wheel.spin.rotation.z -= dt * 1.5;
    }
    camera.position.set(0, 128, 365);
    camera.lookAt(0, 34, 0);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  return {
    setKart,
    start() {
      if (running) return;
      running = true;
      last = performance.now();
      requestAnimationFrame(frame);
    },
    stop() {
      running = false;
    },
    dispose() {
      running = false;
      renderer.dispose();
    },
  };
}
