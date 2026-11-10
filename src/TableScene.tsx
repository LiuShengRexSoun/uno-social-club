import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

const COLORS: Record<string, number> = {
  red: 0xef6652,
  yellow: 0xf6ca66,
  green: 0x64d39d,
  blue: 0x75bafb,
};

function ellipse(rx: number, rz: number) {
  const shape = new THREE.Shape();
  shape.absellipse(0, 0, rx, rz, 0, Math.PI * 2, false, 0);
  return shape;
}

function ring(
  outerX: number,
  outerZ: number,
  innerX: number,
  innerZ: number,
  depth: number,
  bevel: number,
) {
  const shape = ellipse(outerX, outerZ);
  const hole = new THREE.Path();
  hole.absellipse(0, 0, innerX, innerZ, 0, Math.PI * 2, true, 0);
  shape.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelSegments: 3,
    steps: 1,
    bevelThickness: bevel,
    bevelSize: bevel,
    curveSegments: 100,
  });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/** A real, softly lit 3D table. Cards remain accessible DOM controls above it. */
export default function TableScene({
  activeColor,
  reducedMotion,
}: {
  activeColor: string;
  reducedMotion: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const accent = useRef<THREE.MeshStandardMaterial | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "low-power",
      });
    } catch {
      setUnavailable(true);
      return;
    }
    setUnavailable(false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    renderer.domElement.setAttribute("aria-hidden", "true");
    renderer.domElement.style.cssText = "width:100%;height:100%;display:block";
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-7.4, 7.4, 5, -5, 0.1, 70);
    camera.position.set(0, 12, 8.5);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.HemisphereLight(0xe3f2d8, 0x07261c, 2.1));
    const key = new THREE.DirectionalLight(0xffefd1, 3.4);
    key.position.set(-4, 10, -4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -9;
    key.shadow.camera.right = 9;
    key.shadow.camera.top = 8;
    key.shadow.camera.bottom = -8;
    key.shadow.normalBias = 0.07;
    key.shadow.bias = -0.0002;
    key.shadow.radius = 5;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xa9d5c0, 1.3);
    fill.position.set(7, 4, 6);
    scene.add(fill);

    const table = new THREE.Group();
    scene.add(table);
    const textures: THREE.Texture[] = [];

    // Tiny canvas texture gives velvet its woven surface without a large asset.
    const fabricCanvas = document.createElement("canvas");
    fabricCanvas.width = fabricCanvas.height = 256;
    const ctx = fabricCanvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#286d53";
      ctx.fillRect(0, 0, 256, 256);
      let seed = 1489;
      for (let i = 0; i < 18000; i++) {
        seed = (seed * 16807) % 2147483647;
        const x = seed % 256;
        seed = (seed * 16807) % 2147483647;
        const y = seed % 256;
        ctx.fillStyle = i % 2 ? "rgba(211,246,201,.065)" : "rgba(0,29,23,.08)";
        ctx.fillRect(x, y, 1, 2);
      }
    }
    const fabric = new THREE.CanvasTexture(fabricCanvas);
    fabric.colorSpace = THREE.SRGBColorSpace;
    fabric.wrapS = fabric.wrapT = THREE.RepeatWrapping;
    fabric.repeat.set(4, 3);
    fabric.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    textures.push(fabric);

    const baseMaterial = new THREE.MeshStandardMaterial({
      color: 0x082a23,
      roughness: 0.5,
      metalness: 0.15,
    });
    const railMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x133b30,
      roughness: 0.42,
      metalness: 0.08,
      clearcoat: 0.28,
    });
    const brass = new THREE.MeshStandardMaterial({
      color: 0xc4a46c,
      roughness: 0.35,
      metalness: 0.73,
    });
    const feltMaterial = new THREE.MeshStandardMaterial({
      color: 0x66947d,
      map: fabric,
      roughness: 1,
      metalness: 0,
    });
    const accentMaterial = new THREE.MeshStandardMaterial({
      color: COLORS[activeColor] || COLORS.green,
      emissive: COLORS[activeColor] || COLORS.green,
      emissiveIntensity: 0.65,
      roughness: 0.35,
      metalness: 0.25,
    });
    accent.current = accentMaterial;

    function mesh(
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      y: number,
      shadow = true,
    ) {
      const object = new THREE.Mesh(geometry, material);
      object.position.y = y;
      object.castShadow = shadow;
      object.receiveShadow = true;
      table.add(object);
      return object;
    }

    const body = new THREE.ExtrudeGeometry(ellipse(6.07, 3.95), {
      depth: 0.3,
      bevelEnabled: true,
      bevelThickness: 0.12,
      bevelSize: 0.12,
      bevelSegments: 4,
      curveSegments: 100,
    });
    body.rotateX(-Math.PI / 2);
    mesh(body, baseMaterial, -0.32);
    mesh(ring(6.08, 3.96, 6.02, 3.9, 0.035, 0.015), brass, -0.13, false);
    mesh(ring(6.04, 3.92, 5.6, 3.48, 0.2, 0.09), railMaterial, 0.01);
    mesh(ring(5.63, 3.51, 5.59, 3.47, 0.012, 0.009), brass, 0.18, false);
    mesh(ring(5.56, 3.44, 5.54, 3.42, 0.008, 0), accentMaterial, 0.115, false);
    const cloth = new THREE.ShapeGeometry(ellipse(5.57, 3.45), 100);
    cloth.rotateX(-Math.PI / 2);
    mesh(cloth, feltMaterial, 0.105, false);

    // Fine inset stitching around the padded rail.
    const stitchPositions: number[] = [];
    for (let i = 0; i < 190; i++) {
      const a = (i / 190) * Math.PI * 2;
      const b = a + 0.013;
      stitchPositions.push(Math.cos(a) * 5.84, 0.307, Math.sin(a) * 3.72);
      stitchPositions.push(Math.cos(b) * 5.84, 0.307, Math.sin(b) * 3.72);
    }
    const stitchGeometry = new THREE.BufferGeometry();
    stitchGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(stitchPositions, 3),
    );
    table.add(
      new THREE.LineSegments(
        stitchGeometry,
        new THREE.LineBasicMaterial({
          color: 0x72947c,
          transparent: true,
          opacity: 0.46,
        }),
      ),
    );

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 30),
      new THREE.ShadowMaterial({ color: 0x001b12, opacity: 0.3 }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -0.63;
    shadow.receiveShadow = true;
    scene.add(shadow);

    const positions = new Float32Array(35 * 3);
    for (let i = 0; i < 35; i++) {
      positions[i * 3] = Math.sin(i * 41.31) * 8;
      positions[i * 3 + 1] = 0.5 + ((i * 17) % 25) / 8;
      positions[i * 3 + 2] = Math.cos(i * 21.73) * 4.8;
    }
    const particlesGeometry = new THREE.BufferGeometry();
    particlesGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3),
    );
    const particles = new THREE.Points(
      particlesGeometry,
      new THREE.PointsMaterial({
        color: 0xe8d7a0,
        size: 0.025,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    );
    scene.add(particles);

    let frame = 0;
    let disposed = false;
    const render = () => {
      if (!disposed) renderer.render(scene, camera);
    };
    const resize = () => {
      if (!el.clientWidth || !el.clientHeight) return;
      renderer.setSize(el.clientWidth, el.clientHeight, false);
      const aspect = el.clientWidth / el.clientHeight;
      // A longer physical table fills portrait screens without shrinking the play area.
      table.scale.z = aspect < 0.9 ? Math.min(2.35, 0.95 / aspect + 0.5) : 1;
      const halfWidth = aspect < 1.05 ? 6.85 : 7.05;
      camera.left = -halfWidth;
      camera.right = halfWidth;
      camera.top = halfWidth / aspect;
      camera.bottom = -halfWidth / aspect;
      camera.updateProjectionMatrix();
      render();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(el);
    resize();
    let previous = 0;
    function animate(time: number) {
      if (disposed) return;
      frame = requestAnimationFrame(animate);
      // 30fps is plenty for ambient dust; the card UI animates independently.
      if (document.hidden || time - previous < 32) return;
      previous = time;
      particles.position.y = Math.sin(time * 0.00012) * 0.1;
      particles.rotation.y = Math.sin(time * 0.000025) * 0.045;
      render();
    }
    if (!reducedMotion) frame = requestAnimationFrame(animate);
    const onVisibility = () => {
      if (!document.hidden) render();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const onColorChange = () => render();
    el.addEventListener("uno:color", onColorChange);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      el.removeEventListener("uno:color", onColorChange);
      scene.traverse((object) => {
        const item = object as THREE.Mesh;
        if (item.geometry) item.geometry.dispose();
        if (item.material) {
          for (const material of Array.isArray(item.material)
            ? item.material
            : [item.material])
            material.dispose();
        }
      });
      textures.forEach((texture) => texture.dispose());
      accent.current = null;
      renderer.dispose();
      renderer.domElement.remove();
    };
    // The material is updated separately, keeping renderer resources stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  useEffect(() => {
    if (accent.current) {
      const color = COLORS[activeColor] || COLORS.green;
      accent.current.color.setHex(color);
      accent.current.emissive.setHex(color);
      host.current?.dispatchEvent(new Event("uno:color"));
    }
  }, [activeColor]);

  return (
    <div
      ref={host}
      className="table-scene"
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      {unavailable && (
        <div
          style={{
            position: "absolute",
            inset: "13% 6% 15%",
            borderRadius: "50%",
            background:
              "radial-gradient(ellipse at 40% 30%, #286b50, #154c39 75%)",
            border: "17px solid #163c30",
            outline: "1px solid #86764e",
            boxShadow:
              "0 22px 40px #001c18aa, inset 0 0 0 2px #a39362, inset 0 10px 20px #062b2290",
          }}
        />
      )}
    </div>
  );
}
