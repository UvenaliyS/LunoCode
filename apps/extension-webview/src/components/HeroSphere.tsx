import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

/**
 * Red wireframe globe — a 1:1 port of the website's GlobeArcs3D (dense red
 * lat/long fat-line cage + fresnel atmosphere + depth mask), scoped to a fixed
 * square and auto-rotating (drag/parallax removed — it spins on its own).
 */
const R = 1;
const TILT_X = 0.12;
const TILT_Z = 0.62;
const AUTO_VEL = 0.11; // idle spin, rad/s

function webglUsable(): boolean {
  try {
    const c = document.createElement("canvas");
    const strict = { failIfMajorPerformanceCaveat: true };
    const gl =
      c.getContext("webgl2", strict) || c.getContext("webgl", strict) ||
      c.getContext("webgl2") || c.getContext("webgl");
    if (!gl) return false;
    (gl as WebGLRenderingContext).getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export function HeroSphere({ size = 148 }: { size?: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!webglUsable()) {
      setFailed(true);
      return;
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setClearColor(0x000000, 0);
    const canvas = renderer.domElement;
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    host.appendChild(canvas);
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      setFailed(true);
    });

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 20);
    camera.position.set(0, 0, 3.95);
    camera.lookAt(0, 0, 0);

    const group = new THREE.Group();
    group.rotation.x = TILT_X;
    group.rotation.z = TILT_Z;
    scene.add(group);

    const disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];

    // Invisible depth mask → gaps stay transparent, far lines occluded.
    const bodyGeo = new THREE.SphereGeometry(R * 0.99, 48, 48);
    const bodyMat = new THREE.MeshBasicMaterial({ colorWrite: false });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.renderOrder = -1;
    group.add(body);
    disposables.push(bodyGeo, bodyMat);

    const lineMat = new LineMaterial({
      color: 0xdc2626,
      linewidth: 1.9,
      transparent: true,
      opacity: 0.72,
      dashed: false,
    });
    lineMat.worldUnits = false;
    disposables.push(lineMat);

    const addLine = (pts: number[]) => {
      const g = new LineGeometry();
      g.setPositions(pts);
      const line = new Line2(g, lineMat);
      line.computeLineDistances();
      group.add(line);
      disposables.push(g);
    };

    for (let lat = -80; lat <= 80; lat += 10) {
      const pts: number[] = [];
      const y = Math.sin(THREE.MathUtils.degToRad(lat)) * R;
      const rr = Math.cos(THREE.MathUtils.degToRad(lat)) * R;
      for (let a = 0; a <= 120; a++) {
        const th = (a / 120) * Math.PI * 2;
        pts.push(Math.cos(th) * rr, y, Math.sin(th) * rr);
      }
      addLine(pts);
    }
    for (let lon = 0; lon < 180; lon += 12) {
      const pts: number[] = [];
      const th = THREE.MathUtils.degToRad(lon);
      for (let a = 0; a <= 120; a++) {
        const p = (a / 120) * Math.PI * 2;
        pts.push(Math.cos(th) * Math.cos(p) * R, Math.sin(p) * R, Math.sin(th) * Math.cos(p) * R);
      }
      addLine(pts);
    }

    // Fresnel atmosphere rim.
    const atmGeo = new THREE.SphereGeometry(R * 1.015, 64, 64);
    const atmMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xef4444) } },
      vertexShader: `
        varying vec3 vN;
        varying vec3 vP;
        void main() {
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vP = mv.xyz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vN;
        varying vec3 vP;
        uniform vec3 uColor;
        void main() {
          vec3 vd = normalize(-vP);
          float f = pow(1.0 - max(dot(vd, vN), 0.0), 4.0);
          gl_FragColor = vec4(uColor, 1.0) * f * 0.5;
        }`,
      side: THREE.FrontSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    group.add(new THREE.Mesh(atmGeo, atmMat));
    disposables.push(atmGeo, atmMat);

    let reduced = false;
    let running = true;
    let disposed = false;
    let spin = 0;

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const applyMq = () => {
      reduced = mq.matches;
    };
    applyMq();
    mq.addEventListener("change", applyMq);

    const renderOnce = () => {
      if (!disposed) renderer.render(scene, camera);
    };
    const setSize = () => {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      renderer.setSize(size, size, false);
      lineMat.resolution.set(size, size);
      camera.aspect = 1;
      camera.updateProjectionMatrix();
      if (reduced) renderOnce();
    };
    setSize();

    const io = new IntersectionObserver(([e]) => {
      running = e.isIntersecting;
    }, { threshold: 0.02 });
    io.observe(host);
    const onVis = () => {
      running = document.visibilityState === "visible";
    };
    document.addEventListener("visibilitychange", onVis);

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!running || reduced) {
        last = now;
        return;
      }
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      spin += AUTO_VEL * dt;
      group.rotation.y = spin;
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      mq.removeEventListener("change", applyMq);
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      canvas.remove();
    };
  }, [size]);

  return (
    <div
      ref={hostRef}
      className="hero-sphere"
      style={{ width: size, height: size, position: "relative" }}
      aria-hidden="true"
    >
      {failed && (
        <svg
          viewBox="0 0 100 100"
          width={size}
          height={size}
          fill="none"
          style={{ position: "absolute", inset: 0 }}
        >
          <g stroke="#dc2626" strokeWidth="0.6" strokeLinecap="round">
            <circle cx="50" cy="50" r="46" strokeOpacity="0.9" />
            <ellipse cx="50" cy="50" rx="30" ry="46" strokeOpacity="0.55" />
            <ellipse cx="50" cy="50" rx="15" ry="46" strokeOpacity="0.42" />
            <line x1="50" y1="4" x2="50" y2="96" strokeOpacity="0.5" />
            <ellipse cx="50" cy="50" rx="46" ry="6" strokeOpacity="0.55" />
            <ellipse cx="50" cy="32" rx="42" ry="5" strokeOpacity="0.4" />
            <ellipse cx="50" cy="68" rx="42" ry="5" strokeOpacity="0.4" />
            <ellipse cx="50" cy="18" rx="33" ry="4" strokeOpacity="0.3" />
            <ellipse cx="50" cy="82" rx="33" ry="4" strokeOpacity="0.3" />
          </g>
        </svg>
      )}
    </div>
  );
}
