/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { getStrategicHint, TargetCandidate } from '../services/geminiService';
import { Point, Bubble, Particle, BubbleColor, DebugInfo, AiProvider } from '../types';
import { Loader2, Trophy, BrainCircuit, Play, MousePointerClick, Eye, Terminal, AlertTriangle, Target, Lightbulb, Monitor, Maximize2, Minimize2 } from 'lucide-react';

const PINCH_THRESHOLD = 0.05;
const GRAVITY = 0.0; 
const FRICTION = 0.998; 

const BUBBLE_RADIUS = 22;
const ROW_HEIGHT = BUBBLE_RADIUS * Math.sqrt(3);
const GRID_COLS = 12;
const GRID_ROWS = 8;
const SLINGSHOT_BOTTOM_OFFSET = 220;

const MAX_DRAG_DIST = 180;
const MIN_FORCE_MULT = 0.15;
const MAX_FORCE_MULT = 0.45;

type InputMode = 'gesture' | 'controller';
type XrImmersiveSceneController = {
  start: (session: XRSession) => Promise<void>;
  stop: () => Promise<void>;
};

// Material Design Colors & Scoring Strategy
const COLOR_CONFIG: Record<BubbleColor, { hex: string, points: number, label: string }> = {
  red:    { hex: '#ef5350', points: 100, label: 'Red' },     // Material Red 400
  blue:   { hex: '#42a5f5', points: 150, label: 'Blue' },    // Material Blue 400
  green:  { hex: '#66bb6a', points: 200, label: 'Green' },   // Material Green 400
  yellow: { hex: '#ffee58', points: 250, label: 'Yellow' },  // Material Yellow 400
  purple: { hex: '#ab47bc', points: 300, label: 'Purple' },  // Material Purple 400
  orange: { hex: '#ffa726', points: 500, label: 'Orange' }   // Material Orange 400
};

const COLOR_KEYS: BubbleColor[] = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'];

// Color Helper for Gradients
const adjustColor = (color: string, amount: number) => {
    const hex = color.replace('#', '');
    const r = Math.max(0, Math.min(255, parseInt(hex.substring(0, 2), 16) + amount));
    const g = Math.max(0, Math.min(255, parseInt(hex.substring(2, 4), 16) + amount));
    const b = Math.max(0, Math.min(255, parseInt(hex.substring(4, 6), 16) + amount));
    
    const componentToHex = (c: number) => {
        const hex = c.toString(16);
        return hex.length === 1 ? "0" + hex : hex;
    };
    
    return "#" + componentToHex(r) + componentToHex(g) + componentToHex(b);
};

