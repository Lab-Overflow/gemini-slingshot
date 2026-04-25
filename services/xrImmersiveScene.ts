import * as THREE from 'three';

type BubbleColorHex = '#ef5350' | '#42a5f5' | '#66bb6a' | '#ffee58' | '#ab47bc' | '#ffa726';

type SceneBubble = {
  index: number;
  active: boolean;
  radius: number;
  respawnAt: number;
  color: BubbleColorHex;
  position: THREE.Vector3;
};

type Projectile = {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  radius: number;
};

type ControllerBinding = {
  controller: THREE.Group;
  onSelectStart: () => void;
};

type XrSceneStatus = (message: string) => void;

const BUBBLE_COLORS: BubbleColorHex[] = ['#ef5350', '#42a5f5', '#66bb6a', '#ffee58', '#ab47bc', '#ffa726'];
const MAX_BUBBLES = 12 * 8;
const PROJECTILE_SPEED = 3.35;
const MAX_PROJECTILES = 10;

const pickBubbleColor = (): BubbleColorHex => BUBBLE_COLORS[Math.floor(Math.random() * BUBBLE_COLORS.length)];

export type XrImmersiveSceneController = {
  start: (session: XRSession) => Promise<void>;
  stop: () => Promise<void>;
};

export const createXrImmersiveScene = (
  mountEl: HTMLElement,
  onStatus?: XrSceneStatus
): XrImmersiveSceneController => {
  const notify = (message: string) => {
    if (onStatus) onStatus(message);
  };

  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let bubbleMesh: THREE.InstancedMesh | null = null;
  let bubbleWallGroup: THREE.Group | null = null;
  let particleCloud: THREE.Points | null = null;
  let slingshotBand: THREE.Mesh | null = null;
  let projectileGeometry: THREE.SphereGeometry | null = null;
  let projectileMaterial: THREE.MeshStandardMaterial | null = null;

  const clock = new THREE.Clock();
  const projectiles: Projectile[] = [];
  const bubbles: SceneBubble[] = [];
  const controllerBindings: ControllerBinding[] = [];

  const tmpPosition = new THREE.Vector3();
  const tmpDirection = new THREE.Vector3();
  const tmpQuaternion = new THREE.Quaternion();
  const tmpScale = new THREE.Vector3();
  const tmpMatrix = new THREE.Matrix4();
  const tmpColor = new THREE.Color();
  const tmpBubbleWorldPosition = new THREE.Vector3();

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

  const setBubbleInstance = (bubble: SceneBubble, visible: boolean) => {
    if (!bubbleMesh) return;

    const scale = visible ? bubble.radius : 0.0001;
    tmpScale.set(scale, scale, scale);
    tmpQuaternion.identity();
    tmpMatrix.compose(bubble.position, tmpQuaternion, tmpScale);
    bubbleMesh.setMatrixAt(bubble.index, tmpMatrix);
    bubbleMesh.setColorAt(bubble.index, tmpColor.set(bubble.color));
    bubbleMesh.instanceMatrix.needsUpdate = true;
    if (bubbleMesh.instanceColor) bubbleMesh.instanceColor.needsUpdate = true;
  };

  const disposeProjectile = (projectile: Projectile) => {
    if (!scene) return;
    scene.remove(projectile.mesh);
  };

  const spawnProjectile = (controller: THREE.Group) => {
    if (!scene || !projectileGeometry || !projectileMaterial) return;

    if (projectiles.length >= MAX_PROJECTILES) {
      const oldest = projectiles.shift();
      if (oldest) disposeProjectile(oldest);
    }

    const projectileMesh = new THREE.Mesh(projectileGeometry, projectileMaterial);

    controller.getWorldPosition(tmpPosition);
    controller.getWorldQuaternion(tmpQuaternion);
    tmpDirection.set(0, 0, -1).applyQuaternion(tmpQuaternion).normalize();

    projectileMesh.position.copy(tmpPosition);

    const velocity = tmpDirection.multiplyScalar(PROJECTILE_SPEED);
    const projectile: Projectile = {
      mesh: projectileMesh,
      velocity: velocity.clone(),
      life: 3.4,
      radius: 0.024
    };

    projectiles.push(projectile);
    scene.add(projectileMesh);
    notify('XR shot launched');
  };

  const createSlingshot = () => {
    const group = new THREE.Group();

    const frameMaterial = new THREE.MeshStandardMaterial({
      color: 0xb0bec5,
      roughness: 0.35,
      metalness: 0.75
    });

    const bandMaterial = new THREE.MeshStandardMaterial({
      color: 0xfdd835,
      roughness: 0.45,
      metalness: 0.08,
      emissive: 0x8a7400,
      emissiveIntensity: 0.45
    });

    const armGeometry = new THREE.CylinderGeometry(0.012, 0.012, 0.25, 8);
    const baseGeometry = new THREE.CylinderGeometry(0.015, 0.015, 0.2, 8);

    const leftArm = new THREE.Mesh(armGeometry, frameMaterial);
    leftArm.position.set(-0.09, 0.1, 0);
    leftArm.rotation.z = Math.PI * 0.18;

    const rightArm = new THREE.Mesh(armGeometry, frameMaterial);
    rightArm.position.set(0.09, 0.1, 0);
    rightArm.rotation.z = -Math.PI * 0.18;

    const base = new THREE.Mesh(baseGeometry, frameMaterial);
    base.position.set(0, -0.045, 0);

    const bandGeometry = new THREE.TorusGeometry(0.11, 0.006, 6, 28, Math.PI * 0.52);
    const band = new THREE.Mesh(bandGeometry, bandMaterial);
    band.position.set(0, 0.18, -0.01);
    band.rotation.z = Math.PI;

    group.add(leftArm, rightArm, base, band);
    group.position.set(0, 1.13, -0.46);

    slingshotBand = band;
    return group;
  };

  const createBubbleWall = () => {
    if (!scene) return;

    bubbleWallGroup = new THREE.Group();
    bubbleWallGroup.position.set(0, 1.52, -1.62);
    bubbleWallGroup.rotation.x = -0.13;

    const bubbleGeometry = new THREE.SphereGeometry(1, 12, 8);
    const bubbleMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.28,
      metalness: 0.04,
      vertexColors: true
    });

    bubbleMesh = new THREE.InstancedMesh(bubbleGeometry, bubbleMaterial, MAX_BUBBLES);
    bubbleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    bubbleWallGroup.add(bubbleMesh);

    const cols = 12;
    const rows = 8;
    const spacingX = 0.145;
    const spacingY = 0.125;
    const radius = 0.06;
    const leftEdge = -((cols - 1) * spacingX) / 2;
    const topEdge = ((rows - 1) * spacingY) / 2;

    let index = 0;
    for (let row = 0; row < rows; row += 1) {
      const rowCount = row % 2 === 0 ? cols : cols - 1;
      const offsetX = row % 2 === 0 ? 0 : spacingX / 2;

      for (let col = 0; col < rowCount; col += 1) {
        const color = pickBubbleColor();
        const bubble: SceneBubble = {
          index,
          active: true,
          radius,
          respawnAt: 0,
          color,
          position: new THREE.Vector3(leftEdge + col * spacingX + offsetX, topEdge - row * spacingY, 0)
        };

        bubbles.push(bubble);
        setBubbleInstance(bubble, true);
        index += 1;
      }
    }

    for (; index < MAX_BUBBLES; index += 1) {
      const bubble: SceneBubble = {
        index,
        active: false,
        radius,
        respawnAt: Number.POSITIVE_INFINITY,
        color: '#42a5f5',
        position: new THREE.Vector3(0, -20, 0)
      };
      setBubbleInstance(bubble, false);
    }

    scene.add(bubbleWallGroup);
  };

  const createAtmosphere = () => {
    if (!scene) return;

    const grid = new THREE.GridHelper(4.2, 20, 0x3a556d, 0x243748);
    const gridMat = grid.material as THREE.Material;
    gridMat.transparent = true;
    gridMat.opacity = 0.3;
    grid.position.y = 0.02;
    scene.add(grid);

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x1d3c5e,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 2.2, 56), ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.014;
    scene.add(ring);

    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(1.08, 0.006, 6, 72),
      new THREE.MeshBasicMaterial({ color: 0x42a5f5, transparent: true, opacity: 0.34 })
    );
    halo.position.set(0, 1.48, -1.64);
    halo.rotation.x = Math.PI / 2 - 0.13;
    scene.add(halo);

    const particleCount = 120;
    const particleGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i += 1) {
      const r = 2.15 + Math.random() * 1.55;
      const theta = Math.random() * Math.PI * 2;
      const y = 0.35 + Math.random() * 1.9;
      const color = new THREE.Color(pickBubbleColor());

      positions[i * 3] = Math.cos(theta) * r;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = Math.sin(theta) * r;

      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particleGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    particleCloud = new THREE.Points(
      particleGeometry,
      new THREE.PointsMaterial({
        size: 0.03,
        vertexColors: true,
        transparent: true,
        opacity: 0.25,
        depthWrite: false
      })
    );

    scene.add(particleCloud);
  };

  const attachController = () => {
    if (!renderer || !scene) return;

    const controller = renderer.xr.getController(0);
    const ray = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -1)
      ]),
      new THREE.LineBasicMaterial({ color: 0xa8c7fa, transparent: true, opacity: 0.85 })
    );
    ray.scale.z = 2.8;

    const reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.017, 0.025, 18),
      new THREE.MeshBasicMaterial({ color: 0xfdd835, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
    );
    reticle.position.z = -0.42;

    controller.add(ray, reticle);

    const onSelectStart = () => spawnProjectile(controller);
    controller.addEventListener('selectstart', onSelectStart);

    scene.add(controller);
    controllerBindings.push({ controller, onSelectStart });
  };

  const update = (deltaSeconds: number, elapsedSeconds: number) => {
    if (!scene) return;

    if (slingshotBand) {
      const pulse = 1 + Math.sin(elapsedSeconds * 2.8) * 0.055;
      slingshotBand.scale.setScalar(pulse);
    }

    if (particleCloud) {
      particleCloud.rotation.y += deltaSeconds * 0.055;
    }

    for (let i = projectiles.length - 1; i >= 0; i -= 1) {
      const projectile = projectiles[i];
      projectile.mesh.position.addScaledVector(projectile.velocity, deltaSeconds);
      projectile.life -= deltaSeconds;

      let shouldDestroy = projectile.life <= 0;

      if (!shouldDestroy && bubbleWallGroup) {
        for (let b = 0; b < bubbles.length; b += 1) {
          const bubble = bubbles[b];
          if (!bubble.active) continue;

          const hitDist = bubble.radius + projectile.radius;
          tmpBubbleWorldPosition.copy(bubble.position);
          bubbleWallGroup.localToWorld(tmpBubbleWorldPosition);

          if (projectile.mesh.position.distanceToSquared(tmpBubbleWorldPosition) <= hitDist * hitDist) {
            bubble.active = false;
            bubble.respawnAt = elapsedSeconds + 4 + Math.random() * 2;
            setBubbleInstance(bubble, false);
            shouldDestroy = true;
            notify('XR hit confirmed');
            break;
          }
        }
      }

      if (shouldDestroy) {
        disposeProjectile(projectile);
        projectiles.splice(i, 1);
      }
    }

    for (let i = 0; i < bubbles.length; i += 1) {
      const bubble = bubbles[i];
      if (bubble.active || elapsedSeconds < bubble.respawnAt) continue;

      bubble.color = pickBubbleColor();
      bubble.active = true;
      setBubbleInstance(bubble, true);
    }
  };

  const teardown = async () => {
    if (!renderer) return;

    renderer.setAnimationLoop(null);
    window.removeEventListener('resize', onResize);

    controllerBindings.forEach(({ controller, onSelectStart }) => {
      controller.removeEventListener('selectstart', onSelectStart);
      disposeObjectTree(controller);
      controller.clear();
      if (scene) scene.remove(controller);
    });
    controllerBindings.length = 0;

    projectiles.splice(0).forEach(disposeProjectile);
    bubbles.length = 0;

    if (scene) {
      disposeObjectTree(scene);
    }
    projectileGeometry?.dispose();
    projectileMaterial?.dispose();

    renderer.dispose();
    renderer.forceContextLoss();

    if (renderer.domElement.parentElement === mountEl) {
      mountEl.removeChild(renderer.domElement);
    }

    scene = null;
    camera = null;
    bubbleMesh = null;
    bubbleWallGroup = null;
    particleCloud = null;
    slingshotBand = null;
    projectileGeometry = null;
    projectileMaterial = null;
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
      renderer.xr.setFramebufferScaleFactor(0.8);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setClearColor(0x121212, 1);

      renderer.domElement.style.position = 'absolute';
      renderer.domElement.style.inset = '0';
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      renderer.domElement.style.zIndex = '30';
      renderer.domElement.style.pointerEvents = 'none';

      mountEl.appendChild(renderer.domElement);

      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x121212);

      camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
      projectileGeometry = new THREE.SphereGeometry(0.024, 8, 6);
      projectileMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.22,
        metalness: 0.04,
        emissive: 0xa8c7fa,
        emissiveIntensity: 0.55
      });

      scene.add(new THREE.HemisphereLight(0xa8c7fa, 0x06080a, 0.85));

      const keyLight = new THREE.PointLight(0xffffff, 5.6, 5.2);
      keyLight.position.set(0, 2.05, 0.2);
      scene.add(keyLight);

      const wallLight = new THREE.PointLight(0x42a5f5, 3.4, 4.8);
      wallLight.position.set(0, 1.55, -1.25);
      scene.add(wallLight);

      createAtmosphere();
      createBubbleWall();
      scene.add(createSlingshot());
      attachController();

      await renderer.xr.setSession(session);

      window.addEventListener('resize', onResize);
      clock.start();

      renderer.setAnimationLoop(() => {
        if (!renderer || !scene || !camera) return;
        const deltaSeconds = Math.min(clock.getDelta(), 0.05);
        update(deltaSeconds, clock.elapsedTime);
        renderer.render(scene, camera);
      });

      notify('XR scene ready: aim with one controller, select to launch');
    },
    async stop() {
      await teardown();
    }
  };
};
