import * as THREE from 'three';

type Point2D = { x: number; y: number };

type XrSceneStatus = (message: string) => void;

type XrInputBridge = {
  sourceCanvas: HTMLCanvasElement;
  updatePointer: (position: Point2D, isDown: boolean) => void;
};

type ControllerBinding = {
  controller: THREE.Group;
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

  const raycaster = new THREE.Raycaster();
  const tmpOrigin = new THREE.Vector3();
  const tmpDirection = new THREE.Vector3();
  const tmpQuaternion = new THREE.Quaternion();

  const lastPointer: Point2D = {
    x: inputBridge.sourceCanvas.width * 0.5,
    y: inputBridge.sourceCanvas.height * 0.5
  };

  let triggerDown = false;

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
    if (!panelPlane || controllerBindings.length === 0) return;

    const { controller } = controllerBindings[0];
    controller.getWorldPosition(tmpOrigin);
    controller.getWorldQuaternion(tmpQuaternion);
    tmpDirection.set(0, 0, -1).applyQuaternion(tmpQuaternion).normalize();

    raycaster.set(tmpOrigin, tmpDirection);
    const hits = raycaster.intersectObject(panelPlane, false);

    if (hits.length === 0) {
      if (panelPointer) panelPointer.visible = false;
      if (triggerDown) {
        triggerDown = false;
        inputBridge.updatePointer(lastPointer, false);
        notify('Controller left panel, drag released');
      }
      return;
    }

    const hit = hits[0];
    const uv = hit.uv;
    if (!uv) return;

    if (panelPointer) {
      panelPointer.visible = true;
      panelPointer.position.copy(hit.point);
      if (hit.face?.normal) {
        panelPointer.position.addScaledVector(hit.face.normal, 0.001);
      } else {
        panelPointer.position.z += 0.001;
      }
    }

    const canvasWidth = Math.max(1, inputBridge.sourceCanvas.width);
    const canvasHeight = Math.max(1, inputBridge.sourceCanvas.height);

    lastPointer.x = clamp(uv.x * canvasWidth, 0, canvasWidth);
    lastPointer.y = clamp((1 - uv.y) * canvasHeight, 0, canvasHeight);

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

  const attachController = () => {
    if (!renderer || !scene) return;

    const controller = renderer.xr.getController(0);

    const ray = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -1)
      ]),
      new THREE.LineBasicMaterial({ color: 0xa8c7fa, transparent: true, opacity: 0.9 })
    );
    ray.scale.z = 3;
    controller.add(ray);

    const onSelectStart = () => {
      triggerDown = true;
      inputBridge.updatePointer(lastPointer, true);
      notify('XR dragging');
    };

    const onSelectEnd = () => {
      triggerDown = false;
      inputBridge.updatePointer(lastPointer, false);
      notify('XR drag released');
    };

    controller.addEventListener('selectstart', onSelectStart);
    controller.addEventListener('selectend', onSelectEnd);

    scene.add(controller);
    controllerBindings.push({ controller, onSelectStart, onSelectEnd });
  };

  const teardown = async () => {
    inputBridge.updatePointer(lastPointer, false);

    if (!renderer) return;

    renderer.setAnimationLoop(null);
    window.removeEventListener('resize', onResize);

    controllerBindings.forEach(({ controller, onSelectStart, onSelectEnd }) => {
      controller.removeEventListener('selectstart', onSelectStart);
      controller.removeEventListener('selectend', onSelectEnd);
      disposeObjectTree(controller);
      controller.clear();
      if (scene) scene.remove(controller);
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
      attachController();

      await renderer.xr.setSession(session);

      window.addEventListener('resize', onResize);

      renderer.setAnimationLoop(() => {
        if (!renderer || !scene || !camera) return;

        if (panelTexture) panelTexture.needsUpdate = true;
        updatePanelInteraction();
        renderer.render(scene, camera);
      });

      notify('XR ready: play the 2D game on the floating panel');
    },
    async stop() {
      await teardown();
    }
  };
};
