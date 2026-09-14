import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";

const BACKGROUND = 0x07070b;

// Camera directions in scene space (x: fly's left, y: dorsal, z: anterior).
export const VIEWS = {
  front: new THREE.Vector3(0, 0.38, 1),
  oblique: new THREE.Vector3(0.95, 0.45, 0.75),
  side: new THREE.Vector3(1, 0.3, 0.12),
};

/**
 * One WebGL canvas showing neuropil meshes and neuron skeletons.
 *
 * Data coordinates are µm with x towards the fly's left, y ventral and z posterior; the anatomy group
 * rotates them 180° about x so that dorsal is up and the default camera faces the front of the head.
 */
export class Viewer {
  constructor(container, { onHover, onPick } = {}) {
    this.container = container;
    this.onHover = onHover;
    this.onPick = onPick;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(BACKGROUND);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 1, 20000);
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x303040, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(-0.4, 0.6, 1);
    this.camera.add(key);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

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

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.bindPointer();

    const loop = (time) => {
      this.frame = requestAnimationFrame(loop);
      this.controls.update();
      for (const callback of this.frameCallbacks) callback(time / 1000);
      this.renderer.render(this.scene, this.camera);
    };
    this.frame = requestAnimationFrame(loop);
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
      const material = new THREE.MeshLambertMaterial({ color: 0x888888, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(entry.geometry, material);
      mesh.userData = { entry, pickable: true };
      this.neuropilGroup.add(mesh);
      return mesh;
    });
  }

  /** ``style(entry)`` returns ``{ color: [r, g, b], opacity, visible, pickable }`` for each neuropil. */
  styleNeuropils(style) {
    for (const mesh of this.neuropilMeshes) {
      const { color = [0.5, 0.5, 0.5], opacity = 1, visible = true, pickable = true } = style(mesh.userData.entry);
      mesh.visible = visible;
      mesh.userData.pickable = pickable;
      mesh.material.color.setRGB(...color);
      mesh.material.opacity = opacity;
      mesh.material.transparent = opacity < 1;
      mesh.material.depthWrite = opacity >= 1;
      mesh.renderOrder = opacity < 1 ? 1 : 0;
      mesh.material.needsUpdate = true;
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
        color: new THREE.Color(...color),
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
