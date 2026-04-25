import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';

type Point2D = { x: number; y: number };

type XrSceneStatus = (message: string) => void;

type XrInputBridge = {
  sourceCanvas: HTMLCanvasElement;
  updatePointer: (position: Point2D, isDown: boolean) => void;
  pumpGameFrame?: () => void;
};

type ControllerBinding = {
  index: number;
  controller: THREE.Group;
  grip: THREE.Group;
  ray: THREE.Line;
  onSelectStart: () => void;
  onSelectEnd: () => void;
};

export type XrImmersiveSceneController = {
  start: (session: XRSession) => Promise<void>;
  stop: () => Promise<void>;
};

export const createXrImmersiveScene = (
  mountEl: HTMLElement,
  inputBridge: XrInputBridge,
  onStatus?: XrSceneStatus
): XrImmersiveSceneController => {
  const notify = (message: string) => {
    if (onStatus) onStatus(message);
  };

  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let panelGroup: THREE.Group | null = null;
  let panelPlane: THREE.Mesh | null = null;
  let panelTexture: THREE.CanvasTexture | null = null;
  let panelPointer: THREE.Mesh | null = null;

  const controllerBindings: ControllerBinding[] = [];
  const controllerModelFactory = new XRControllerModelFactory();

  const raycaster = new THREE.Raycaster();
  const tmpOrigin = new THREE.Vector3();
  const tmpDirection = new THREE.Vector3();
  const tmpQuaternion = new THREE.Quaternion();
  const tmpPanelPoint = new THREE.Vector3();

  const lastPointer: Point2D = {
    x: inputBridge.sourceCanvas.width * 0.5,
    y: inputBridge.sourceCanvas.height * 0.5
  };

  let triggerDown = false;
  let activeControllerIndex: number | null = null;

  const onResize = () => {
    if (!renderer || !camera) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };

  const disposeMaterial = (material: THREE.Material | THREE.Material[]) => {
    if (Array.isArray(material)) {
      material.forEach(m => m.dispose());
      return;
    }
    material.dispose();
  };

  const disposeObjectTree = (root: THREE.Object3D) => {
    root.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) disposeMaterial(mesh.material);
    });
  };

  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

  const updatePanelInteraction = () => {
    if (!panelPlane || !panelGroup || controllerBindings.length === 0) return;

    let bestHit: THREE.Intersection | null = null;
    let bestController: ControllerBinding | null = null;

    for (const binding of controllerBindings) {
      if (triggerDown && activeControllerIndex !== null && binding.index !== activeControllerIndex) {
        binding.ray.material.opacity = 0.35;
        binding.ray.scale.z = 3;
        continue;
      }

      binding.controller.getWorldPosition(tmpOrigin);
      binding.controller.getWorldQuaternion(tmpQuaternion);
      tmpDirection.set(0, 0, -1).applyQuaternion(tmpQuaternion).normalize();

      raycaster.set(tmpOrigin, tmpDirection);
      const hit = raycaster.intersectObject(panelPlane, false)[0];
      const hasHit = Boolean(hit);
      binding.ray.material.opacity = hasHit ? 0.95 : 0.45;
      binding.ray.scale.z = hasHit ? Math.min(Math.max(hit!.distance, 0.2), 3.5) : 3;

      if (!hit) continue;
      if (!bestHit || hit.distance < bestHit.distance) {
        bestHit = hit;
        bestController = binding;
      }
    }

    if (!bestHit || !bestController) {
      if (panelPointer) panelPointer.visible = false;
      if (triggerDown) {
        triggerDown = false;
        activeControllerIndex = null;
        inputBridge.updatePointer(lastPointer, false);
        notify('Controller left panel, drag released');
      }
      return;
    }

    const uv = bestHit.uv;
    if (!uv) return;

    if (panelPointer) {
      panelPointer.visible = true;
      tmpPanelPoint.copy(bestHit.point);
      panelGroup.worldToLocal(tmpPanelPoint);
      panelPointer.position.copy(tmpPanelPoint);
      if (bestHit.face?.normal) {
        panelPointer.position.addScaledVector(bestHit.face.normal, 0.001);
      } else {
        panelPointer.position.z += 0.001;
      }
    }

    const canvasWidth = Math.max(1, inputBridge.sourceCanvas.width);
    const canvasHeight = Math.max(1, inputBridge.sourceCanvas.height);

    lastPointer.x = clamp(uv.x * canvasWidth, 0, canvasWidth);
    lastPointer.y = clamp((1 - uv.y) * canvasHeight, 0, canvasHeight);

    if (triggerDown && activeControllerIndex === null) {
      activeControllerIndex = bestController.index;
    }
    inputBridge.updatePointer(lastPointer, triggerDown);
  };

  const createEnvironment = () => {
    if (!scene) return;

    scene.background = new THREE.Color(0x0e1118);

    const hemi = new THREE.HemisphereLight(0xb9d1ff, 0x05070d, 0.85);
    scene.add(hemi);

    const key = new THREE.PointLight(0xffffff, 2.7, 6.5);
    key.position.set(0, 2.1, 0.35);
    scene.add(key);

    const accent = new THREE.PointLight(0x42a5f5, 1.8, 5);
    accent.position.set(0, 1.45, -1.4);
    scene.add(accent);

    const floorGrid = new THREE.GridHelper(4.8, 22, 0x2e4560, 0x1f2a3a);
    const floorMat = floorGrid.material as THREE.Material;
    floorMat.transparent = true;
    floorMat.opacity = 0.35;
    floorGrid.position.y = 0.02;
    scene.add(floorGrid);

    const floorRing = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 2.2, 64),
      new THREE.MeshBasicMaterial({
        color: 0x1d3c5e,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    floorRing.rotation.x = -Math.PI / 2;
    floorRing.position.y = 0.015;
    scene.add(floorRing);
  };

  const createGamePanel = () => {
    if (!scene) return;

    const width = Math.max(1, inputBridge.sourceCanvas.width);
    const height = Math.max(1, inputBridge.sourceCanvas.height);
    const aspect = width / height;

    const panelHeight = 1.08;
    const panelWidth = panelHeight * aspect;

    panelTexture = new THREE.CanvasTexture(inputBridge.sourceCanvas);
    panelTexture.colorSpace = THREE.SRGBColorSpace;
    panelTexture.minFilter = THREE.LinearFilter;
    panelTexture.magFilter = THREE.LinearFilter;
    panelTexture.generateMipmaps = false;

    panelGroup = new THREE.Group();
    panelGroup.position.set(0, 1.47, -1.3);

    const frame = new THREE.Mesh(
      new THREE.PlaneGeometry(panelWidth + 0.08, panelHeight + 0.08),
      new THREE.MeshStandardMaterial({
        color: 0x18222f,
        roughness: 0.5,
        metalness: 0.25,
        emissive: 0x0d1521,
        emissiveIntensity: 0.8
      })
    );
    frame.position.z = -0.01;
    panelGroup.add(frame);

    panelPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(panelWidth, panelHeight),
      new THREE.MeshBasicMaterial({
        map: panelTexture,
        toneMapped: false
      })
    );
    panelGroup.add(panelPlane);

    panelPointer = new THREE.Mesh(
      new THREE.RingGeometry(0.015, 0.024, 20),
      new THREE.MeshBasicMaterial({
        color: 0xfdd835,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        depthTest: false
      })
    );
    panelPointer.visible = false;
    panelGroup.add(panelPointer);

    scene.add(panelGroup);
  };

  const attachControllers = () => {
    if (!renderer || !scene) return;

    for (let i = 0; i < 2; i += 1) {
      const controller = renderer.xr.getController(i);
      const grip = renderer.xr.getControllerGrip(i);
      grip.add(controllerModelFactory.createControllerModel(grip));

      const ray = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(0, 0, -1)
        ]),
        new THREE.LineBasicMaterial({ color: 0xa8c7fa, transparent: true, opacity: 0.7 })
      );
      ray.scale.z = 3;
      controller.add(ray);

      const onSelectStart = () => {
        triggerDown = true;
        activeControllerIndex = i;
        inputBridge.updatePointer(lastPointer, true);
        notify('XR dragging');
      };

      const onSelectEnd = () => {
        if (activeControllerIndex !== null && activeControllerIndex !== i) return;
        triggerDown = false;
        activeControllerIndex = null;
        inputBridge.updatePointer(lastPointer, false);
        notify('XR drag released');
      };

      controller.addEventListener('selectstart', onSelectStart);
      controller.addEventListener('selectend', onSelectEnd);

      scene.add(controller);
      scene.add(grip);
      controllerBindings.push({ index: i, controller, grip, ray, onSelectStart, onSelectEnd });
    }
  };

  const teardown = async () => {
    inputBridge.updatePointer(lastPointer, false);
    activeControllerIndex = null;
    triggerDown = false;

    if (!renderer) return;

    renderer.setAnimationLoop(null);
    window.removeEventListener('resize', onResize);

    controllerBindings.forEach(({ controller, grip, onSelectStart, onSelectEnd }) => {
      controller.removeEventListener('selectstart', onSelectStart);
      controller.removeEventListener('selectend', onSelectEnd);
      disposeObjectTree(controller);
      disposeObjectTree(grip);
      controller.clear();
      grip.clear();
      if (scene) scene.remove(controller);
      if (scene) scene.remove(grip);
    });
    controllerBindings.length = 0;

    if (scene) disposeObjectTree(scene);

    panelTexture?.dispose();

    renderer.dispose();
    renderer.forceContextLoss();

    if (renderer.domElement.parentElement === mountEl) {
      mountEl.removeChild(renderer.domElement);
    }

    scene = null;
    camera = null;
    panelGroup = null;
    panelPlane = null;
    panelPointer = null;
    panelTexture = null;
    renderer = null;

    notify('XR scene cleaned up');
  };

  return {
    async start(session: XRSession) {
      if (renderer) {
        await teardown();
      }

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
      renderer.xr.enabled = true;
      renderer.xr.setFramebufferScaleFactor(0.82);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setClearColor(0x0e1118, 1);

      renderer.domElement.style.position = 'absolute';
      renderer.domElement.style.inset = '0';
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      renderer.domElement.style.zIndex = '30';
      renderer.domElement.style.pointerEvents = 'none';

      mountEl.appendChild(renderer.domElement);

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 30);

      createEnvironment();
      createGamePanel();
      attachControllers();

      await renderer.xr.setSession(session);

      window.addEventListener('resize', onResize);

      renderer.setAnimationLoop(() => {
        if (!renderer || !scene || !camera) return;

        inputBridge.pumpGameFrame?.();
        if (panelTexture) panelTexture.needsUpdate = true;
        updatePanelInteraction();
        renderer.render(scene, camera);
      });

      notify('XR ready: use controller ray + trigger to drag and launch');
    },
    async stop() {
      await teardown();
    }
  };
};
