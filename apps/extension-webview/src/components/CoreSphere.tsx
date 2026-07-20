import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

/**
 * Gateway core reactor — a 1:1 port of the website's GatewayCore3D: a grey
 * geodesic containment shell (icosahedron wireframe + faint vertex dots) around
 * a pulsing red core (solid icosahedron + counter-rotating wire cage + glow
 * sprite). Scoped to a fixed square, auto-rotating (drag/parallax/modes removed;
 * RING_DEFS is empty on the site too, so there are no particle rings).
 */
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

function dotTexture(inner: string, outer: string): THREE.CanvasTexture {
  const S = 64;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.4, outer);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
}

export function CoreSphere({ size = 160 }: { size?: number }) {
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
    // Site renders this in a large canvas; ours is a small square, so the same
    // z made the wireframe look cramped. Pull the camera in to fill the frame —
    // the shell reads bigger and the edges spread out like on the site.
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 24);
    camera.position.set(0, 0, 5.6);
    camera.lookAt(0, 0, 0);

    const group = new THREE.Group();
    scene.add(group);
    const disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];

    // Containment shell: tumbling geodesic wireframe.
    const shellGeo = new THREE.IcosahedronGeometry(1.6, 1);
    const shellEdges = new THREE.EdgesGeometry(shellGeo);
    const shellMat = new THREE.LineBasicMaterial({ color: 0x52525b, transparent: true, opacity: 0.45 });
    const shell = new THREE.LineSegments(shellEdges, shellMat);
    group.add(shell);
    disposables.push(shellEdges, shellMat);
    const shellDotTex = dotTexture("rgba(161,161,170,0.9)", "rgba(82,82,91,0.4)");
    const shellPts = new THREE.Points(shellGeo, new THREE.PointsMaterial({
      map: shellDotTex, size: 0.06, transparent: true, opacity: 0.5, depthWrite: false, color: 0x9a9aa2,
    }));
    group.add(shellPts);
    disposables.push(shellGeo, shellDotTex, shellPts.material as THREE.Material);

    // Core: solid icosahedron + counter-rotating wire cage + glow sprite.
    const coreInGeo = new THREE.IcosahedronGeometry(0.4, 0);
    const coreInMat = new THREE.MeshBasicMaterial({ color: 0xdc2626 });
    const coreIn = new THREE.Mesh(coreInGeo, coreInMat);
    group.add(coreIn);
    const coreWireGeo = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.52, 0));
    const coreWireMat = new THREE.LineBasicMaterial({ color: 0xff6b6b, transparent: true, opacity: 0.9 });
    const coreWire = new THREE.LineSegments(coreWireGeo, coreWireMat);
    group.add(coreWire);
    const coreGlowTex = dotTexture("rgba(255,80,80,0.95)", "rgba(220,38,38,0.35)");
    const coreGlowMat = new THREE.SpriteMaterial({ map: coreGlowTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    const coreGlow = new THREE.Sprite(coreGlowMat);
    coreGlow.scale.setScalar(1.7);
    group.add(coreGlow);
    disposables.push(coreInGeo, coreInMat, coreWireGeo, coreWireMat, coreGlowTex, coreGlowMat);

    let reduced = false;
    let running = true;
    let disposed = false;
    let spin = 0;
    let time = 0;

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
      time += dt;

      spin += dt * 0.18;
      group.rotation.y = spin;

      shell.rotation.y -= dt * 0.06;
      shell.rotation.x += dt * 0.03;
      shellPts.rotation.copy(shell.rotation);

      coreIn.rotation.x += dt * 0.5;
      coreIn.rotation.y += dt * 0.7;
      coreWire.rotation.x -= dt * 0.4;
      coreWire.rotation.y -= dt * 0.55;
      const beat = 1 + Math.sin(time * 2) * 0.09;
      coreIn.scale.setScalar(beat);
      coreWire.scale.setScalar(beat);
      coreGlow.scale.setScalar(1.6 * beat);

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
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
          <svg viewBox="0 0 100 100" width="82%" height="82%" fill="none">
            <g stroke="#52525b" strokeWidth="0.6" strokeOpacity="0.6" strokeLinejoin="round">
              <polygon points="50,6 88,28 88,72 50,94 12,72 12,28" />
              <polygon points="50,20 74,34 74,66 50,80 26,66 26,34" />
              <line x1="50" y1="6" x2="50" y2="20" />
              <line x1="88" y1="28" x2="74" y2="34" />
              <line x1="88" y1="72" x2="74" y2="66" />
              <line x1="50" y1="94" x2="50" y2="80" />
              <line x1="12" y1="72" x2="26" y2="66" />
              <line x1="12" y1="28" x2="26" y2="34" />
            </g>
            <g stroke="#dc2626" strokeWidth="0.7">
              <ellipse cx="50" cy="50" rx="34" ry="12" strokeOpacity="0.6" />
              <ellipse cx="50" cy="50" rx="12" ry="34" strokeOpacity="0.5" />
            </g>
          </svg>
          <span
            style={{
              position: "absolute",
              width: 16,
              height: 16,
              borderRadius: "50%",
              background: "#dc2626",
              boxShadow: "0 0 34px 9px rgba(220,38,38,0.7)",
            }}
          />
        </div>
      )}
    </div>
  );
}