const GeminiSlingshot: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameContainerRef = useRef<HTMLDivElement>(null);
  
  // Game State Refs
  const ballPos = useRef<Point>({ x: 0, y: 0 });
  const ballVel = useRef<Point>({ x: 0, y: 0 });
  const anchorPos = useRef<Point>({ x: 0, y: 0 });
  const isPinching = useRef<boolean>(false);
  const isFlying = useRef<boolean>(false);
  const flightStartTime = useRef<number>(0);
  const bubbles = useRef<Bubble[]>([]);
  const particles = useRef<Particle[]>([]);
  const scoreRef = useRef<number>(0);
  
  const aimTargetRef = useRef<Point | null>(null);
  const isAiThinkingRef = useRef<boolean>(false);
  const aiRecommendedColorRef = useRef<BubbleColor | null>(null);
  const aiProviderRef = useRef<AiProvider>('openai');
  const aiModelOverrideRef = useRef<string>('');
  const inputModeRef = useRef<InputMode>('controller');
  const availableColorsRef = useRef<BubbleColor[]>([]);
  const controllerPointerRef = useRef<{ position: Point; isDown: boolean }>({
    position: { x: 0, y: 0 },
    isDown: false
  });
  const controllerStatusRef = useRef<string>('Controller inactive');
  const xrSessionRef = useRef<any>(null);
  const xrImmersiveSceneRef = useRef<XrImmersiveSceneController | null>(null);
  
  // AI Request Trigger
  const captureRequestRef = useRef<boolean>(false);

  // Current active color (Ref for loop, State for UI)
  const selectedColorRef = useRef<BubbleColor>('red');
  
  // React State
  const [loading, setLoading] = useState(true);
  const [aiHint, setAiHint] = useState<string | null>("Initializing strategy engine...");
  const [aiRationale, setAiRationale] = useState<string | null>(null);
  const [aimTarget, setAimTarget] = useState<Point | null>(null);
  const [score, setScore] = useState(0);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [selectedColor, setSelectedColor] = useState<BubbleColor>('red');
  const [availableColors, setAvailableColors] = useState<BubbleColor[]>([]);
  const [aiRecommendedColor, setAiRecommendedColor] = useState<BubbleColor | null>(null);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [aiProvider, setAiProvider] = useState<AiProvider>('openai');
  const [aiModelOverride, setAiModelOverride] = useState('');
  const [inputMode, setInputMode] = useState<InputMode>('controller');
  const [inputStatus, setInputStatus] = useState('Controller inactive');
  const [xrSupported, setXrSupported] = useState(false);
  const [xrActive, setXrActive] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Sync state to ref
  useEffect(() => {
    selectedColorRef.current = selectedColor;
  }, [selectedColor]);

  useEffect(() => {
    aimTargetRef.current = aimTarget;
  }, [aimTarget]);

  useEffect(() => {
    isAiThinkingRef.current = isAiThinking;
  }, [isAiThinking]);

  useEffect(() => {
    aiRecommendedColorRef.current = aiRecommendedColor;
  }, [aiRecommendedColor]);

  useEffect(() => {
    aiProviderRef.current = aiProvider;
  }, [aiProvider]);

  useEffect(() => {
    aiModelOverrideRef.current = aiModelOverride;
  }, [aiModelOverride]);

  useEffect(() => {
    inputModeRef.current = inputMode;
  }, [inputMode]);

  useEffect(() => {
    availableColorsRef.current = availableColors;
  }, [availableColors]);

  useEffect(() => {
    const storedProvider = window.localStorage.getItem('ai-provider');
    const storedModel = window.localStorage.getItem('ai-model-override');
    if (storedProvider === 'gemini' || storedProvider === 'openai' || storedProvider === 'anthropic') {
      setAiProvider(storedProvider);
    }
    if (storedModel) {
      setAiModelOverride(storedModel);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem('ai-provider', aiProvider);
  }, [aiProvider]);

  useEffect(() => {
    window.localStorage.setItem('ai-model-override', aiModelOverride);
  }, [aiModelOverride]);

  const setControllerStatus = useCallback((status: string) => {
    if (controllerStatusRef.current === status) return;
    controllerStatusRef.current = status;
    setInputStatus(status);
  }, []);

  useEffect(() => {
    const xr = (navigator as any).xr;
    if (!xr || typeof xr.isSessionSupported !== 'function') {
      setXrSupported(false);
      return;
    }
    xr.isSessionSupported('immersive-vr')
      .then((supported: boolean) => setXrSupported(Boolean(supported)))
      .catch(() => setXrSupported(false));
  }, []);

  const startVrSession = useCallback(async () => {
    const mountEl = gameContainerRef.current;
    const xr = (navigator as any).xr;
    if (!xr || typeof xr.requestSession !== 'function') {
      setControllerStatus('WebXR not available in this browser');
      return;
    }
    if (!mountEl) {
      setControllerStatus('XR mount point unavailable');
      return;
    }

    try {
      const session = await xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking']
      });

      const { createXrImmersiveScene } = await import('../services/xrImmersiveScene');
      const immersiveScene = createXrImmersiveScene(mountEl, setControllerStatus);
      xrImmersiveSceneRef.current = immersiveScene;
      await immersiveScene.start(session);

      xrSessionRef.current = session;
      setXrActive(true);
      setInputMode('controller');
      setControllerStatus('XR immersive scene active');

      session.addEventListener('end', () => {
        xrSessionRef.current = null;
        setXrActive(false);
        const sceneController = xrImmersiveSceneRef.current;
        xrImmersiveSceneRef.current = null;
        sceneController?.stop().catch(() => {});
        setControllerStatus('XR session ended');
      });
    } catch (error) {
      const sceneController = xrImmersiveSceneRef.current;
      xrImmersiveSceneRef.current = null;
      sceneController?.stop().catch(() => {});
      if (xrSessionRef.current) {
        xrSessionRef.current.end().catch(() => {});
        xrSessionRef.current = null;
      }
      setControllerStatus('Failed to start XR session');
      console.error('XR session error:', error);
    }
  }, [setControllerStatus]);

  const stopVrSession = useCallback(async () => {
    const sceneController = xrImmersiveSceneRef.current;
    if (!xrSessionRef.current) {
      if (sceneController) {
        await sceneController.stop();
        xrImmersiveSceneRef.current = null;
      }
      return;
    }
    try {
      await xrSessionRef.current.end();
      await sceneController?.stop();
      xrImmersiveSceneRef.current = null;
    } catch (error) {
      console.warn('Failed to end XR session:', error);
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const target = gameContainerRef.current;
    if (!target) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await target.requestFullscreen();
      }
    } catch (error) {
      console.warn('Fullscreen toggle failed:', error);
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    controllerPointerRef.current.isDown = false;
    if (inputMode === 'gesture') {
      setControllerStatus('Gesture mode active');
      setAiHint('Gesture mode: AI strategy enabled.');
      setAiRationale(null);
      setAiRecommendedColor(null);
      setAimTarget(null);
      setDebugInfo(null);
      setIsAiThinking(false);
      isAiThinkingRef.current = false;
      captureRequestRef.current = true;
    } else {
      setControllerStatus('Mouse drag mode active');
      setAiHint('Controller mode: manual mouse drag (AI disabled).');
      setAiRationale(null);
      setAiRecommendedColor(null);
      setAimTarget(null);
      setDebugInfo(null);
      setIsAiThinking(false);
      isAiThinkingRef.current = false;
    }
  }, [inputMode, setControllerStatus]);

  useEffect(() => {
    return () => {
      if (xrSessionRef.current) {
        xrSessionRef.current.end().catch(() => {});
      }
      if (xrImmersiveSceneRef.current) {
        xrImmersiveSceneRef.current.stop().catch(() => {});
        xrImmersiveSceneRef.current = null;
      }
    };
  }, []);
  
  const getBubblePos = (row: number, col: number, width: number) => {
    const xOffset = (width - (GRID_COLS * BUBBLE_RADIUS * 2)) / 2 + BUBBLE_RADIUS;
    const isOdd = row % 2 !== 0;
    const x = xOffset + col * (BUBBLE_RADIUS * 2) + (isOdd ? BUBBLE_RADIUS : 0);
    const y = BUBBLE_RADIUS + row * ROW_HEIGHT;
    return { x, y };
  };

  const updateAvailableColors = () => {
    const activeColors = new Set<BubbleColor>();
    bubbles.current.forEach(b => {
        if (b.active) activeColors.add(b.color);
    });
    setAvailableColors(Array.from(activeColors));
    
    // If current selected color is gone, switch to first available
    if (!activeColors.has(selectedColorRef.current) && activeColors.size > 0) {
        const next = Array.from(activeColors)[0];
        setSelectedColor(next);
    }
  };

  const initGrid = useCallback((width: number) => {
    const newBubbles: Bubble[] = [];
    for (let r = 0; r < 5; r++) { 
      for (let c = 0; c < (r % 2 !== 0 ? GRID_COLS - 1 : GRID_COLS); c++) {
        if (Math.random() > 0.1) {
            const { x, y } = getBubblePos(r, c, width);
            newBubbles.push({
              id: `${r}-${c}`,
              row: r,
              col: c,
              x,
              y,
              color: COLOR_KEYS[Math.floor(Math.random() * COLOR_KEYS.length)],
              active: true
            });
        }
      }
    }
    bubbles.current = newBubbles;
    updateAvailableColors();
    
    // Trigger initial AI analysis after a short delay to allow render (gesture mode only).
    setTimeout(() => {
        if (inputModeRef.current === 'gesture') {
          captureRequestRef.current = true;
        }
    }, 2000);
  }, []);

  const createExplosion = (x: number, y: number, color: string) => {
    for (let i = 0; i < 15; i++) {
      particles.current.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 12,
        vy: (Math.random() - 0.5) * 12,
        life: 1.0,
        color
      });
    }
  };

  const isPathClear = (target: Bubble) => {
    if (!anchorPos.current) return false;
    
    const startX = anchorPos.current.x;
    const startY = anchorPos.current.y;
    const endX = target.x;
    const endY = target.y;

    const dx = endX - startX;
    const dy = endY - startY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(distance / (BUBBLE_RADIUS / 2)); 

    for (let i = 1; i < steps - 2; i++) { 
        const t = i / steps;
        const cx = startX + dx * t;
        const cy = startY + dy * t;

        for (const b of bubbles.current) {
            if (!b.active || b.id === target.id) continue;
            const distSq = Math.pow(cx - b.x, 2) + Math.pow(cy - b.y, 2);
            if (distSq < Math.pow(BUBBLE_RADIUS * 1.8, 2)) {
                return false; 
            }
        }
    }
    return true;
  };

  const getAllReachableClusters = (): TargetCandidate[] => {
    const activeBubbles = bubbles.current.filter(b => b.active);
    const uniqueColors = Array.from(new Set(activeBubbles.map(b => b.color))) as BubbleColor[];
    const allClusters: TargetCandidate[] = [];

    // Analyze opportunities for ALL colors
    for (const color of uniqueColors) {
        const visited = new Set<string>();
        
        for (const b of activeBubbles) {
            if (b.color !== color || visited.has(b.id)) continue;

            const clusterMembers: Bubble[] = [];
            const queue = [b];
            visited.add(b.id);

            while (queue.length > 0) {
                const curr = queue.shift()!;
                clusterMembers.push(curr);
                
                const neighbors = activeBubbles.filter(n => 
                    !visited.has(n.id) && n.color === color && isNeighbor(curr, n)
                );
                neighbors.forEach(n => {
                    visited.add(n.id);
                    queue.push(n);
                });
            }

            // Check if this cluster is hittable
            clusterMembers.sort((a,b) => b.y - a.y); 
            const hittableMember = clusterMembers.find(m => isPathClear(m));

            if (hittableMember) {
                const xPct = hittableMember.x / (gameContainerRef.current?.clientWidth || window.innerWidth);
                let desc = "Center";
                if (xPct < 0.33) desc = "Left";
                else if (xPct > 0.66) desc = "Right";

                allClusters.push({
                    id: hittableMember.id,
                    color: color,
                    size: clusterMembers.length,
                    row: hittableMember.row,
                    col: hittableMember.col,
                    pointsPerBubble: COLOR_CONFIG[color].points,
                    description: `${desc}`
                });
            }
        }
    }
    return allClusters;
  };

  const checkMatches = (startBubble: Bubble) => {
    const toCheck = [startBubble];
    const visited = new Set<string>();
    const matches: Bubble[] = [];
    const targetColor = startBubble.color;

    while (toCheck.length > 0) {
      const current = toCheck.pop()!;
      if (visited.has(current.id)) continue;
      visited.add(current.id);

      if (current.color === targetColor) {
        matches.push(current);
        const neighbors = bubbles.current.filter(b => b.active && !visited.has(b.id) && isNeighbor(current, b));
        toCheck.push(...neighbors);
      }
    }

    if (matches.length >= 3) {
      let points = 0;
      const basePoints = COLOR_CONFIG[targetColor].points;
      
      matches.forEach(b => {
        b.active = false;
        createExplosion(b.x, b.y, COLOR_CONFIG[b.color].hex);
        points += basePoints;
      });
      // Combo Multiplier
      const multiplier = matches.length > 3 ? 1.5 : 1.0;
      scoreRef.current += Math.floor(points * multiplier);
      setScore(scoreRef.current);
      return true;
    }
    return false;
  };

  const isNeighbor = (a: Bubble, b: Bubble) => {
    const dr = b.row - a.row;
    const dc = b.col - a.col;
    if (Math.abs(dr) > 1) return false;
    if (dr === 0) return Math.abs(dc) === 1;
    if (a.row % 2 !== 0) {
        return dc === 0 || dc === 1;
    } else {
        return dc === -1 || dc === 0;
    }
  };

  const performAiAnalysis = async (screenshot: string) => {
    if (inputModeRef.current !== 'gesture') {
      return;
    }

    // Lock interaction immediately via ref (fast) and state (render)
    isAiThinkingRef.current = true;
    setIsAiThinking(true);
    setAiHint("Analyzing tactical options...");
    setAiRationale(null);
    setAiRecommendedColor(null);
    setAimTarget(null);

    // Client-Side Pre-Calc for ALL colors
    const allClusters = getAllReachableClusters();
    const maxRow = bubbles.current.reduce((max, b) => b.active ? Math.max(max, b.row) : max, 0);

    const canvasWidth = canvasRef.current?.width || 1000;

    getStrategicHint(
        screenshot,
        allClusters,
        maxRow,
        {
          provider: aiProviderRef.current,
          model: aiModelOverrideRef.current.trim() || undefined
        }
    ).then(aiResponse => {
        const { hint, debug } = aiResponse;
        setDebugInfo(debug);
        setAiHint(hint.message);
        setAiRationale(hint.rationale || null);
        
        if (typeof hint.targetRow === 'number' && typeof hint.targetCol === 'number') {
            if (hint.recommendedColor) {
                setAiRecommendedColor(hint.recommendedColor);
                setSelectedColor(hint.recommendedColor); // Auto-equip recommendation
            }
            const pos = getBubblePos(hint.targetRow, hint.targetCol, canvasWidth);
            setAimTarget(pos);
        }
        
        // Unlock
        isAiThinkingRef.current = false;
        setIsAiThinking(false);
    });
  };

  // --- Rendering Helper ---
  const drawBubble = (ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, colorKey: BubbleColor) => {
    const config = COLOR_CONFIG[colorKey];
    const baseColor = config.hex;
    
    // Main Sphere Gradient (gives 3D depth)
    // Shifted focus to top-left for light source
    const grad = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, radius * 0.1, x, y, radius);
    grad.addColorStop(0, '#ffffff');             // Specular highlight center (brightest)
    grad.addColorStop(0.2, baseColor);           // Main color body
    grad.addColorStop(1, adjustColor(baseColor, -60)); // Shadowed edge (darkest)

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Subtle Outline for definition
    ctx.strokeStyle = adjustColor(baseColor, -80);
    ctx.lineWidth = 1;
    ctx.stroke();
    
    // Secondary "Glossy" Highlight (Hard reflection)
    ctx.beginPath();
    ctx.ellipse(x - radius * 0.3, y - radius * 0.35, radius * 0.25, radius * 0.15, Math.PI / 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fill();
  };

  // --- Main Game Loop ---

  useEffect(() => {
    if (!canvasRef.current || !gameContainerRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const container = gameContainerRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

    const resizeCanvas = () => {
      if (canvas.width === container.clientWidth && canvas.height === container.clientHeight) return;
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      anchorPos.current = { x: canvas.width / 2, y: canvas.height - SLINGSHOT_BOTTOM_OFFSET };
      if (!isFlying.current && !isPinching.current) {
        ballPos.current = { ...anchorPos.current };
      }
      if (!controllerPointerRef.current.position.x && !controllerPointerRef.current.position.y) {
        controllerPointerRef.current.position = { ...anchorPos.current };
      }
    };

    resizeCanvas();
    anchorPos.current = { x: canvas.width / 2, y: canvas.height - SLINGSHOT_BOTTOM_OFFSET };
    ballPos.current = { ...anchorPos.current };
    controllerPointerRef.current.position = { ...anchorPos.current };

    initGrid(canvas.width);

    let camera: any = null;
    let hands: any = null;
    let rafId = 0;
    let didClearLoading = false;

    const getCanvasPoint = (event: PointerEvent): Point => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: clamp((event.clientX - rect.left) * scaleX, 0, canvas.width),
        y: clamp((event.clientY - rect.top) * scaleY, 0, canvas.height)
      };
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (inputModeRef.current !== 'controller') return;
      event.preventDefault();

      const position = getCanvasPoint(event);
      controllerPointerRef.current.position = position;

      const dx = position.x - ballPos.current.x;
      const dy = position.y - ballPos.current.y;
      const canGrab = !isFlying.current && !isAiThinkingRef.current && Math.sqrt(dx * dx + dy * dy) < 100;

      if (canGrab) {
        controllerPointerRef.current.isDown = true;
        canvas.setPointerCapture?.(event.pointerId);
        setControllerStatus('Dragging ball');
      } else {
        controllerPointerRef.current.isDown = false;
        setControllerStatus('Click near the ball to drag');
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (inputModeRef.current !== 'controller') return;
      controllerPointerRef.current.position = getCanvasPoint(event);
    };

    const releasePointer = (event: PointerEvent) => {
      if (inputModeRef.current !== 'controller') return;
      event.preventDefault();
      controllerPointerRef.current.position = getCanvasPoint(event);
      controllerPointerRef.current.isDown = false;
      if (canvas.hasPointerCapture?.(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      setControllerStatus('Mouse drag mode active');
    };

    const cancelPointer = () => {
      controllerPointerRef.current.isDown = false;
      setControllerStatus('Mouse drag mode active');
    };

    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', releasePointer);
    canvas.addEventListener('pointercancel', cancelPointer);

    const renderFrame = (results?: any, deltaMs = 16) => {
      if (!didClearLoading) {
        setLoading(false);
        didClearLoading = true;
      }

      resizeCanvas();

      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (results?.image) {
        ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(18, 18, 18, 0.85)';
      } else {
        const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
        bg.addColorStop(0, '#0f1116');
        bg.addColorStop(1, '#1a1d24');
        ctx.fillStyle = bg;
      }
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      let handPos: Point | null = null;
      let pinchDist = 1.0;
      let requiresProximity = true;

      if (inputMode === 'gesture') {
        if (results?.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
          const landmarks = results.multiHandLandmarks[0];
          const idxTip = landmarks[8];
          const thumbTip = landmarks[4];

          handPos = {
            x: (idxTip.x * canvas.width + thumbTip.x * canvas.width) / 2,
            y: (idxTip.y * canvas.height + thumbTip.y * canvas.height) / 2
          };

          const dx = idxTip.x - thumbTip.x;
          const dy = idxTip.y - thumbTip.y;
          pinchDist = Math.sqrt(dx * dx + dy * dy);

          if (window.drawConnectors && window.drawLandmarks) {
            window.drawConnectors(ctx, landmarks, window.HAND_CONNECTIONS, { color: '#669df6', lineWidth: 1 });
            window.drawLandmarks(ctx, landmarks, { color: '#aecbfa', lineWidth: 1, radius: 2 });
          }

          ctx.beginPath();
          ctx.arc(handPos.x, handPos.y, 20, 0, Math.PI * 2);
          ctx.strokeStyle = pinchDist < PINCH_THRESHOLD ? '#66bb6a' : '#ffffff';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      } else {
        const pointer = controllerPointerRef.current;
        handPos = pointer.isDown ? { ...pointer.position } : null;
        pinchDist = pointer.isDown ? 0.0 : 1.0;
      }

      const isHoldingLaunch = handPos && pinchDist < PINCH_THRESHOLD;
      const isLocked = isAiThinkingRef.current;

      if (!isLocked && handPos && isHoldingLaunch && !isFlying.current) {
        const distToBall = Math.sqrt(Math.pow(handPos.x - ballPos.current.x, 2) + Math.pow(handPos.y - ballPos.current.y, 2));
        if (!isPinching.current && (!requiresProximity || distToBall < 100)) {
          isPinching.current = true;
        }

        if (isPinching.current) {
          ballPos.current = { x: handPos.x, y: handPos.y };
          const dragDx = ballPos.current.x - anchorPos.current.x;
          const dragDy = ballPos.current.y - anchorPos.current.y;
          const dragDist = Math.sqrt(dragDx * dragDx + dragDy * dragDy);

          if (dragDist > MAX_DRAG_DIST) {
            const angle = Math.atan2(dragDy, dragDx);
            ballPos.current.x = anchorPos.current.x + Math.cos(angle) * MAX_DRAG_DIST;
            ballPos.current.y = anchorPos.current.y + Math.sin(angle) * MAX_DRAG_DIST;
          }
        }
      } else if (isPinching.current && (!isHoldingLaunch || isLocked)) {
        isPinching.current = false;

        if (isLocked) {
          ballPos.current = { ...anchorPos.current };
        } else {
          const dx = anchorPos.current.x - ballPos.current.x;
          const dy = anchorPos.current.y - ballPos.current.y;
          const stretchDist = Math.sqrt(dx * dx + dy * dy);

          if (stretchDist > 30) {
            isFlying.current = true;
            flightStartTime.current = performance.now();
            const powerRatio = Math.min(stretchDist / MAX_DRAG_DIST, 1.0);
            const velocityMultiplier = MIN_FORCE_MULT + (MAX_FORCE_MULT - MIN_FORCE_MULT) * (powerRatio * powerRatio);

            ballVel.current = {
              x: dx * velocityMultiplier,
              y: dy * velocityMultiplier
            };
          } else {
            ballPos.current = { ...anchorPos.current };
          }
        }
      } else if (!isFlying.current && !isPinching.current) {
        const dx = anchorPos.current.x - ballPos.current.x;
        const dy = anchorPos.current.y - ballPos.current.y;
        ballPos.current.x += dx * 0.15;
        ballPos.current.y += dy * 0.15;
      }

      if (isFlying.current) {
        if (performance.now() - flightStartTime.current > 5000) {
          isFlying.current = false;
          ballPos.current = { ...anchorPos.current };
          ballVel.current = { x: 0, y: 0 };
        } else {
          const currentSpeed = Math.sqrt(ballVel.current.x ** 2 + ballVel.current.y ** 2);
          const steps = Math.ceil(currentSpeed / (BUBBLE_RADIUS * 0.8));
          let collisionOccurred = false;

          for (let i = 0; i < steps; i++) {
            ballPos.current.x += ballVel.current.x / steps;
            ballPos.current.y += ballVel.current.y / steps;

            if (ballPos.current.x < BUBBLE_RADIUS || ballPos.current.x > canvas.width - BUBBLE_RADIUS) {
              ballVel.current.x *= -1;
              ballPos.current.x = clamp(ballPos.current.x, BUBBLE_RADIUS, canvas.width - BUBBLE_RADIUS);
            }

            if (ballPos.current.y < BUBBLE_RADIUS) {
              collisionOccurred = true;
              break;
            }

            for (const b of bubbles.current) {
              if (!b.active) continue;
              const dist = Math.sqrt(
                Math.pow(ballPos.current.x - b.x, 2) +
                Math.pow(ballPos.current.y - b.y, 2)
              );
              if (dist < BUBBLE_RADIUS * 1.8) {
                collisionOccurred = true;
                break;
              }
            }
            if (collisionOccurred) break;
          }

          ballVel.current.y += GRAVITY;
          ballVel.current.x *= FRICTION;
          ballVel.current.y *= FRICTION;

          if (collisionOccurred) {
            isFlying.current = false;

            let bestDist = Infinity;
            let bestRow = 0;
            let bestCol = 0;
            let bestX = 0;
            let bestY = 0;

            for (let r = 0; r < GRID_ROWS + 5; r++) {
              const colsInRow = r % 2 !== 0 ? GRID_COLS - 1 : GRID_COLS;
              for (let c = 0; c < colsInRow; c++) {
                const { x, y } = getBubblePos(r, c, canvas.width);
                const occupied = bubbles.current.some(b => b.active && b.row === r && b.col === c);
                if (occupied) continue;

                const dist = Math.sqrt(
                  Math.pow(ballPos.current.x - x, 2) +
                  Math.pow(ballPos.current.y - y, 2)
                );

                if (dist < bestDist) {
                  bestDist = dist;
                  bestRow = r;
                  bestCol = c;
                  bestX = x;
                  bestY = y;
                }
              }
            }

            const newBubble: Bubble = {
              id: `${bestRow}-${bestCol}-${Date.now()}`,
              row: bestRow,
              col: bestCol,
              x: bestX,
              y: bestY,
              color: selectedColorRef.current,
              active: true
            };
            bubbles.current.push(newBubble);
            checkMatches(newBubble);
            updateAvailableColors();

            ballPos.current = { ...anchorPos.current };
            ballVel.current = { x: 0, y: 0 };
            if (inputModeRef.current === 'gesture') {
              captureRequestRef.current = true;
            }
          }

          if (ballPos.current.y > canvas.height) {
            isFlying.current = false;
            ballPos.current = { ...anchorPos.current };
            ballVel.current = { x: 0, y: 0 };
          }
        }
      }

      bubbles.current.forEach(b => {
        if (!b.active) return;
        drawBubble(ctx, b.x, b.y, BUBBLE_RADIUS - 1, b.color);
      });

      const currentAimTarget = aimTargetRef.current;
      const thinking = isAiThinkingRef.current;
      const currentSelected = selectedColorRef.current;
      const recommendedColor = aiRecommendedColorRef.current;
      const shouldShowLine = currentAimTarget && !isFlying.current &&
        (!recommendedColor || recommendedColor === currentSelected);

      if (shouldShowLine || thinking) {
        ctx.save();
        const highlightColor = thinking ? '#a8c7fa' : COLOR_CONFIG[currentSelected].hex;

        ctx.shadowBlur = 15;
        ctx.shadowColor = highlightColor;

        ctx.beginPath();
        ctx.moveTo(anchorPos.current.x, anchorPos.current.y);
        if (currentAimTarget) {
          ctx.lineTo(currentAimTarget.x, currentAimTarget.y);
        } else {
          ctx.lineTo(anchorPos.current.x, anchorPos.current.y - 200);
        }

        const time = performance.now();
        const dashOffset = (time / 15) % 30;
        ctx.setLineDash([20, 15]);
        ctx.lineDashOffset = -dashOffset;

        ctx.strokeStyle = thinking ? 'rgba(168, 199, 250, 0.5)' : highlightColor;
        ctx.lineWidth = 4;
        ctx.stroke();

        if (currentAimTarget && !thinking) {
          ctx.beginPath();
          ctx.arc(currentAimTarget.x, currentAimTarget.y, BUBBLE_RADIUS, 0, Math.PI * 2);
          ctx.setLineDash([5, 5]);
          ctx.strokeStyle = highlightColor;
          ctx.fillStyle = 'rgba(255,255,255,0.1)';
          ctx.fill();
          ctx.stroke();
        }

        ctx.restore();
      }

      const bandColor = isPinching.current ? '#fdd835' : 'rgba(255,255,255,0.4)';
      if (!isFlying.current) {
        ctx.beginPath();
        ctx.moveTo(anchorPos.current.x - 35, anchorPos.current.y - 10);
        ctx.lineTo(ballPos.current.x, ballPos.current.y);
        ctx.lineWidth = 5;
        ctx.strokeStyle = bandColor;
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      ctx.save();
      if (isLocked && !isFlying.current) {
        ctx.globalAlpha = 0.5;
      }
      drawBubble(ctx, ballPos.current.x, ballPos.current.y, BUBBLE_RADIUS, selectedColorRef.current);
      ctx.restore();

      if (!isFlying.current) {
        ctx.beginPath();
        ctx.moveTo(ballPos.current.x, ballPos.current.y);
        ctx.lineTo(anchorPos.current.x + 35, anchorPos.current.y - 10);
        ctx.lineWidth = 5;
        ctx.strokeStyle = bandColor;
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.moveTo(anchorPos.current.x, canvas.height);
      ctx.lineTo(anchorPos.current.x, anchorPos.current.y + 40);
      ctx.lineTo(anchorPos.current.x - 40, anchorPos.current.y);
      ctx.moveTo(anchorPos.current.x, anchorPos.current.y + 40);
      ctx.lineTo(anchorPos.current.x + 40, anchorPos.current.y);
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#616161';
      ctx.stroke();

      for (let i = particles.current.length - 1; i >= 0; i--) {
        const p = particles.current[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.05;
        if (p.life <= 0) particles.current.splice(i, 1);
        else {
          ctx.globalAlpha = p.life;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.fill();
          ctx.globalAlpha = 1.0;
        }
      }

      ctx.restore();

      if (captureRequestRef.current) {
        captureRequestRef.current = false;

        // AI is intentionally disabled in controller mode for pure manual gameplay.
        if (inputModeRef.current !== 'gesture') {
          return;
        }

        const offscreen = document.createElement('canvas');
        const targetWidth = 480;
        const scale = Math.min(1, targetWidth / canvas.width);

        offscreen.width = canvas.width * scale;
        offscreen.height = canvas.height * scale;

        const oCtx = offscreen.getContext('2d');
        if (oCtx) {
          oCtx.drawImage(canvas, 0, 0, offscreen.width, offscreen.height);
          const screenshot = offscreen.toDataURL('image/jpeg', 0.6);
          setTimeout(() => performAiAnalysis(screenshot), 0);
        }
      }
    };

    const startControllerLoop = () => {
      let lastFrame = performance.now();
      const tick = (now: number) => {
        const deltaMs = now - lastFrame;
        lastFrame = now;
        renderFrame(undefined, deltaMs);
        rafId = window.requestAnimationFrame(tick);
      };
      rafId = window.requestAnimationFrame(tick);
    };

    if (inputMode === 'gesture' && video && window.Hands && window.Camera) {
      hands = new window.Hands({
        locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });
      hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      hands.onResults((results: any) => renderFrame(results, 16));

      camera = new window.Camera(video, {
        onFrame: async () => {
          if (videoRef.current && hands) {
            await hands.send({ image: videoRef.current });
          }
        },
        width: 1280,
        height: 720,
      });
      camera.start();
    } else {
      startControllerLoop();
    }

    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', releasePointer);
      canvas.removeEventListener('pointercancel', cancelPointer);
      if (camera) camera.stop();
      if (hands) hands.close();
    };
  }, [initGrid, inputMode, setControllerStatus]);

  const recColorConfig = aiRecommendedColor ? COLOR_CONFIG[aiRecommendedColor] : null;
  const borderColor = recColorConfig ? recColorConfig.hex : '#444746';
  const isGestureMode = inputMode === 'gesture';
  const statusHeadline = isAiThinking
    ? 'Processing Vision...'
    : inputMode === 'controller'
      ? 'Manual Controller Mode'
      : 'Waiting for Gesture Input';

  return (
    <div className="flex w-full h-screen bg-[#121212] overflow-hidden font-roboto text-[#e3e3e3]">
      
      {/* MOBILE/TABLET BLOCKER OVERLAY */}
      <div className="fixed inset-0 z-[100] bg-[#121212] flex flex-col items-center justify-center p-8 text-center md:hidden">
         <Monitor className="w-16 h-16 text-[#ef5350] mb-6 animate-pulse" />
         <h2 className="text-2xl font-bold text-[#e3e3e3] mb-4">Desktop View Required</h2>
         <p className="text-[#c4c7c5] max-w-md text-lg leading-relaxed">
           This experience requires a larger screen for the webcam tracking and game mechanics.
         </p>
         <div className="mt-8 flex items-center gap-2 text-sm text-[#757575] uppercase tracking-wider font-bold">
           <div className="w-2 h-2 bg-[#42a5f5] rounded-full"></div>
           Please maximize window
         </div>
      </div>

      {/* LEFT: Game Area */}
      <div ref={gameContainerRef} className="flex-1 relative h-full overflow-hidden">
        <video ref={videoRef} className="absolute hidden" playsInline />
        <canvas
          ref={canvasRef}
          className="absolute inset-0"
          style={inputMode === 'controller' ? { cursor: 'crosshair', touchAction: 'none', transform: 'none' } : undefined}
        />

        {/* Loading Overlay */}
        {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#121212] z-50">
            <div className="flex flex-col items-center">
                <Loader2 className="w-12 h-12 text-[#42a5f5] animate-spin mb-4" />
                <p className="text-[#e3e3e3] text-lg font-medium">Starting Engine...</p>
            </div>
            </div>
        )}

        {/* Analyzing Overlay - positioned at Slingshot Anchor */}
        {isAiThinking && (
          <div 
            className="absolute left-1/2 -translate-x-1/2 z-50 flex flex-col items-center justify-center pointer-events-none"
            style={{ bottom: '220px', transform: 'translate(-50%, 50%)' }}
          >
             <div className="w-[72px] h-[72px] rounded-full border-4 border-t-[#a8c7fa] border-r-[#a8c7fa] border-b-transparent border-l-transparent animate-spin" />
             <p className="mt-4 text-[#a8c7fa] font-bold text-xs tracking-widest animate-pulse">ANALYZING...</p>
          </div>
        )}

        {/* HUD: Score Card */}
        <div className="absolute top-6 left-6 z-40">
            <div className="bg-[#1e1e1e] p-5 rounded-[28px] border border-[#444746] shadow-2xl flex items-center gap-4 min-w-[180px]">
                <div className="bg-[#42a5f5]/20 p-3 rounded-full">
                    <Trophy className="w-6 h-6 text-[#42a5f5]" />
                </div>
                <div>
                    <p className="text-xs text-[#c4c7c5] uppercase tracking-wider font-medium">Score</p>
                    <p className="text-3xl font-bold text-white">{score.toLocaleString()}</p>
                </div>
            </div>
        </div>

        {/* HUD: Input Mode */}
        <div className="absolute top-6 right-6 z-40">
            <div className="bg-[#1e1e1e] p-4 rounded-[24px] border border-[#444746] shadow-2xl w-[320px]">
                <div className="flex items-center gap-2 mb-3">
                    <p className="text-xs text-[#c4c7c5] uppercase tracking-wider font-bold">Input</p>
                    <span className="text-[11px] text-[#a8c7fa] font-mono truncate">{inputStatus}</span>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => setInputMode('controller')}
                        className={`px-3 py-2 rounded-lg text-xs font-bold border transition ${
                            inputMode === 'controller'
                              ? 'bg-[#42a5f5]/20 border-[#42a5f5] text-[#a8c7fa]'
                              : 'bg-[#2a2a2a] border-[#444746] text-[#c4c7c5]'
                        }`}
                    >
                        Controller
                    </button>
                    <button
                        onClick={() => setInputMode('gesture')}
                        className={`px-3 py-2 rounded-lg text-xs font-bold border transition ${
                            inputMode === 'gesture'
                              ? 'bg-[#66bb6a]/20 border-[#66bb6a] text-[#a5d6a7]'
                              : 'bg-[#2a2a2a] border-[#444746] text-[#c4c7c5]'
                        }`}
                    >
                        Gesture
                    </button>
                    <button
                        onClick={toggleFullscreen}
                        title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                        className={`ml-auto px-3 py-2 rounded-lg text-xs font-bold border flex items-center gap-1 transition ${
                            isFullscreen
                              ? 'bg-[#fdd835]/20 border-[#fdd835] text-[#fdd835]'
                              : 'bg-[#2a2a2a] border-[#444746] text-[#c4c7c5]'
                        }`}
                    >
                        {isFullscreen ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
                        {isFullscreen ? 'Exit FS' : 'Fullscreen'}
                    </button>
                    {xrActive ? (
                        <button
                            onClick={stopVrSession}
                            className="px-3 py-2 rounded-lg text-xs font-bold border border-[#ef5350] text-[#ef5350] bg-[#ef5350]/10"
                        >
                            Exit XR
                        </button>
                    ) : (
                        <button
                            onClick={startVrSession}
                            disabled={!xrSupported}
                            className={`px-3 py-2 rounded-lg text-xs font-bold border ${
                                xrSupported
                                  ? 'border-[#a8c7fa] text-[#a8c7fa] bg-[#a8c7fa]/10'
                                  : 'border-[#444746] text-[#757575] bg-[#2a2a2a]'
                            }`}
                        >
                            Enter XR
                        </button>
                    )}
                </div>
            </div>
        </div>

        {/* HUD: Color Picker */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40">
            <div className="bg-[#1e1e1e] px-6 py-4 rounded-[32px] border border-[#444746] shadow-2xl flex items-center gap-4">
                <p className="text-xs text-[#c4c7c5] uppercase font-bold tracking-wider mr-2 hidden md:block">Select Color</p>
                {availableColors.length === 0 ? (
                    <p className="text-sm text-gray-500">No ammo</p>
                ) : (
                    COLOR_KEYS.filter(c => availableColors.includes(c)).map(color => {
                        const isSelected = selectedColor === color;
                        const isRecommended = aiRecommendedColor === color;
                        const config = COLOR_CONFIG[color];
                        
                        return (
                            <button
                                key={color}
                                onClick={() => setSelectedColor(color)}
                                className={`relative w-14 h-14 rounded-full transition-all duration-300 transform flex items-center justify-center
                                    ${isSelected ? 'scale-110 ring-4 ring-white/50 z-10' : 'opacity-80 hover:opacity-100 hover:scale-105'}
                                `}
                                style={{ 
                                    background: `radial-gradient(circle at 35% 35%, ${config.hex}, ${adjustColor(config.hex, -60)})`,
                                    boxShadow: isSelected 
                                        ? `0 0 20px ${config.hex}, inset 0 -4px 4px rgba(0,0,0,0.3)`
                                        : '0 4px 6px rgba(0,0,0,0.3), inset 0 -4px 4px rgba(0,0,0,0.3)'
                                }}
                            >
                                {/* Glossy highlight for button */}
                                <div className="absolute top-2 left-3 w-4 h-2 bg-white/40 rounded-full transform -rotate-45 filter blur-[1px]" />
                                
                                {isRecommended && !isSelected && (
                                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-white text-black text-[10px] font-bold flex items-center justify-center rounded-full animate-bounce shadow-md">!</span>
                                )}
                                {isSelected && (
                                    <MousePointerClick className="w-6 h-6 text-white/90 drop-shadow-md" />
                                )}
                            </button>
                        )
                    })
                )}
            </div>
        </div>

        {/* Bottom Tip */}
        {!isPinching.current && !isFlying.current && !isAiThinking && (
            <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-30 pointer-events-none opacity-50">
                <div className="flex items-center gap-2 bg-[#1e1e1e]/90 px-4 py-2 rounded-full border border-[#444746] backdrop-blur-sm">
                    <Play className="w-3 h-3 text-[#42a5f5] fill-current" />
                        <p className="text-[#e3e3e3] text-xs font-medium">
                          {inputMode === 'controller' ? 'Click and drag the ball, release to shoot' : 'Pinch & Pull to Shoot'}
                        </p>
                </div>
            </div>
        )}
      </div>

      {/* RIGHT: Debug Panel */}
      <div className="w-[380px] bg-[#1e1e1e] border-l border-[#444746] flex flex-col h-full overflow-hidden shadow-2xl">
        
        {/* FLASH STRATEGY SECTION - PROMINENT */}
        <div 
            className="p-5 border-b-4 transition-colors duration-500 flex flex-col gap-2"
            style={{ 
                backgroundColor: '#252525',
                borderColor: borderColor
            }}
        >
             <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <BrainCircuit className="w-5 h-5" style={{ color: borderColor }} />
                    <h2 className="font-bold text-sm tracking-widest uppercase" style={{ color: borderColor }}>
                        Flash Strategy
                    </h2>
                </div>
                {isAiThinking && <Loader2 className="w-4 h-4 animate-spin text-white/50" />}
             </div>
             
             <p className="text-[#e3e3e3] text-sm leading-relaxed font-bold">
                {aiHint}
             </p>
             
             {aiRationale && (
                 <div className="flex gap-2 mt-1">
                     <Lightbulb className="w-4 h-4 text-[#a8c7fa] shrink-0 mt-0.5" />
                     <p className="text-[#a8c7fa] text-xs italic opacity-90 leading-tight">
                        {aiRationale}
                     </p>
                 </div>
             )}

             <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="text-[10px] uppercase tracking-wider text-[#9aa0a6] flex flex-col gap-1">
                    Provider
                    <select
                        value={aiProvider}
                        onChange={(e) => setAiProvider(e.target.value as AiProvider)}
                        disabled={!isGestureMode}
                        className="bg-[#121212] border border-[#444746] rounded px-2 py-1 text-xs text-[#e3e3e3]"
                    >
                        <option value="gemini">Gemini</option>
                        <option value="openai">OpenAI</option>
                        <option value="anthropic">Anthropic</option>
                    </select>
                </label>
                <label className="text-[10px] uppercase tracking-wider text-[#9aa0a6] flex flex-col gap-1">
                    Model (Optional)
                    <input
                        value={aiModelOverride}
                        onChange={(e) => setAiModelOverride(e.target.value)}
                        placeholder="Default: gpt-5-mini"
                        disabled={!isGestureMode}
                        className="bg-[#121212] border border-[#444746] rounded px-2 py-1 text-xs text-[#e3e3e3]"
                    />
                </label>
             </div>
             {!isGestureMode && (
                <p className="text-[10px] text-[#9aa0a6] mt-1">
                  AI provider/model settings are used only in Gesture mode.
                </p>
             )}
             
             {aiRecommendedColor && (
                <div className="flex items-center gap-2 mt-3 bg-black/20 p-2 rounded">
                    <Target className="w-4 h-4 text-gray-400" />
                    <span className="text-xs text-gray-400 uppercase tracking-wide">Rec. Color:</span>
                    <span className="text-xs font-bold uppercase" style={{ color: COLOR_CONFIG[aiRecommendedColor].hex }}>
                        {COLOR_CONFIG[aiRecommendedColor].label}
                    </span>
                </div>
             )}
        </div>

        {/* DEBUG HEADER */}
        <div className="p-3 border-b border-[#444746] bg-[#1e1e1e] flex items-center gap-2 text-[#757575]">
            <Terminal className="w-4 h-4" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Debugger</span>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
            
            {/* Status Section */}
            <div>
                <div className="flex items-center gap-2 mb-2 text-[#c4c7c5] text-xs font-bold uppercase tracking-wider">
                    <BrainCircuit className="w-3 h-3" /> Status
                </div>
                <div className={`p-3 rounded-lg border ${isAiThinking ? 'bg-[#a8c7fa]/10 border-[#a8c7fa]/30 text-[#a8c7fa]' : 'bg-[#444746]/20 border-[#444746]/50 text-[#c4c7c5]'}`}>
                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${isAiThinking ? 'bg-[#a8c7fa] animate-pulse' : 'bg-[#66bb6a]'}`} />
                        <span className="text-sm font-mono">{statusHeadline}</span>
                    </div>
                    <p className="text-[10px] text-[#9aa0a6] mt-2 font-mono">
                        {`Mode=${inputMode} | ${inputStatus}`}
                    </p>
                </div>
            </div>

            {/* Vision Input */}
            {isGestureMode && debugInfo?.screenshotBase64 && (
                <div>
                    <div className="flex items-center gap-2 mb-2 text-[#c4c7c5] text-xs font-bold uppercase tracking-wider">
                        <Eye className="w-3 h-3" /> Vision Input
                    </div>
                    <div className="rounded-lg overflow-hidden border border-[#444746] bg-black/50 relative group">
                         {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={debugInfo.screenshotBase64} alt="AI Vision" className="w-full h-auto opacity-80 group-hover:opacity-100 transition-opacity" />
                        <div className="absolute bottom-0 left-0 right-0 bg-black/70 p-1 text-[10px] text-center text-gray-400 font-mono">
                            {`Sent to ${debugInfo.model || aiModelOverride || 'default model'}`}
                        </div>
                    </div>
                </div>
            )}

            {/* Prompt Context */}
            {debugInfo?.promptContext && (
                <div>
                    <div className="flex items-center gap-2 mb-2 text-[#c4c7c5] text-xs font-bold uppercase tracking-wider">
                        <Terminal className="w-3 h-3" /> Prompt Context
                    </div>
                    <div className="bg-[#121212] p-3 rounded-lg border border-[#444746] font-mono text-[10px] text-gray-400 h-32 overflow-y-auto whitespace-pre-wrap leading-tight">
                        {debugInfo.promptContext}
                    </div>
                </div>
            )}

            {/* AI Output Stats */}
            {debugInfo && (
                <div>
                    <div className="flex items-center gap-2 mb-2 text-[#c4c7c5] text-xs font-bold uppercase tracking-wider">
                        <BrainCircuit className="w-3 h-3" /> AI Output
                    </div>
                    
                    <div className="grid grid-cols-3 gap-2 mb-3">
                         <div className="bg-[#2a2a2a] p-2 rounded border border-[#444746]">
                            <p className="text-[10px] text-gray-500 mb-1">Latency</p>
                            <div className="flex items-center gap-1 text-[#a8c7fa] font-mono font-bold">
                                {debugInfo.latency}ms
                            </div>
                         </div>
                         <div className="bg-[#2a2a2a] p-2 rounded border border-[#444746]">
                            <p className="text-[10px] text-gray-500 mb-1">Rec. Color</p>
                            <div className="flex items-center gap-1 text-[#e3e3e3] font-mono font-bold capitalize">
                                {debugInfo.parsedResponse?.recommendedColor || '--'}
                            </div>
                         </div>
                         <div className="bg-[#2a2a2a] p-2 rounded border border-[#444746]">
                            <p className="text-[10px] text-gray-500 mb-1">Provider</p>
                            <div className="flex items-center gap-1 text-[#e3e3e3] font-mono font-bold capitalize">
                                {debugInfo.provider || aiProvider}
                            </div>
                         </div>
                    </div>

                    {debugInfo.error && (
                         <div className="bg-[#ef5350]/10 border border-[#ef5350]/30 p-3 rounded-lg mb-3">
                            <div className="flex items-start gap-2 text-[#ef5350]">
                                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                                <div>
                                    <p className="text-xs font-bold">PARSE ERROR DETAILS</p>
                                    <p className="text-[10px] font-mono mt-1 break-all">{debugInfo.error}</p>
                                </div>
                            </div>
                         </div>
                    )}

                    <p className="text-[10px] text-gray-500 mb-1">Raw Response Text</p>
                    <div className="bg-[#121212] p-3 rounded-lg border border-[#444746] font-mono text-[11px] text-[#66bb6a] max-h-40 overflow-y-auto whitespace-pre-wrap mb-3 border-l-2 border-l-[#66bb6a]">
                        {debugInfo.rawResponse}
                    </div>

                    <p className="text-[10px] text-gray-500 mb-1">Parsed JSON</p>
                    <div className="bg-[#121212] p-3 rounded-lg border border-[#444746] font-mono text-[10px] text-[#a8c7fa] overflow-x-auto">
                        <pre>{JSON.stringify(debugInfo.parsedResponse || { error: "Failed to parse" }, null, 2)}</pre>
                    </div>
                </div>
            )}
        </div>
        
        <div className="p-3 bg-[#252525] border-t border-[#444746] text-center">
            <p className="text-[10px] text-gray-500 font-medium">Powered by Google Gemini 3 Flash</p>
        </div>
      </div>
    </div>
  );
};

export default GeminiSlingshot;
