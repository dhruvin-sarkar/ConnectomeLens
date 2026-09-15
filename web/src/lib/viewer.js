import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";

// Camera directions in scene space (x: fly's left, y: dorsal, z: anterior).
export const VIEWS = {
  front: new THREE.Vector3(0, 0.3, 1),
  oblique: new THREE.Vector3(0.95, 0.45, 0.75),
  side: new THREE.Vector3(1, 0.3, 0.12),
  top: new THREE.Vector3(0.0001, 1, 0.12),
};

/**
 * One WebGL canvas showing neuropil meshes and neuron skeletons on a black field.
 *
 * Data coordinates are µm with x towards the fly's left, y ventral and z posterior; the anatomy group
 * rotates them 180° about x so that dorsal is up and the default camera faces the front of the head.
 */
export class Viewer {
  constructor(container, { onHover, onPick, autoRotate = false } = {}) {
    this.container = container;
    this.onHover = onHover;
    this.onPick = onPick;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000);
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 1, 20000);
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x20242a, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(-0.4, 0.6, 1);
    this.camera.add(key);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.autoRotate = autoRotate;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.addEventListener("start", () => {
      this.controls.autoRotate = false;
    });

    this.anatomy = new THREE.Group();
    this.anatomy.rotation.x = Math.PI;
    this.neuropilGroup = new THREE.Group();
    this.skeletonGroup = new THREE.Group();
    this.anatomy.add(this.neuropilGroup, this.skeletonGroup);
    this.scene.add(this.anatomy);

    this.neuropilMeshes = [];
    this.skeletons = [];
    this.frameCallbacks = new Set();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.hovered = null;
    this.active = true;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.bindPointer();
    this.start();
  }

  start() {
    const loop = (time) => {
      this.frame = requestAnimationFrame(loop);
      this.controls.update();
      for (const callback of this.frameCallbacks) callback(time / 1000);
      this.renderer.render(this.scene, this.camera);
    };
    this.frame = requestAnimationFrame(loop);
  }

  /** Pause rendering while the canvas is off screen. */
  setActive(active) {
    if (active === this.active) return;
    this.active = active;
    cancelAnimationFrame(this.frame);
    if (active) this.start();
  }

  resize() {
    const { clientWidth: width, clientHeight: height } = this.container;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  bindPointer() {
    const canvas = this.renderer.domElement;
    let down = null;
    this.handlers = {
      move: (event) => {
        this.setPointer(event);
        const hit = this.pick();
        if (hit !== this.hovered) {
          this.hovered = hit;
          canvas.style.cursor = hit && this.onPick ? "pointer" : "";
        }
        this.onHover?.(hit, event);
      },
      leave: () => {
        this.hovered = null;
        this.onHover?.(null);
      },
      down: (event) => {
        down = [event.clientX, event.clientY];
      },
      up: (event) => {
        if (!down || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 4) return;
        this.setPointer(event);
        this.onPick?.(this.pick());
      },
    };
    canvas.addEventListener("pointermove", this.handlers.move);
    canvas.addEventListener("pointerleave", this.handlers.leave);
    canvas.addEventListener("pointerdown", this.handlers.down);
    canvas.addEventListener("pointerup", this.handlers.up);
  }

  setPointer(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  }

  pick() {
    if (!this.onHover && !this.onPick) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const candidates = this.neuropilMeshes.filter((m) => m.visible && m.userData.pickable);
    const [hit] = this.raycaster.intersectObjects(candidates, false);
    return hit ? hit.object.userData.entry : null;
  }

  setNeuropils(neuropils) {
    for (const mesh of this.neuropilMeshes) {
      mesh.material.dispose();
      this.neuropilGroup.remove(mesh);
    }
    this.neuropilMeshes = neuropils.map((entry) => {
      const material = new THREE.MeshLambertMaterial({ color: 0x222222, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(entry.geometry, material);
      mesh.userData = { entry, pickable: true };
      this.neuropilGroup.add(mesh);
      return mesh;
    });
  }

  /**
   * ``style(entry)`` returns ``{ color: [r, g, b] in sRGB 0–1, opacity, visible, pickable, emissive, additive }`` for
   * each neuropil; ``additive`` sums overlapping surfaces like a maximum-intensity projection.
   */
  styleNeuropils(style) {
    for (const mesh of this.neuropilMeshes) {
      const { color = [0.3, 0.3, 0.3], opacity = 1, visible = true, pickable = true, emissive = 0, additive = false } =
        style(mesh.userData.entry);
      const { material } = mesh;
      mesh.visible = visible;
      mesh.userData.pickable = pickable;
      material.color.setRGB(color[0], color[1], color[2], THREE.SRGBColorSpace);
      material.emissive.setRGB(color[0] * emissive, color[1] * emissive, color[2] * emissive, THREE.SRGBColorSpace);
      const transparent = additive || opacity < 1;
      const blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
      if (material.transparent !== transparent || material.blending !== blending) material.needsUpdate = true;
      material.opacity = opacity;
      material.transparent = transparent;
      material.blending = blending;
      material.side = additive ? THREE.FrontSide : THREE.DoubleSide;
      material.depthWrite = !transparent;
      mesh.renderOrder = transparent ? 1 : 0;
    }
  }

  /** Replace the displayed skeletons. Each item: ``{ skeleton, color: [r, g, b], width, opacity }``. */
  setSkeletons(items) {
    this.clearSkeletons();
    this.skeletons = items.map(({ skeleton, color, width = 1.6, opacity = 1 }) => {
      const { points, parents } = skeleton;
      const segments = [];
      for (let i = 0; i < parents.length; i += 1) {
        const p = parents[i];
        if (p < 0) continue;
        segments.push(points[3 * i], points[3 * i + 1], points[3 * i + 2], points[3 * p], points[3 * p + 1], points[3 * p + 2]);
      }
      const geometry = new LineSegmentsGeometry().setPositions(segments);
      const material = new LineMaterial({
        color: new THREE.Color().setRGB(color[0], color[1], color[2], THREE.SRGBColorSpace),
        linewidth: width,
        transparent: opacity < 1,
        opacity,
        depthWrite: opacity >= 1,
      });
      const line = new LineSegments2(geometry, material);
      line.renderOrder = 2;
      this.skeletonGroup.add(line);
      return line;
    });
    return this.skeletons;
  }

  clearSkeletons() {
    for (const line of this.skeletons) {
      line.geometry.dispose();
      line.material.dispose();
      this.skeletonGroup.remove(line);
    }
    this.skeletons = [];
  }

  /** Tilt the anatomy about the left–right axis by ``angle`` radians; a positive angle swings the nerve cord below the brain. */
  setTilt(angle) {
    this.anatomy.rotation.x = Math.PI - angle;
  }

  /** Point the camera from ``direction`` at the bounding box of ``objects`` (all visible content by default). */
  fit(objects, direction = VIEWS.front, padding = 1.08) {
    const box = new THREE.Box3();
    this.anatomy.updateMatrixWorld(true);
    for (const object of objects ?? [...this.neuropilMeshes.filter((m) => m.visible), ...this.skeletons]) {
      box.expandByObject(object);
    }
    if (box.isEmpty()) return;

    // Extent of the box corners along the camera's right, up and viewing axes.
    const view = direction.clone().normalize();
    const right = new THREE.Vector3(0, 1, 0).cross(view).normalize();
    const up = view.clone().cross(right).normalize();
    const center = box.getCenter(new THREE.Vector3());
    const half = [0, 0, 0];
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          const corner = new THREE.Vector3(x, y, z).sub(center);
          half[0] = Math.max(half[0], Math.abs(corner.dot(right)));
          half[1] = Math.max(half[1], Math.abs(corner.dot(up)));
          half[2] = Math.max(half[2], Math.abs(corner.dot(view)));
        }
      }
    }
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const distance = half[2] + padding * Math.max(half[0] / (tanV * this.camera.aspect), half[1] / tanV);
    const radius = Math.hypot(...half);

    this.controls.target.copy(center);
    this.camera.position.copy(center).add(view.multiplyScalar(distance));
    this.camera.near = Math.max(0.5, distance / 100);
    this.camera.far = distance * 4 + radius * 4;
    this.controls.minDistance = radius * 0.1;
    this.controls.maxDistance = distance * 3;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  onFrame(callback) {
    this.frameCallbacks.add(callback);
    return () => this.frameCallbacks.delete(callback);
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointermove", this.handlers.move);
    canvas.removeEventListener("pointerleave", this.handlers.leave);
    canvas.removeEventListener("pointerdown", this.handlers.down);
    canvas.removeEventListener("pointerup", this.handlers.up);
    this.clearSkeletons();
    for (const mesh of this.neuropilMeshes) mesh.material.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    canvas.remove();
  }
}
