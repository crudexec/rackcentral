'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import * as THREE from 'three';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import AnnotationEditor from './AnnotationEditor';

interface Config {
  bays: number;
  levels: number;
  bayWidth: number;
  bayDepth: number;
  levelHeight: number;
  beamColor: string;
  frameColor: string;
  palletColor: string;
  crossbarColor: string;
  wireDeckColor: string;
  showWireDecks: boolean;
  showPallets: boolean;
  palletFill: number;
}

interface Rack {
  id: string;
  name: string;
  position: { x: number; z: number };
  rotation: number;
  config: Config;
}

interface MaintenanceRecord {
  id: number;
  type: string;
  description: string;
  technician: string;
  status: string;
  timestamp: string;
  componentId: string;
  images?: string[];
}

interface NewRecord {
  type: string;
  description: string;
  technician: string;
  status: string;
}

interface PendingImage {
  file: File;
  preview: string;
}

interface ComponentUserData {
  componentId: string;
  type: string;
  bay?: number;
  level?: number;
  side?: string;
  label: string;
  isIndicator?: boolean;
  parentId?: string;
  isDecoration?: boolean;
  rackId?: string;
  rackName?: string;
}

const defaultConfig: Config = {
  bays: 3,
  levels: 4,
  bayWidth: 2.7,
  bayDepth: 1.2,
  levelHeight: 1.5,
  beamColor: '#ff6b00',
  frameColor: '#4a90d9',
  palletColor: '#c4a574',
  crossbarColor: '#ff9500',
  wireDeckColor: '#666666',
  showWireDecks: true,
  showPallets: false,
  palletFill: 70,
};

const createNewRack = (id: string, name: string, x: number = 0, z: number = 0): Rack => ({
  id,
  name,
  position: { x, z },
  rotation: 0,
  config: { ...defaultConfig },
});

export default function RackingMaintenanceVisualizer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const allRacksGroupRef = useRef<THREE.Group | null>(null);
  const animationRef = useRef<number | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseRef = useRef(new THREE.Vector2());
  const componentMapRef = useRef(new Map<string, THREE.Mesh>());
  const selectedMeshRef = useRef<THREE.Mesh | null>(null);
  const locatorGroupRef = useRef<THREE.Group | null>(null);
  const clockRef = useRef(new THREE.Clock());
  const groundPlaneRef = useRef<THREE.Mesh | null>(null);

  // Multiple racks state
  const [racks, setRacks] = useState<Rack[]>([createNewRack('rack-1', 'Rack 1', 0, 0)]);
  const [selectedRackId, setSelectedRackId] = useState<string>('rack-1');
  const [isMovingRack, setIsMovingRack] = useState(false);

  // Get current selected rack's config
  const selectedRack = racks.find(r => r.id === selectedRackId) || racks[0];
  const config = selectedRack?.config || defaultConfig;

  // Update config for selected rack
  const setConfig = useCallback((newConfig: Config | ((prev: Config) => Config)) => {
    setRacks(prevRacks => prevRacks.map(rack => {
      if (rack.id === selectedRackId) {
        const updatedConfig = typeof newConfig === 'function' ? newConfig(rack.config) : newConfig;
        return { ...rack, config: updatedConfig };
      }
      return rack;
    }));
  }, [selectedRackId]);

  const [isDragging, setIsDragging] = useState(false);
  const [previousMousePosition, setPreviousMousePosition] = useState({ x: 0, y: 0 });
  const [cameraAngle, setCameraAngle] = useState({ theta: Math.PI / 4, phi: Math.PI / 4 });
  const [cameraDistance, setCameraDistance] = useState(25);

  const [selectedComponent, setSelectedComponent] = useState<string | null>(null);
  const [maintenanceRecords, setMaintenanceRecords] = useState<Record<string, MaintenanceRecord[]>>({});
  const [componentHealth, setComponentHealth] = useState<Record<string, string>>({});
  const [showAddRecord, setShowAddRecord] = useState(false);
  const [activeTab, setActiveTab] = useState('home');
  const [viewMode, setViewMode] = useState('normal');
  const [newRecord, setNewRecord] = useState<NewRecord>({
    type: 'inspection',
    description: '',
    technician: '',
    status: 'completed',
  });
  const [hoveredComponent, setHoveredComponent] = useState<ComponentUserData | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [selectedImageModal, setSelectedImageModal] = useState<string | null>(null);
  const [annotatingImage, setAnnotatingImage] = useState<string | null>(null);
  const [savingAnnotation, setSavingAnnotation] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showRackInspection, setShowRackInspection] = useState(false);
  const [viewingRackDetails, setViewingRackDetails] = useState<string | null>(null);
  const [newRackInspection, setNewRackInspection] = useState({
    description: '',
    technician: '',
    status: 'completed',
  });
  const [rackInspectionImages, setRackInspectionImages] = useState<PendingImage[]>([]);
  const [uploadingRackInspection, setUploadingRackInspection] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const rackInspectionImageInputRef = useRef<HTMLInputElement>(null);

  // Auth and data loading state
  const router = useRouter();
  const [user, setUser] = useState<{ id: number; email: string } | null>(null);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [savingStatus, setSavingStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const maintenanceTypes = [
    { value: 'inspection', label: '🔍 Inspection', color: '#3b82f6' },
    { value: 'repair', label: '🔧 Repair', color: '#f59e0b' },
    { value: 'replacement', label: '🔄 Replacement', color: '#ef4444' },
    { value: 'cleaning', label: '🧹 Cleaning', color: '#10b981' },
    { value: 'upgrade', label: '⬆️ Upgrade', color: '#8b5cf6' },
    { value: 'damage_report', label: '⚠️ Damage Report', color: '#dc2626' },
  ];

  const statusTypes = [
    { value: 'completed', label: 'Completed', color: '#10b981' },
    { value: 'pending', label: 'Pending', color: '#f59e0b' },
    { value: 'in_progress', label: 'In Progress', color: '#3b82f6' },
    { value: 'scheduled', label: 'Scheduled', color: '#8b5cf6' },
  ];

  const healthStatuses = [
    { value: 'good', label: 'Good', color: '#10b981', priority: 1 },
    { value: 'fair', label: 'Fair', color: '#f59e0b', priority: 2 },
    { value: 'poor', label: 'Poor', color: '#f97316', priority: 3 },
    { value: 'critical', label: 'Critical', color: '#ef4444', priority: 4 },
  ];

  const cameraPresets = [
    { name: 'Front', theta: 0, phi: Math.PI / 6, distance: 15 },
    { name: 'Side', theta: Math.PI / 2, phi: Math.PI / 6, distance: 15 },
    { name: 'Top', theta: 0, phi: Math.PI / 2 - 0.1, distance: 20 },
    { name: 'Iso', theta: Math.PI / 4, phi: Math.PI / 4, distance: 15 },
    { name: 'Back', theta: Math.PI, phi: Math.PI / 6, distance: 15 },
  ];

  // Load user session and data on mount
  useEffect(() => {
    async function loadUserAndData() {
      try {
        // Check session
        const sessionRes = await fetch('/api/auth/session');
        const sessionData = await sessionRes.json();

        if (!sessionData.authenticated) {
          router.push('/login');
          return;
        }

        setUser(sessionData.user);

        // Load all data in parallel
        const [racksRes, maintenanceRes, healthRes] = await Promise.all([
          fetch('/api/data/racks'),
          fetch('/api/data/maintenance'),
          fetch('/api/data/health'),
        ]);

        if (racksRes.ok) {
          const { racks: loadedRacks } = await racksRes.json();
          if (loadedRacks && loadedRacks.length > 0) {
            setRacks(loadedRacks);
            setSelectedRackId(loadedRacks[0].id);
          }
        }

        if (maintenanceRes.ok) {
          const { maintenanceRecords: loadedRecords } = await maintenanceRes.json();
          setMaintenanceRecords(loadedRecords);
        }

        if (healthRes.ok) {
          const { componentHealth: loadedHealth } = await healthRes.json();
          setComponentHealth(loadedHealth);
        }

        setDataLoaded(true);
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoadingData(false);
      }
    }

    loadUserAndData();
  }, [router]);

  // Auto-save racks with debounce
  useEffect(() => {
    if (!dataLoaded) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      setSavingStatus('saving');
      try {
        const response = await fetch('/api/data/racks', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ racks }),
        });
        setSavingStatus(response.ok ? 'saved' : 'error');

        // Reset to idle after 2 seconds
        setTimeout(() => setSavingStatus('idle'), 2000);
      } catch {
        setSavingStatus('error');
      }
    }, 1000);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [racks, dataLoaded]);

  // Save maintenance records when they change
  const saveMaintenanceRecords = useCallback(async (records: Record<string, MaintenanceRecord[]>) => {
    if (!dataLoaded) return;

    try {
      await fetch('/api/data/maintenance', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maintenanceRecords: records }),
      });
    } catch (error) {
      console.error('Failed to save maintenance records:', error);
    }
  }, [dataLoaded]);

  // Save component health when it changes
  const saveComponentHealthData = useCallback(async (health: Record<string, string>) => {
    if (!dataLoaded) return;

    try {
      await fetch('/api/data/health', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ componentHealth: health }),
      });
    } catch (error) {
      console.error('Failed to save component health:', error);
    }
  }, [dataLoaded]);

  // Logout handler
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/login');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  // Analytics calculations
  const analytics = useMemo(() => {
    const allRecords: (MaintenanceRecord & { componentId: string })[] = [];
    Object.entries(maintenanceRecords).forEach(([componentId, records]) => {
      records.forEach(record => allRecords.push({ ...record, componentId }));
    });

    const byType = maintenanceTypes.map(type => ({
      name: type.label.split(' ')[1],
      value: allRecords.filter(r => r.type === type.value).length,
      color: type.color,
    })).filter(t => t.value > 0);

    const byStatus = statusTypes.map(status => ({
      name: status.label,
      value: allRecords.filter(r => r.status === status.value).length,
      color: status.color,
    })).filter(s => s.value > 0);

    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const dayRecords = allRecords.filter(r => {
        const recordDate = new Date(r.timestamp);
        return recordDate.toDateString() === date.toDateString();
      });
      last7Days.push({ date: dateStr, count: dayRecords.length });
    }

    const componentCounts: Record<string, number> = {};
    allRecords.forEach(r => {
      componentCounts[r.componentId] = (componentCounts[r.componentId] || 0) + 1;
    });
    const topComponents = Object.entries(componentCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => {
        const component = componentMapRef.current.get(id);
        const userData = component?.userData as ComponentUserData | undefined;
        return { name: userData?.label || id, count };
      });

    const healthCounts = healthStatuses.map(h => ({
      name: h.label,
      value: Object.values(componentHealth).filter(ch => ch === h.value).length,
      color: h.color,
    })).filter(h => h.value > 0);

    return {
      totalRecords: allRecords.length,
      totalComponents: componentMapRef.current.size,
      componentsWithRecords: Object.keys(maintenanceRecords).length,
      byType,
      byStatus,
      last7Days,
      topComponents,
      healthCounts,
      pendingCount: allRecords.filter(r => r.status === 'pending' || r.status === 'in_progress').length,
    };
  }, [maintenanceRecords, componentHealth]);

  // Initialize Three.js scene
  useEffect(() => {
    if (loadingData || !containerRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      60,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    );
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    scene.add(directionalLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(-10, 10, -10);
    scene.add(fillLight);

    const groundGeometry = new THREE.PlaneGeometry(100, 100);
    const groundMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x2d2d44,
      roughness: 0.8,
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    scene.add(ground);

    const gridHelper = new THREE.GridHelper(100, 100, 0x444466, 0x333355);
    gridHelper.position.y = 0.01;
    scene.add(gridHelper);

    const allRacksGroup = new THREE.Group();
    scene.add(allRacksGroup);
    allRacksGroupRef.current = allRacksGroup;

    const locatorGroup = new THREE.Group();
    scene.add(locatorGroup);
    locatorGroupRef.current = locatorGroup;

    // Store ground plane for raycasting
    groundPlaneRef.current = ground;

    const animate = () => {
      animationRef.current = requestAnimationFrame(animate);
      
      const elapsed = clockRef.current.getElapsedTime();
      
      if (selectedMeshRef.current && selectedMeshRef.current.material) {
        const pulse = (Math.sin(elapsed * 4) + 1) / 2;
        (selectedMeshRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + pulse * 0.5;
      }
      
      if (locatorGroupRef.current && locatorGroupRef.current.children.length > 0) {
        const bounce = Math.sin(elapsed * 3) * 0.2;
        locatorGroupRef.current.children.forEach(child => {
          if ((child.userData as any).isArrow) {
            child.position.y = (child.userData as any).baseY + bounce;
          }
          if ((child.userData as any).isRing) {
            child.rotation.z = elapsed * 2;
            child.scale.setScalar(1 + Math.sin(elapsed * 4) * 0.1);
          }
        });
      }
      
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!containerRef.current) return;
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      renderer.dispose();
      if (containerRef.current && renderer.domElement) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, [loadingData]);

  // Store camera target separately so it only updates on rack selection change
  const [cameraTarget, setCameraTarget] = useState({ x: 0, y: 3, z: 0 });

  // Update camera target only when selecting a different rack
  useEffect(() => {
    if (!selectedRack) {
      setCameraTarget({ x: 0, y: 3, z: 0 });
      return;
    }

    // Calculate rack center based on its position and dimensions
    const rackWidth = selectedRack.config.bays * selectedRack.config.bayWidth;
    const rackHeight = selectedRack.config.levels * selectedRack.config.levelHeight;

    // Account for rack position and rotation
    const localCenterX = rackWidth / 2 - selectedRack.config.bayWidth / 2;
    const cos = Math.cos(selectedRack.rotation);
    const sin = Math.sin(selectedRack.rotation);

    setCameraTarget({
      x: selectedRack.position.x + localCenterX * cos,
      y: rackHeight / 2,
      z: selectedRack.position.z + localCenterX * sin,
    });
  }, [selectedRackId]); // Only update when rack selection changes

  // Update camera position based on angle, distance, and target
  useEffect(() => {
    if (!cameraRef.current) return;

    const x = cameraDistance * Math.sin(cameraAngle.theta) * Math.cos(cameraAngle.phi);
    const y = cameraDistance * Math.sin(cameraAngle.phi);
    const z = cameraDistance * Math.cos(cameraAngle.theta) * Math.cos(cameraAngle.phi);

    cameraRef.current.position.set(x + cameraTarget.x, y + cameraTarget.y, z + cameraTarget.z);
    cameraRef.current.lookAt(cameraTarget.x, cameraTarget.y, cameraTarget.z);
  }, [cameraAngle, cameraDistance, cameraTarget]);

  // Update locator position
  useEffect(() => {
    if (!locatorGroupRef.current) return;
    
    while (locatorGroupRef.current.children.length > 0) {
      const child = locatorGroupRef.current.children[0];
      if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose();
      if ((child as THREE.Mesh).material) ((child as THREE.Mesh).material as THREE.Material).dispose();
      locatorGroupRef.current.remove(child);
    }
    
    selectedMeshRef.current = null;
    
    if (!selectedComponent) return;
    
    const mesh = componentMapRef.current.get(selectedComponent);
    if (!mesh) return;
    
    selectedMeshRef.current = mesh;
    
    const worldPos = new THREE.Vector3();
    mesh.getWorldPosition(worldPos);
    
    const bbox = new THREE.Box3().setFromObject(mesh);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    
    const userData = mesh.userData as ComponentUserData;
    const componentType = userData?.type;
    let ringSize;
    
    if (componentType === 'upright' || componentType === 'brace') {
      ringSize = Math.max(size.x, size.z) * 2.5;
      ringSize = Math.max(ringSize, 0.3);
    } else if (componentType === 'connector' || componentType === 'crossbar') {
      ringSize = Math.max(size.x, size.z) * 1.5;
      ringSize = Math.max(ringSize, 0.4);
    } else {
      ringSize = Math.max(size.x, size.z) * 0.6;
      ringSize = Math.min(ringSize, 2.0);
    }
    
    const ringGeometry = new THREE.RingGeometry(ringSize * 0.8, ringSize * 1.0, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({ 
      color: 0x00ff88, 
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.6,
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    
    if (componentType === 'upright') {
      ring.position.set(worldPos.x, bbox.min.y + 0.05, worldPos.z);
    } else {
      ring.position.copy(worldPos);
    }
    ring.rotation.x = -Math.PI / 2;
    ring.userData = { isRing: true };
    locatorGroupRef.current.add(ring);
    
    const arrowHeight = 0.5;
    const arrowRadius = 0.12;
    const coneGeometry = new THREE.ConeGeometry(arrowRadius, arrowHeight, 16);
    const coneMaterial = new THREE.MeshBasicMaterial({ 
      color: 0x00ff88,
      transparent: true,
      opacity: 0.9,
    });
    const cone = new THREE.Mesh(coneGeometry, coneMaterial);
    const arrowY = bbox.max.y + arrowHeight + 0.3;
    cone.position.set(worldPos.x, arrowY, worldPos.z);
    cone.rotation.x = Math.PI;
    cone.userData = { isArrow: true, baseY: arrowY };
    locatorGroupRef.current.add(cone);
    
    const beamGeometry = new THREE.CylinderGeometry(0.015, 0.015, arrowHeight * 1.5, 8);
    const beamMaterial = new THREE.MeshBasicMaterial({ 
      color: 0x00ff88,
      transparent: true,
      opacity: 0.4,
    });
    const beam = new THREE.Mesh(beamGeometry, beamMaterial);
    beam.position.set(worldPos.x, arrowY + arrowHeight * 0.75, worldPos.z);
    locatorGroupRef.current.add(beam);
    
    const glowRingGeometry = new THREE.RingGeometry(ringSize * 1.1, ringSize * 1.3, 32);
    const glowRingMaterial = new THREE.MeshBasicMaterial({ 
      color: 0x00ff88, 
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.2,
    });
    const glowRing = new THREE.Mesh(glowRingGeometry, glowRingMaterial);
    if (componentType === 'upright') {
      glowRing.position.set(worldPos.x, bbox.min.y + 0.05, worldPos.z);
    } else {
      glowRing.position.copy(worldPos);
    }
    glowRing.rotation.x = -Math.PI / 2;
    glowRing.userData = { isRing: true };
    locatorGroupRef.current.add(glowRing);
    
  }, [selectedComponent, config]);

  // Get days since last inspection for heatmap
  const getDaysSinceInspection = useCallback((componentId: string) => {
    const records = maintenanceRecords[componentId];
    if (!records || records.length === 0) return 999;
    
    const inspections = records.filter(r => r.type === 'inspection' && r.status === 'completed');
    if (inspections.length === 0) return 999;
    
    const lastInspection = inspections.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
    const daysSince = Math.floor((Date.now() - new Date(lastInspection.timestamp).getTime()) / (1000 * 60 * 60 * 24));
    return daysSince;
  }, [maintenanceRecords]);

  // Build rack geometry for all racks
  useEffect(() => {
    if (!allRacksGroupRef.current) return;

    // Clear all children from the parent group
    while (allRacksGroupRef.current.children.length > 0) {
      const rackGroup = allRacksGroupRef.current.children[0];
      // Dispose of all geometries and materials in this rack group
      rackGroup.traverse((child) => {
        if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose();
        if ((child as THREE.Mesh).material) {
          const mat = (child as THREE.Mesh).material;
          if (Array.isArray(mat)) mat.forEach(m => m.dispose());
          else (mat as THREE.Material).dispose();
        }
      });
      allRacksGroupRef.current.remove(rackGroup);
    }
    componentMapRef.current.clear();

    const getHealthColor = (componentId: string): string => {
      const health = componentHealth[componentId];
      const healthInfo = healthStatuses.find(h => h.value === health);
      return healthInfo?.color || '#888888';
    };

    const getHeatmapColor = (componentId: string): string => {
      const days = getDaysSinceInspection(componentId);
      if (days <= 7) return '#10b981';
      if (days <= 30) return '#f59e0b';
      if (days <= 90) return '#f97316';
      return '#ef4444';
    };

    const createMaterial = (baseColor: string, componentId: string, isSelected: boolean, hasRecords: boolean) => {
      let color: string | number = baseColor;
      let emissive: string | number = 0x000000;
      let emissiveIntensity = 0;

      if (viewMode === 'health' && componentHealth[componentId]) {
        color = getHealthColor(componentId);
        emissive = color;
        emissiveIntensity = 0.3;
      } else if (viewMode === 'heatmap') {
        color = getHeatmapColor(componentId);
        emissive = color;
        emissiveIntensity = 0.3;
      } else {
        if (isSelected) {
          emissive = 0x00ff88;
          emissiveIntensity = 0.5;
        } else if (hasRecords) {
          emissive = 0xff6600;
          emissiveIntensity = 0.2;
        }
      }

      return new THREE.MeshStandardMaterial({
        color: color,
        metalness: 0.6,
        roughness: 0.4,
        emissive: emissive,
        emissiveIntensity: emissiveIntensity,
      });
    };

    // Loop through all racks and render each one
    for (const rack of racks) {
      const rackGroup = new THREE.Group();
      rackGroup.position.set(rack.position.x, 0, rack.position.z);
      rackGroup.rotation.y = rack.rotation;
      rackGroup.userData = { rackId: rack.id, rackName: rack.name };

      const { bays, levels, bayWidth, bayDepth, levelHeight, beamColor, frameColor, palletColor, crossbarColor, wireDeckColor, showWireDecks, showPallets, palletFill } = rack.config;
      const isSelectedRack = rack.id === selectedRackId;

      const uprightWidth = 0.08;
      const uprightDepth = 0.08;
      const totalHeight = levels * levelHeight + 0.3;

      for (let bay = 0; bay <= bays; bay++) {
        const xPos = bay * bayWidth;

        (['front', 'back'] as const).forEach((side) => {
          const componentId = `${rack.id}-upright-${bay}-${side}`;
          const hasRecords = (maintenanceRecords[componentId]?.length || 0) > 0;
          const isSelected = selectedComponent === componentId;

          const upright = new THREE.Mesh(
            new THREE.BoxGeometry(uprightWidth, totalHeight, uprightDepth),
            createMaterial(frameColor, componentId, isSelected, hasRecords)
          );
          upright.position.set(xPos, totalHeight / 2, side === 'front' ? bayDepth / 2 : -bayDepth / 2);
          upright.castShadow = true;
          upright.userData = {
            componentId,
            type: 'upright',
            bay,
            side,
            rackId: rack.id,
            rackName: rack.name,
            label: `${rack.name} - Upright ${bay + 1} (${side})`
          };
          rackGroup.add(upright);
          componentMapRef.current.set(componentId, upright);

          if (hasRecords && !isSelected && viewMode === 'normal') {
            const indicatorGeom = new THREE.SphereGeometry(0.1, 16, 16);
            const indicatorMat = new THREE.MeshBasicMaterial({ color: 0xff6600 });
            const indicator = new THREE.Mesh(indicatorGeom, indicatorMat);
            indicator.position.set(xPos, totalHeight + 0.2, side === 'front' ? bayDepth / 2 : -bayDepth / 2);
            indicator.userData = { isIndicator: true, parentId: componentId };
            rackGroup.add(indicator);
          }
        });

        for (let level = 0; level < levels; level++) {
          const componentId = `${rack.id}-brace-${bay}-${level}`;
          const hasRecords = (maintenanceRecords[componentId]?.length || 0) > 0;
          const isSelected = selectedComponent === componentId;

          const braceGeometry = new THREE.CylinderGeometry(0.015, 0.015, Math.sqrt(levelHeight * levelHeight + bayDepth * bayDepth), 8);
          const brace = new THREE.Mesh(braceGeometry, createMaterial(frameColor, componentId, isSelected, hasRecords));
          const angle = Math.atan2(levelHeight, bayDepth);
          brace.rotation.x = Math.PI / 2 - angle;
          brace.position.set(xPos, level * levelHeight + levelHeight / 2 + 0.15, 0);
          brace.userData = {
            componentId,
            type: 'brace',
            bay,
            level,
            rackId: rack.id,
            rackName: rack.name,
            label: `${rack.name} - Cross Brace ${bay + 1}-${level + 1}`
          };
          rackGroup.add(brace);
          componentMapRef.current.set(componentId, brace);
        }

        for (let level = 0; level <= levels; level++) {
          const componentId = `${rack.id}-connector-${bay}-${level}`;
          const hasRecords = (maintenanceRecords[componentId]?.length || 0) > 0;
          const isSelected = selectedComponent === componentId;

          const yPos = level * levelHeight + 0.15;
          const connector = new THREE.Mesh(
            new THREE.BoxGeometry(uprightWidth, 0.04, bayDepth - uprightDepth),
            createMaterial(frameColor, componentId, isSelected, hasRecords)
          );
          connector.position.set(xPos, yPos, 0);
          connector.userData = {
            componentId,
            type: 'connector',
            bay,
            level,
            rackId: rack.id,
            rackName: rack.name,
            label: `${rack.name} - Frame Connector ${bay + 1}-${level}`
          };
          rackGroup.add(connector);
          componentMapRef.current.set(componentId, connector);
        }
      }

      const beamHeight = 0.1;
      const beamDepthSize = 0.05;

      for (let bay = 0; bay < bays; bay++) {
        for (let level = 1; level <= levels; level++) {
          const xPos = bay * bayWidth + bayWidth / 2;
          const yPos = level * levelHeight + 0.1;

          (['front', 'back'] as const).forEach((side) => {
            const componentId = `${rack.id}-beam-${bay}-${level}-${side}`;
            const hasRecords = (maintenanceRecords[componentId]?.length || 0) > 0;
            const isSelected = selectedComponent === componentId;

            const beam = new THREE.Mesh(
              new THREE.BoxGeometry(bayWidth - uprightWidth, beamHeight, beamDepthSize),
              createMaterial(beamColor, componentId, isSelected, hasRecords)
            );
            beam.position.set(xPos, yPos, side === 'front' ? bayDepth / 2 - beamDepthSize / 2 : -bayDepth / 2 + beamDepthSize / 2);
            beam.castShadow = true;
            beam.userData = {
              componentId,
              type: 'beam',
              bay,
              level,
              side,
              rackId: rack.id,
              rackName: rack.name,
              label: `${rack.name} - Beam ${bay + 1}-${level} (${side})`
            };
            rackGroup.add(beam);
            componentMapRef.current.set(componentId, beam);

            if (hasRecords && !isSelected && viewMode === 'normal') {
              const indicatorGeom = new THREE.SphereGeometry(0.08, 16, 16);
              const indicatorMat = new THREE.MeshBasicMaterial({ color: 0xff6600 });
              const indicator = new THREE.Mesh(indicatorGeom, indicatorMat);
              indicator.position.set(xPos, yPos + 0.2, side === 'front' ? bayDepth / 2 : -bayDepth / 2);
              indicator.userData = { isIndicator: true, parentId: componentId };
              rackGroup.add(indicator);
            }
          });

          // Cross bars
          const crossbarWidth = 0.04;
          const crossbarHeight = 0.06;
          const crossbarLength = bayDepth - beamDepthSize * 2;
          const numCrossbars = 3;

          for (let i = 0; i < numCrossbars; i++) {
            const crossbarComponentId = `${rack.id}-crossbar-${bay}-${level}-${i}`;
            const crossbarHasRecords = (maintenanceRecords[crossbarComponentId]?.length || 0) > 0;
            const crossbarIsSelected = selectedComponent === crossbarComponentId;

            const spacing = (bayWidth - uprightWidth * 2) / (numCrossbars + 1);
            const crossbarXPos = bay * bayWidth + uprightWidth + spacing * (i + 1);

            const crossbar = new THREE.Mesh(
              new THREE.BoxGeometry(crossbarWidth, crossbarHeight, crossbarLength),
              createMaterial(crossbarColor, crossbarComponentId, crossbarIsSelected, crossbarHasRecords)
            );
            crossbar.position.set(crossbarXPos, yPos + beamHeight / 2, 0);
            crossbar.castShadow = true;
            crossbar.userData = {
              componentId: crossbarComponentId,
              type: 'crossbar',
              bay,
              level,
              index: i,
              rackId: rack.id,
              rackName: rack.name,
              label: `${rack.name} - Cross Bar ${bay + 1}-${level}-${i + 1}`
            };
            rackGroup.add(crossbar);
            componentMapRef.current.set(crossbarComponentId, crossbar);

            if (crossbarHasRecords && !crossbarIsSelected && viewMode === 'normal') {
              const indicatorGeom = new THREE.SphereGeometry(0.06, 16, 16);
              const indicatorMat = new THREE.MeshBasicMaterial({ color: 0xff6600 });
              const indicator = new THREE.Mesh(indicatorGeom, indicatorMat);
              indicator.position.set(crossbarXPos, yPos + beamHeight / 2 + 0.15, 0);
              indicator.userData = { isIndicator: true, parentId: crossbarComponentId };
              rackGroup.add(indicator);
            }
          }

          if (showWireDecks) {
            const deckComponentId = `${rack.id}-deck-${bay}-${level}`;
            const deckHasRecords = (maintenanceRecords[deckComponentId]?.length || 0) > 0;
            const deckIsSelected = selectedComponent === deckComponentId;

            let deckColor: string | number = wireDeckColor;
            if (viewMode === 'health' && componentHealth[deckComponentId]) {
              deckColor = getHealthColor(deckComponentId);
            } else if (viewMode === 'heatmap') {
              deckColor = getHeatmapColor(deckComponentId);
            } else if (deckIsSelected) {
              deckColor = 0x00ff88;
            } else if (deckHasRecords) {
              deckColor = 0xff9900;
            }

            const deckYPos = yPos + beamHeight / 2 + 0.01;
            const deckWidth = bayWidth - uprightWidth * 2;
            const deckDepth = bayDepth - beamDepthSize * 2;

            const wireMaterial = new THREE.MeshStandardMaterial({
              color: deckColor,
              metalness: 0.7,
              roughness: 0.3,
              emissive: deckIsSelected ? 0x00ff88 : (viewMode !== 'normal' ? deckColor : 0x000000),
              emissiveIntensity: deckIsSelected ? 0.4 : (viewMode !== 'normal' ? 0.2 : 0),
            });

            const wireRadius = 0.008;
            const numLongWires = 8;
            const numCrossWires = 4;

            for (let w = 0; w < numLongWires; w++) {
              const wireXOffset = -deckWidth / 2 + (deckWidth / (numLongWires - 1)) * w;
              const wireGeom = new THREE.CylinderGeometry(wireRadius, wireRadius, deckDepth, 6);
              const wire = new THREE.Mesh(wireGeom, wireMaterial.clone());
              wire.rotation.x = Math.PI / 2;
              wire.position.set(xPos + wireXOffset, deckYPos, 0);
              wire.castShadow = true;

              if (w === 0) {
                wire.userData = {
                  componentId: deckComponentId,
                  type: 'deck',
                  bay,
                  level,
                  rackId: rack.id,
                  rackName: rack.name,
                  label: `${rack.name} - Wire Deck ${bay + 1}-${level}`
                };
                componentMapRef.current.set(deckComponentId, wire);
              } else {
                wire.userData = {
                  componentId: deckComponentId,
                  type: 'deck',
                  bay,
                  level,
                  rackId: rack.id,
                  isDecoration: false
                };
              }
              rackGroup.add(wire);
            }

            for (let c = 0; c < numCrossWires; c++) {
              const wireZOffset = -deckDepth / 2 + (deckDepth / (numCrossWires + 1)) * (c + 1);
              const crossWireGeom = new THREE.CylinderGeometry(wireRadius * 0.7, wireRadius * 0.7, deckWidth, 6);
              const crossWire = new THREE.Mesh(crossWireGeom, wireMaterial.clone());
              crossWire.rotation.z = Math.PI / 2;
              crossWire.position.set(xPos, deckYPos, wireZOffset);
              crossWire.castShadow = true;
              crossWire.userData = {
                componentId: deckComponentId,
                type: 'deck',
                rackId: rack.id,
                isDecoration: false
              };
              rackGroup.add(crossWire);
            }

            const frameThickness = 0.015;
            const frameHeight = 0.02;

            const frontBackFrameGeom = new THREE.BoxGeometry(deckWidth, frameHeight, frameThickness);
            const frontFrame = new THREE.Mesh(frontBackFrameGeom, wireMaterial.clone());
            frontFrame.position.set(xPos, deckYPos, deckDepth / 2);
            frontFrame.userData = { componentId: deckComponentId, type: 'deck', rackId: rack.id, isDecoration: false };
            rackGroup.add(frontFrame);

            const backFrame = new THREE.Mesh(frontBackFrameGeom, wireMaterial.clone());
            backFrame.position.set(xPos, deckYPos, -deckDepth / 2);
            backFrame.userData = { componentId: deckComponentId, type: 'deck', rackId: rack.id, isDecoration: false };
            rackGroup.add(backFrame);

            const leftRightFrameGeom = new THREE.BoxGeometry(frameThickness, frameHeight, deckDepth);
            const leftFrame = new THREE.Mesh(leftRightFrameGeom, wireMaterial.clone());
            leftFrame.position.set(xPos - deckWidth / 2, deckYPos, 0);
            leftFrame.userData = { componentId: deckComponentId, type: 'deck', rackId: rack.id, isDecoration: false };
            rackGroup.add(leftFrame);

            const rightFrame = new THREE.Mesh(leftRightFrameGeom, wireMaterial.clone());
            rightFrame.position.set(xPos + deckWidth / 2, deckYPos, 0);
            rightFrame.userData = { componentId: deckComponentId, type: 'deck', rackId: rack.id, isDecoration: false };
            rackGroup.add(rightFrame);
          }

          if (showPallets && Math.random() * 100 < palletFill) {
            const palletComponentId = `${rack.id}-pallet-${bay}-${level}`;
            const palletHasRecords = (maintenanceRecords[palletComponentId]?.length || 0) > 0;
            const palletIsSelected = selectedComponent === palletComponentId;

            const palletWidth = bayWidth * 0.85;
            const palletHeightSize = 0.15;
            const palletDepthSize = bayDepth * 0.8;

            const palletMat = createMaterial(palletColor, palletComponentId, palletIsSelected, palletHasRecords);
            palletMat.roughness = 0.8;
            palletMat.metalness = 0.1;

            const pallet = new THREE.Mesh(
              new THREE.BoxGeometry(palletWidth, palletHeightSize, palletDepthSize),
              palletMat
            );
            pallet.position.set(xPos, yPos + beamHeight / 2 + palletHeightSize / 2 + 0.02, 0);
            pallet.castShadow = true;
            pallet.userData = {
              componentId: palletComponentId,
              type: 'pallet',
              bay,
              level,
              rackId: rack.id,
              rackName: rack.name,
              label: `${rack.name} - Pallet Position ${bay + 1}-${level}`
            };
            rackGroup.add(pallet);
            componentMapRef.current.set(palletComponentId, pallet);

            const boxHeight = 0.3 + Math.random() * 0.5;
            const boxMaterial = new THREE.MeshStandardMaterial({
              color: new THREE.Color().setHSL(Math.random(), 0.3, 0.5),
              roughness: 0.9,
            });
            const box = new THREE.Mesh(
              new THREE.BoxGeometry(palletWidth * 0.9, boxHeight, palletDepthSize * 0.9),
              boxMaterial
            );
            box.position.set(xPos, yPos + beamHeight / 2 + palletHeightSize + boxHeight / 2 + 0.02, 0);
            box.castShadow = true;
            box.userData = { isDecoration: true };
            rackGroup.add(box);
          }
        }
      }

      // Add rack to the scene
      allRacksGroupRef.current!.add(rackGroup);
    }

  }, [racks, selectedRackId, selectedComponent, maintenanceRecords, componentHealth, viewMode, getDaysSinceInspection, loadingData]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current || !cameraRef.current || !allRacksGroupRef.current) return;
    if (isDragging) return;

    const rect = containerRef.current.getBoundingClientRect();
    mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
    const intersects = raycasterRef.current.intersectObjects(allRacksGroupRef.current.children, true);

    for (const intersect of intersects) {
      const userData = intersect.object.userData as ComponentUserData;
      // Check if it's a rack marker - select that rack
      if ((userData as any).isRackMarker && (userData as any).rackId) {
        setSelectedRackId((userData as any).rackId);
        setActiveTab('home');
        return;
      }
      if (userData.componentId && !userData.isDecoration) {
        setSelectedComponent(userData.componentId);
        // Also select the rack that this component belongs to
        if ((userData as any).rackId) {
          setSelectedRackId((userData as any).rackId);
        }
        setActiveTab('component');
        return;
      }
      if (userData.isIndicator && userData.parentId) {
        setSelectedComponent(userData.parentId);
        setActiveTab('component');
        return;
      }
    }
  }, [isDragging]);

  const handleMouseMoveHover = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current || !cameraRef.current || !allRacksGroupRef.current || isDragging) return;

    const rect = containerRef.current.getBoundingClientRect();
    mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
    const intersects = raycasterRef.current.intersectObjects(allRacksGroupRef.current.children, true);

    let found: ComponentUserData | null = null;
    for (const intersect of intersects) {
      const userData = intersect.object.userData as ComponentUserData;
      if (userData.componentId && !userData.isDecoration) {
        found = userData;
        break;
      }
    }
    setHoveredComponent(found);
  }, [isDragging]);

  const focusOnSelected = useCallback(() => {
    if (!selectedComponent || !componentMapRef.current.has(selectedComponent)) return;
    setCameraDistance(8);
  }, [selectedComponent]);

  // Focus camera on the currently selected rack
  const focusOnRack = useCallback(() => {
    if (!selectedRack) return;

    const rackWidth = selectedRack.config.bays * selectedRack.config.bayWidth;
    const rackHeight = selectedRack.config.levels * selectedRack.config.levelHeight;
    const localCenterX = rackWidth / 2 - selectedRack.config.bayWidth / 2;
    const cos = Math.cos(selectedRack.rotation);
    const sin = Math.sin(selectedRack.rotation);

    setCameraTarget({
      x: selectedRack.position.x + localCenterX * cos,
      y: rackHeight / 2,
      z: selectedRack.position.z + localCenterX * sin,
    });
  }, [selectedRack]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setPreviousMousePosition({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    handleMouseMoveHover(e);
    if (!isDragging) return;
    
    const deltaX = e.clientX - previousMousePosition.x;
    const deltaY = e.clientY - previousMousePosition.y;
    
    setCameraAngle(prev => ({
      theta: prev.theta - deltaX * 0.01,
      phi: Math.max(0.1, Math.min(Math.PI / 2 - 0.1, prev.phi + deltaY * 0.01)),
    }));
    
    setPreviousMousePosition({ x: e.clientX, y: e.clientY });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setCameraDistance(prev => Math.max(5, Math.min(50, prev + e.deltaY * 0.01)));
  };

  const updateConfig = (key: keyof Config, value: number | string | boolean) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newPendingImages: PendingImage[] = [];
    for (const file of Array.from(files)) {
      // Validate file type
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        continue;
      }
      // Create preview URL
      const preview = URL.createObjectURL(file);
      newPendingImages.push({ file, preview });
    }

    setPendingImages(prev => [...prev, ...newPendingImages]);
    e.target.value = ''; // Reset input
  };

  const removeImage = (index: number) => {
    setPendingImages(prev => {
      const updated = [...prev];
      URL.revokeObjectURL(updated[index].preview);
      updated.splice(index, 1);
      return updated;
    });
  };

  const handleSaveAnnotation = async (annotatedBlob: Blob) => {
    if (!annotatingImage) return;

    setSavingAnnotation(true);

    try {
      // Create form data with the annotated image
      const formData = new FormData();
      const fileName = `annotated-${Date.now()}.jpg`;
      formData.append('images', annotatedBlob, fileName);

      // Upload the annotated image
      const uploadRes = await fetch('/api/uploads', {
        method: 'POST',
        body: formData,
      });

      if (uploadRes.ok) {
        const { paths } = await uploadRes.json();
        const newImagePath = paths[0];

        // Find the original image path from the URL
        const originalPath = annotatingImage.replace('/api/uploads/', '');

        // Update maintenance records to add the annotated image
        const updatedRecords = { ...maintenanceRecords };

        // Search through all records to find the one with this image
        for (const [componentId, records] of Object.entries(updatedRecords)) {
          for (const record of records) {
            if (record.images?.includes(originalPath)) {
              // Add annotated image next to original
              const imageIndex = record.images.indexOf(originalPath);
              record.images.splice(imageIndex + 1, 0, newImagePath);
              break;
            }
          }
        }

        setMaintenanceRecords(updatedRecords);
        saveMaintenanceRecords(updatedRecords);
      }

      setAnnotatingImage(null);
      setSelectedImageModal(null);
    } catch (error) {
      console.error('Failed to save annotation:', error);
    } finally {
      setSavingAnnotation(false);
    }
  };

  const addMaintenanceRecord = async () => {
    if (!selectedComponent || !newRecord.description) return;

    setUploadingImages(true);
    let uploadedImagePaths: string[] = [];

    try {
      // Upload images if any
      if (pendingImages.length > 0) {
        const formData = new FormData();
        pendingImages.forEach(img => {
          formData.append('images', img.file);
        });

        const uploadRes = await fetch('/api/uploads', {
          method: 'POST',
          body: formData,
        });

        if (uploadRes.ok) {
          const { paths } = await uploadRes.json();
          uploadedImagePaths = paths;
        }
      }

      const record: MaintenanceRecord = {
        id: Date.now(),
        ...newRecord,
        timestamp: new Date().toISOString(),
        componentId: selectedComponent,
        images: uploadedImagePaths,
      };

      const updatedRecords = {
        ...maintenanceRecords,
        [selectedComponent]: [...(maintenanceRecords[selectedComponent] || []), record],
      };

      setMaintenanceRecords(updatedRecords);
      saveMaintenanceRecords(updatedRecords);

      // Clean up previews
      pendingImages.forEach(img => URL.revokeObjectURL(img.preview));
      setPendingImages([]);

      setNewRecord({
        type: 'inspection',
        description: '',
        technician: '',
        status: 'completed',
      });
      setShowAddRecord(false);
    } catch (error) {
      console.error('Failed to add record:', error);
    } finally {
      setUploadingImages(false);
    }
  };

  const deleteRecord = (componentId: string, recordId: number) => {
    const updatedRecords = {
      ...maintenanceRecords,
      [componentId]: maintenanceRecords[componentId].filter(r => r.id !== recordId),
    };
    setMaintenanceRecords(updatedRecords);
    saveMaintenanceRecords(updatedRecords);
  };

  // Rack-level inspection functions
  const handleRackInspectionImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newImages: PendingImage[] = [];
    Array.from(files).forEach(file => {
      if (file.type.startsWith('image/')) {
        newImages.push({
          file,
          preview: URL.createObjectURL(file),
        });
      }
    });
    setRackInspectionImages(prev => [...prev, ...newImages]);
    e.target.value = '';
  };

  const removeRackInspectionImage = (index: number) => {
    setRackInspectionImages(prev => {
      const newImages = [...prev];
      URL.revokeObjectURL(newImages[index].preview);
      newImages.splice(index, 1);
      return newImages;
    });
  };

  const addRackInspection = async () => {
    if (!selectedRackId || !newRackInspection.description) return;

    setUploadingRackInspection(true);
    let uploadedImagePaths: string[] = [];

    try {
      // Upload images if any
      if (rackInspectionImages.length > 0) {
        const formData = new FormData();
        rackInspectionImages.forEach(img => {
          formData.append('images', img.file);
        });

        const uploadRes = await fetch('/api/uploads', {
          method: 'POST',
          body: formData,
        });

        if (uploadRes.ok) {
          const { paths } = await uploadRes.json();
          uploadedImagePaths = paths;
        }
      }

      // Use special component ID for rack-level inspections
      const rackInspectionId = `${selectedRackId}-rack`;

      const record: MaintenanceRecord = {
        id: Date.now(),
        type: 'inspection',
        description: newRackInspection.description,
        technician: newRackInspection.technician,
        status: newRackInspection.status,
        timestamp: new Date().toISOString(),
        componentId: rackInspectionId,
        images: uploadedImagePaths,
      };

      const updatedRecords = {
        ...maintenanceRecords,
        [rackInspectionId]: [...(maintenanceRecords[rackInspectionId] || []), record],
      };

      setMaintenanceRecords(updatedRecords);
      saveMaintenanceRecords(updatedRecords);

      // Clean up previews
      rackInspectionImages.forEach(img => URL.revokeObjectURL(img.preview));
      setRackInspectionImages([]);

      setNewRackInspection({
        description: '',
        technician: '',
        status: 'completed',
      });
      setShowRackInspection(false);
    } catch (error) {
      console.error('Failed to add rack inspection:', error);
    } finally {
      setUploadingRackInspection(false);
    }
  };

  const updateComponentHealth = (componentId: string, health: string) => {
    const updatedHealth = {
      ...componentHealth,
      [componentId]: health,
    };
    setComponentHealth(updatedHealth);
    saveComponentHealthData(updatedHealth);
  };

  const getAllRecordsSorted = () => {
    const allRecords: (MaintenanceRecord & { componentLabel: string })[] = [];
    Object.entries(maintenanceRecords).forEach(([componentId, records]) => {
      records.forEach(record => {
        const component = componentMapRef.current.get(componentId);
        const userData = component?.userData as ComponentUserData | undefined;
        allRecords.push({
          ...record,
          componentLabel: userData?.label || componentId,
        });
      });
    });
    return allRecords.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  };

  const getComponentRecords = () => {
    if (!selectedComponent) return [];
    return (maintenanceRecords[selectedComponent] || []).sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  };

  // Get all records for a specific rack
  const getRackRecords = (rackId: string) => {
    const rackRecords: (MaintenanceRecord & { componentLabel: string; isRackLevel?: boolean })[] = [];
    Object.entries(maintenanceRecords).forEach(([componentId, records]) => {
      // Check if component belongs to this rack
      if (componentId.startsWith(`${rackId}-`)) {
        records.forEach(record => {
          // Check if this is a rack-level inspection
          const isRackLevel = componentId === `${rackId}-rack`;
          const component = componentMapRef.current.get(componentId);
          const userData = component?.userData as ComponentUserData | undefined;
          rackRecords.push({
            ...record,
            componentLabel: isRackLevel ? '🏭 Rack Inspection' : (userData?.label || componentId.replace(`${rackId}-`, '')),
            isRackLevel,
          });
        });
      }
    });
    return rackRecords.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  };

  // Get health summary for a rack
  const getRackHealthSummary = (rackId: string) => {
    let good = 0, warning = 0, critical = 0, total = 0;
    Object.entries(componentHealth).forEach(([componentId, health]) => {
      if (componentId.startsWith(`${rackId}-`)) {
        total++;
        if (health === 'good') good++;
        else if (health === 'warning' || health === 'fair') warning++;
        else if (health === 'critical' || health === 'poor') critical++;
      }
    });
    return { good, warning, critical, total };
  };

  const getSelectedComponentInfo = (): ComponentUserData | null => {
    if (!selectedComponent) return null;
    const component = componentMapRef.current.get(selectedComponent);
    return component?.userData as ComponentUserData | null;
  };

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const exportData = () => {
    const data = {
      version: '2.0',
      exportDate: new Date().toISOString(),
      racks,
      maintenanceRecords,
      componentHealth,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rack-maintenance-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowExportModal(false);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        // Support both old format (config) and new format (racks)
        if (data.racks && Array.isArray(data.racks)) {
          setRacks(data.racks);
          setSelectedRackId(data.racks[0]?.id || 'rack-1');
        } else if (data.config) {
          // Legacy format - convert single config to rack
          const newRack = createNewRack('rack-1', 'Rack 1', 0, 0);
          newRack.config = data.config;
          setRacks([newRack]);
          setSelectedRackId('rack-1');
        }
        if (data.maintenanceRecords) setMaintenanceRecords(data.maintenanceRecords);
        if (data.componentHealth) setComponentHealth(data.componentHealth);
        setImportError(null);
        setShowExportModal(false);
      } catch {
        setImportError('Invalid file format. Please select a valid JSON export file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const applyCameraPreset = (preset: typeof cameraPresets[0]) => {
    setCameraAngle({ theta: preset.theta, phi: preset.phi });
    setCameraDistance(preset.distance);
  };

  // Rack management functions
  const addNewRack = () => {
    const newId = `rack-${Date.now()}`;
    const newRackNum = racks.length + 1;
    // Position new rack to the right of existing racks
    const maxX = racks.reduce((max, rack) => {
      const rackWidth = rack.config.bays * rack.config.bayWidth;
      return Math.max(max, rack.position.x + rackWidth);
    }, 0);
    const newRack = createNewRack(newId, `Rack ${newRackNum}`, maxX + 3, 0);
    setRacks([...racks, newRack]);
    setSelectedRackId(newId);
  };

  const deleteRack = (rackId: string) => {
    if (racks.length <= 1) return; // Don't delete the last rack
    const newRacks = racks.filter(r => r.id !== rackId);
    setRacks(newRacks);
    if (selectedRackId === rackId) {
      setSelectedRackId(newRacks[0].id);
    }
  };

  const updateRackPosition = (rackId: string, x: number, z: number) => {
    setRacks(prevRacks => prevRacks.map(rack => {
      if (rack.id === rackId) {
        return { ...rack, position: { x, z } };
      }
      return rack;
    }));
  };

  const updateRackRotation = (rackId: string, rotation: number) => {
    setRacks(prevRacks => prevRacks.map(rack => {
      if (rack.id === rackId) {
        return { ...rack, rotation };
      }
      return rack;
    }));
  };

  const updateRackName = (rackId: string, name: string) => {
    setRacks(prevRacks => prevRacks.map(rack => {
      if (rack.id === rackId) {
        return { ...rack, name };
      }
      return rack;
    }));
  };

  const duplicateRack = (rackId: string) => {
    const sourcRack = racks.find(r => r.id === rackId);
    if (!sourcRack) return;

    const newId = `rack-${Date.now()}`;
    const newRack: Rack = {
      ...sourcRack,
      id: newId,
      name: `${sourcRack.name} (Copy)`,
      position: { x: sourcRack.position.x + 5, z: sourcRack.position.z },
    };
    setRacks([...racks, newRack]);
    setSelectedRackId(newId);
  };

  const componentInfo = getSelectedComponentInfo();
  const componentRecords = getComponentRecords();
  const allRecords = getAllRecordsSorted();

  // Show loading screen while data is loading
  if (loadingData) {
    return (
      <div className="flex h-screen bg-gray-900 items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-400 mx-auto mb-4"></div>
          <p className="text-white text-lg">Loading your data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-900 text-white overflow-hidden">
      {/* Control Panel */}
      <div className="w-96 bg-gray-800 flex flex-col flex-shrink-0">
        {/* User Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-orange-600 flex items-center justify-center text-white font-medium">
              {user?.email?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="flex flex-col">
              <span className="text-sm text-white truncate max-w-[150px]">{user?.email}</span>
              {savingStatus !== 'idle' && (
                <span className={`text-xs ${
                  savingStatus === 'saving' ? 'text-gray-400' :
                  savingStatus === 'saved' ? 'text-green-400' : 'text-red-400'
                }`}>
                  {savingStatus === 'saving' ? 'Saving...' :
                   savingStatus === 'saved' ? 'Saved' : 'Save failed'}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowSettings(true)}
              className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded hover:bg-gray-700 transition-colors"
            >
              ⚙️ Settings
            </button>
            <button
              onClick={handleLogout}
              className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded hover:bg-gray-700 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-700 flex-wrap">
          {['home', 'timeline', 'component', 'analytics'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                activeTab === tab ? 'bg-gray-700 text-orange-400' : 'text-gray-400 hover:bg-gray-750 hover:text-gray-200'
              }`}
            >
              {tab === 'home' && '🏠 Home'}
              {tab === 'timeline' && `📋 Timeline (${allRecords.length})`}
              {tab === 'component' && '🔍 Component'}
              {tab === 'analytics' && '📊 Analytics'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {/* Home Tab */}
          {activeTab === 'home' && (
            <div className="space-y-4">
              {/* Dashboard View - Rack List */}
              {!viewingRackDetails && (
                <>
                  {/* Header with Add Rack button */}
                  <div className="flex items-center justify-between">
                    <h1 className="text-xl font-bold text-orange-400">🏠 Dashboard</h1>
                    <button
                      onClick={addNewRack}
                      className="text-xs bg-green-600 hover:bg-green-500 px-3 py-1 rounded transition-colors"
                    >
                      + Add Rack
                    </button>
                  </div>

                  {/* Overview Stats */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-gray-700 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-white">{racks.length}</p>
                      <p className="text-xs text-gray-400">Total Racks</p>
                    </div>
                    <div className="bg-gray-700 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-white">{allRecords.length}</p>
                      <p className="text-xs text-gray-400">Records</p>
                    </div>
                    <div className="bg-gray-700 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-white">{Object.keys(componentHealth).length}</p>
                      <p className="text-xs text-gray-400">Tracked</p>
                    </div>
                  </div>

                  {/* Rack Cards */}
                  <div className="space-y-2">
                    <h2 className="font-semibold text-blue-300">Your Racks</h2>
                    {racks.map((rack) => {
                      const rackRecords = getRackRecords(rack.id);
                      const healthSummary = getRackHealthSummary(rack.id);

                      return (
                        <div
                          key={rack.id}
                          onClick={() => {
                            setSelectedRackId(rack.id);
                            setViewingRackDetails(rack.id);
                          }}
                          className="bg-gray-700 rounded-lg p-3 cursor-pointer transition-all hover:bg-gray-600 hover:ring-1 hover:ring-orange-500"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-lg font-semibold text-white">{rack.name}</span>
                            <span className="text-xs text-gray-400">
                              {rack.config.bays} bays × {rack.config.levels} levels
                            </span>
                          </div>

                          {/* Quick Stats Row */}
                          <div className="flex gap-4 text-xs">
                            <span className="text-gray-400">
                              📋 <span className="text-white">{rackRecords.length}</span> records
                            </span>
                            {healthSummary.total > 0 && (
                              <span className="text-gray-400">
                                {healthSummary.critical > 0 && <span className="text-red-400 mr-2">⚠️ {healthSummary.critical}</span>}
                                {healthSummary.warning > 0 && <span className="text-yellow-400 mr-2">⚡ {healthSummary.warning}</span>}
                                {healthSummary.good > 0 && <span className="text-green-400">✓ {healthSummary.good}</span>}
                              </span>
                            )}
                            <span className="text-gray-500 ml-auto">View →</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* Rack Detail View */}
              {viewingRackDetails && (() => {
                const detailRack = racks.find(r => r.id === viewingRackDetails);
                if (!detailRack) return null;

                const rackRecords = getRackRecords(detailRack.id);
                const healthSummary = getRackHealthSummary(detailRack.id);
                const rackInspections = rackRecords.filter(r => r.componentId === `${detailRack.id}-rack`);
                const componentRecords = rackRecords.filter(r => r.componentId !== `${detailRack.id}-rack`);

                return (
                  <>
                    {/* Header with Back button */}
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => {
                          setViewingRackDetails(null);
                          setShowRackInspection(false);
                        }}
                        className="text-gray-400 hover:text-white transition-colors"
                      >
                        ← Back
                      </button>
                      <h1 className="text-xl font-bold text-orange-400">{detailRack.name}</h1>
                    </div>

                    {/* Rack Info Card */}
                    <div className="bg-gray-700 rounded-lg p-4">
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                          <p className="text-xs text-gray-400">Configuration</p>
                          <p className="text-white font-medium">{detailRack.config.bays} bays × {detailRack.config.levels} levels</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400">Dimensions</p>
                          <p className="text-white font-medium">
                            {(detailRack.config.bays * detailRack.config.bayWidth).toFixed(1)}m × {detailRack.config.bayDepth}m × {(detailRack.config.levels * detailRack.config.levelHeight).toFixed(1)}m
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400">Position</p>
                          <p className="text-white font-medium">X: {detailRack.position.x.toFixed(1)}m, Z: {detailRack.position.z.toFixed(1)}m</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400">Rotation</p>
                          <p className="text-white font-medium">{Math.round(detailRack.rotation * 180 / Math.PI)}°</p>
                        </div>
                      </div>

                      {/* Health Summary */}
                      {healthSummary.total > 0 && (
                        <div className="pt-3 border-t border-gray-600">
                          <p className="text-xs text-gray-400 mb-2">Component Health</p>
                          <div className="flex gap-3">
                            {healthSummary.good > 0 && (
                              <span className="text-sm bg-green-900/50 text-green-400 px-2 py-1 rounded">
                                ✓ {healthSummary.good} Good
                              </span>
                            )}
                            {healthSummary.warning > 0 && (
                              <span className="text-sm bg-yellow-900/50 text-yellow-400 px-2 py-1 rounded">
                                ⚡ {healthSummary.warning} Warning
                              </span>
                            )}
                            {healthSummary.critical > 0 && (
                              <span className="text-sm bg-red-900/50 text-red-400 px-2 py-1 rounded">
                                ⚠️ {healthSummary.critical} Critical
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Quick Actions */}
                      <div className="flex gap-2 mt-4 pt-3 border-t border-gray-600">
                        <button
                          onClick={() => focusOnRack()}
                          className="flex-1 text-xs bg-orange-600 hover:bg-orange-500 text-white py-2 px-3 rounded transition-colors"
                        >
                          🎯 Focus Camera
                        </button>
                        <button
                          onClick={() => duplicateRack(detailRack.id)}
                          className="flex-1 text-xs bg-gray-600 hover:bg-gray-500 text-white py-2 px-3 rounded transition-colors"
                        >
                          📋 Duplicate
                        </button>
                      </div>
                    </div>

                    {/* Position & Rotation */}
                    <div className="bg-gray-700 rounded-lg p-4">
                      <h2 className="font-semibold text-blue-300 mb-3">📍 Position & Rotation</h2>
                      <div className="grid grid-cols-2 gap-4 mb-3">
                        <div>
                          <span className="text-xs text-gray-400">X Position: {detailRack.position.x.toFixed(1)}m</span>
                          <input
                            type="range"
                            min="-30"
                            max="30"
                            step="0.5"
                            value={detailRack.position.x}
                            onChange={(e) => updateRackPosition(detailRack.id, parseFloat(e.target.value), detailRack.position.z)}
                            className="w-full accent-orange-500"
                          />
                        </div>
                        <div>
                          <span className="text-xs text-gray-400">Z Position: {detailRack.position.z.toFixed(1)}m</span>
                          <input
                            type="range"
                            min="-30"
                            max="30"
                            step="0.5"
                            value={detailRack.position.z}
                            onChange={(e) => updateRackPosition(detailRack.id, detailRack.position.x, parseFloat(e.target.value))}
                            className="w-full accent-orange-500"
                          />
                        </div>
                      </div>
                      <div>
                        <span className="text-xs text-gray-400">Rotation: {Math.round(detailRack.rotation * 180 / Math.PI)}°</span>
                        <input
                          type="range"
                          min="0"
                          max={Math.PI * 2}
                          step={Math.PI / 12}
                          value={detailRack.rotation}
                          onChange={(e) => updateRackRotation(detailRack.id, parseFloat(e.target.value))}
                          className="w-full accent-orange-500"
                        />
                      </div>
                    </div>

                    {/* Rack Configuration */}
                    <div className="bg-gray-700 rounded-lg p-4">
                      <h2 className="font-semibold text-blue-300 mb-3">⚙️ Configuration</h2>

                      <div className="space-y-3">
                        <div>
                          <span className="text-xs text-gray-400">Number of Bays: {detailRack.config.bays}</span>
                          <input
                            type="range"
                            min="1"
                            max="10"
                            value={detailRack.config.bays}
                            onChange={(e) => updateConfig('bays', parseInt(e.target.value))}
                            className="w-full accent-orange-500"
                          />
                        </div>

                        <div>
                          <span className="text-xs text-gray-400">Number of Levels: {detailRack.config.levels}</span>
                          <input
                            type="range"
                            min="1"
                            max="8"
                            value={detailRack.config.levels}
                            onChange={(e) => updateConfig('levels', parseInt(e.target.value))}
                            className="w-full accent-orange-500"
                          />
                        </div>

                        <div>
                          <span className="text-xs text-gray-400">Bay Width: {detailRack.config.bayWidth.toFixed(1)}m</span>
                          <input
                            type="range"
                            min="1.5"
                            max="4"
                            step="0.1"
                            value={detailRack.config.bayWidth}
                            onChange={(e) => updateConfig('bayWidth', parseFloat(e.target.value))}
                            className="w-full accent-orange-500"
                          />
                        </div>

                        <div>
                          <span className="text-xs text-gray-400">Bay Depth: {detailRack.config.bayDepth.toFixed(1)}m</span>
                          <input
                            type="range"
                            min="0.8"
                            max="2"
                            step="0.1"
                            value={detailRack.config.bayDepth}
                            onChange={(e) => updateConfig('bayDepth', parseFloat(e.target.value))}
                            className="w-full accent-orange-500"
                          />
                        </div>

                        <div>
                          <span className="text-xs text-gray-400">Level Height: {detailRack.config.levelHeight.toFixed(1)}m</span>
                          <input
                            type="range"
                            min="1"
                            max="3"
                            step="0.1"
                            value={detailRack.config.levelHeight}
                            onChange={(e) => updateConfig('levelHeight', parseFloat(e.target.value))}
                            className="w-full accent-orange-500"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Display Options */}
                    <div className="bg-gray-700 rounded-lg p-4">
                      <h2 className="font-semibold text-blue-300 mb-3">👁️ Display Options</h2>

                      {/* View Mode */}
                      <div className="mb-4">
                        <span className="text-xs text-gray-400 block mb-2">View Mode</span>
                        <div className="flex gap-2">
                          {[
                            { value: 'normal', label: 'Normal' },
                            { value: 'health', label: 'Health' },
                            { value: 'heatmap', label: 'Inspection' },
                          ].map((mode) => (
                            <button
                              key={mode.value}
                              onClick={() => setViewMode(mode.value)}
                              className={`flex-1 py-1.5 px-2 rounded text-xs font-medium transition-colors ${
                                viewMode === mode.value
                                  ? 'bg-orange-600 text-white'
                                  : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
                              }`}
                            >
                              {mode.label}
                            </button>
                          ))}
                        </div>
                        {viewMode === 'health' && (
                          <p className="mt-1 text-xs text-gray-500">Colors by component health status</p>
                        )}
                        {viewMode === 'heatmap' && (
                          <p className="mt-1 text-xs text-gray-500">Colors by days since last inspection</p>
                        )}
                      </div>

                      <label className="flex items-center mb-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={detailRack.config.showWireDecks}
                          onChange={(e) => updateConfig('showWireDecks', e.target.checked)}
                          className="mr-2 accent-orange-500"
                        />
                        <span className="text-sm text-gray-300">Show Wire Decks</span>
                      </label>

                      <label className="flex items-center mb-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={detailRack.config.showPallets}
                          onChange={(e) => updateConfig('showPallets', e.target.checked)}
                          className="mr-2 accent-orange-500"
                        />
                        <span className="text-sm text-gray-300">Show Pallets</span>
                      </label>

                      {detailRack.config.showPallets && (
                        <div className="mt-2 ml-6">
                          <span className="text-xs text-gray-400">Fill Rate: {detailRack.config.palletFill}%</span>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={detailRack.config.palletFill}
                            onChange={(e) => updateConfig('palletFill', parseInt(e.target.value))}
                            className="w-full accent-orange-500"
                          />
                        </div>
                      )}
                    </div>

                    {/* Rack Inspections Section */}
                    <div className="bg-gray-700 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h2 className="font-semibold text-blue-300">🔍 Rack Inspections</h2>
                        {!showRackInspection && (
                          <button
                            onClick={() => setShowRackInspection(true)}
                            className="text-xs bg-green-600 hover:bg-green-500 px-3 py-1 rounded transition-colors"
                          >
                            + Add Inspection
                          </button>
                        )}
                      </div>

                      {/* Add Rack Inspection Form */}
                      {showRackInspection && (
                        <div className="bg-gray-600 rounded-lg p-3 mb-3 space-y-3">
                          <div>
                            <label className="text-xs text-gray-400">Status</label>
                            <select
                              value={newRackInspection.status}
                              onChange={(e) => setNewRackInspection(prev => ({ ...prev, status: e.target.value }))}
                              className="w-full mt-1 bg-gray-700 rounded px-3 py-2 text-sm border-0 focus:ring-2 focus:ring-orange-500"
                            >
                              {statusTypes.map(status => (
                                <option key={status.value} value={status.value}>{status.label}</option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="text-xs text-gray-400">Inspector</label>
                            <input
                              type="text"
                              value={newRackInspection.technician}
                              onChange={(e) => setNewRackInspection(prev => ({ ...prev, technician: e.target.value }))}
                              placeholder="Name (optional)"
                              className="w-full mt-1 bg-gray-700 rounded px-3 py-2 text-sm border-0 focus:ring-2 focus:ring-orange-500"
                            />
                          </div>

                          <div>
                            <label className="text-xs text-gray-400">Inspection Notes *</label>
                            <textarea
                              value={newRackInspection.description}
                              onChange={(e) => setNewRackInspection(prev => ({ ...prev, description: e.target.value }))}
                              placeholder="Describe the inspection findings..."
                              rows={3}
                              className="w-full mt-1 bg-gray-700 rounded px-3 py-2 text-sm resize-none border-0 focus:ring-2 focus:ring-orange-500"
                            />
                          </div>

                          {/* Image Upload */}
                          <div>
                            <label className="text-xs text-gray-400">Photos (optional)</label>
                            <input
                              ref={rackInspectionImageInputRef}
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              multiple
                              onChange={handleRackInspectionImageSelect}
                              className="hidden"
                            />
                            <button
                              type="button"
                              onClick={() => rackInspectionImageInputRef.current?.click()}
                              className="w-full mt-1 bg-gray-700 hover:bg-gray-500 rounded px-3 py-2 text-sm transition-colors flex items-center justify-center gap-2"
                            >
                              <span>📷</span>
                              <span>Add Photos</span>
                            </button>

                            {rackInspectionImages.length > 0 && (
                              <div className="mt-2 grid grid-cols-3 gap-2">
                                {rackInspectionImages.map((img, idx) => (
                                  <div key={idx} className="relative group">
                                    <img
                                      src={img.preview}
                                      alt={`Preview ${idx + 1}`}
                                      className="w-full h-16 object-cover rounded"
                                    />
                                    <button
                                      onClick={() => removeRackInspectionImage(idx)}
                                      className="absolute top-0 right-0 bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                      ×
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="flex gap-2">
                            <button
                              onClick={addRackInspection}
                              disabled={!newRackInspection.description || uploadingRackInspection}
                              className="flex-1 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white py-2 px-4 rounded font-medium text-sm transition-colors"
                            >
                              {uploadingRackInspection ? 'Saving...' : 'Save Inspection'}
                            </button>
                            <button
                              onClick={() => {
                                setShowRackInspection(false);
                                rackInspectionImages.forEach(img => URL.revokeObjectURL(img.preview));
                                setRackInspectionImages([]);
                                setNewRackInspection({ description: '', technician: '', status: 'completed' });
                              }}
                              className="px-4 py-2 bg-gray-500 hover:bg-gray-400 rounded text-sm transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Inspection List */}
                      {rackInspections.length === 0 ? (
                        <p className="text-sm text-gray-400 text-center py-3">
                          No rack inspections yet. Add one above.
                        </p>
                      ) : (
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {rackInspections.map((record) => {
                            const statusInfo = statusTypes.find(s => s.value === record.status);
                            return (
                              <div
                                key={record.id}
                                className="bg-gray-600 rounded p-3 border-l-4 border-blue-500"
                              >
                                <div className="flex items-center justify-between mb-1">
                                  <span
                                    className="text-xs px-2 py-0.5 rounded"
                                    style={{ backgroundColor: statusInfo?.color + '33', color: statusInfo?.color }}
                                  >
                                    {statusInfo?.label}
                                  </span>
                                  <button
                                    onClick={() => deleteRecord(`${detailRack.id}-rack`, record.id)}
                                    className="text-gray-500 hover:text-red-400 transition-colors text-sm"
                                  >
                                    🗑️
                                  </button>
                                </div>
                                <p className="text-sm text-gray-200 mt-1">{record.description}</p>
                                {record.technician && (
                                  <p className="text-xs text-gray-400 mt-1">Inspector: {record.technician}</p>
                                )}
                                {record.images && record.images.length > 0 && (
                                  <div className="flex gap-1 mt-2">
                                    {record.images.map((imgPath, idx) => (
                                      <button
                                        key={idx}
                                        onClick={() => setSelectedImageModal(`/api/uploads/${imgPath}`)}
                                        className="w-10 h-10 rounded overflow-hidden hover:ring-1 hover:ring-orange-400"
                                      >
                                        <img src={`/api/uploads/${imgPath}`} alt="" className="w-full h-full object-cover" />
                                      </button>
                                    ))}
                                  </div>
                                )}
                                <p className="text-xs text-gray-500 mt-2">{formatDate(record.timestamp)}</p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Component Maintenance Records */}
                    <div className="bg-gray-700 rounded-lg p-4">
                      <h2 className="font-semibold text-blue-300 mb-3">🔧 Component Records</h2>
                      {componentRecords.length === 0 ? (
                        <p className="text-sm text-gray-400 text-center py-3">
                          No component records yet.
                          <br />
                          <span className="text-xs">Click on a component in the 3D view to add records.</span>
                        </p>
                      ) : (
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                          {componentRecords.map((record) => {
                            const typeInfo = maintenanceTypes.find(t => t.value === record.type);
                            const statusInfo = statusTypes.find(s => s.value === record.status);
                            return (
                              <div
                                key={record.id}
                                className="bg-gray-600 rounded p-2 border-l-4"
                                style={{ borderColor: typeInfo?.color }}
                              >
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-xs font-medium">{typeInfo?.label}</span>
                                  <span
                                    className="text-xs px-1.5 py-0.5 rounded"
                                    style={{ backgroundColor: statusInfo?.color + '33', color: statusInfo?.color }}
                                  >
                                    {statusInfo?.label}
                                  </span>
                                </div>
                                <p className="text-xs text-blue-300">{record.componentLabel}</p>
                                <p className="text-xs text-gray-300 mt-1">{record.description}</p>
                                {record.images && record.images.length > 0 && (
                                  <div className="flex gap-1 mt-1">
                                    {record.images.map((imgPath, idx) => (
                                      <button
                                        key={idx}
                                        onClick={() => setSelectedImageModal(`/api/uploads/${imgPath}`)}
                                        className="w-8 h-8 rounded overflow-hidden hover:ring-1 hover:ring-orange-400"
                                      >
                                        <img src={`/api/uploads/${imgPath}`} alt="" className="w-full h-full object-cover" />
                                      </button>
                                    ))}
                                  </div>
                                )}
                                <p className="text-xs text-gray-500 mt-1">{formatDate(record.timestamp)}</p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Danger Zone */}
                    <div className="bg-gray-700 rounded-lg p-4">
                      <h2 className="font-semibold text-red-400 mb-3">⚠️ Danger Zone</h2>
                      <button
                        onClick={() => {
                          if (racks.length > 1) {
                            deleteRack(detailRack.id);
                            setViewingRackDetails(null);
                          }
                        }}
                        disabled={racks.length <= 1}
                        className="w-full text-sm bg-red-600 hover:bg-red-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white py-2 px-3 rounded transition-colors"
                      >
                        🗑️ Delete This Rack
                      </button>
                      {racks.length <= 1 && (
                        <p className="text-xs text-gray-500 mt-2 text-center">Cannot delete the last rack</p>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* Timeline Tab */}
          {activeTab === 'timeline' && (
            <div className="space-y-4">
              <h1 className="text-xl font-bold text-orange-400">📋 Maintenance Timeline</h1>
              
              {allRecords.length === 0 ? (
                <div className="bg-gray-700 rounded-lg p-4 text-center text-gray-400">
                  <p>No maintenance records yet.</p>
                  <p className="text-sm mt-2">Click on a component to add records.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {allRecords.map((record) => {
                    const typeInfo = maintenanceTypes.find(t => t.value === record.type);
                    const statusInfo = statusTypes.find(s => s.value === record.status);
                    
                    return (
                      <div
                        key={record.id}
                        className="bg-gray-700 rounded-lg p-3 border-l-4 cursor-pointer hover:bg-gray-600 transition-colors"
                        style={{ borderColor: typeInfo?.color }}
                        onClick={() => {
                          setSelectedComponent(record.componentId);
                          setActiveTab('component');
                        }}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-medium">{typeInfo?.label}</span>
                              <span
                                className="text-xs px-2 py-0.5 rounded"
                                style={{ backgroundColor: statusInfo?.color + '33', color: statusInfo?.color }}
                              >
                                {statusInfo?.label}
                              </span>
                            </div>
                            <p className="text-xs text-blue-300 mb-1">{record.componentLabel}</p>
                            <p className="text-sm text-gray-300">{record.description}</p>
                            {record.technician && (
                              <p className="text-xs text-gray-400 mt-1">Tech: {record.technician}</p>
                            )}
                            {/* Display images in timeline */}
                            {record.images && record.images.length > 0 && (
                              <div className="flex gap-1 mt-2 flex-wrap">
                                {record.images.map((imgPath, imgIdx) => (
                                  <button
                                    key={imgIdx}
                                    onClick={() => setSelectedImageModal(`/api/uploads/${imgPath}`)}
                                    className="w-10 h-10 rounded overflow-hidden hover:ring-2 hover:ring-orange-400 transition-all"
                                  >
                                    <img
                                      src={`/api/uploads/${imgPath}`}
                                      alt={`Photo ${imgIdx + 1}`}
                                      className="w-full h-full object-cover"
                                    />
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">{formatDate(record.timestamp)}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Component Tab */}
          {activeTab === 'component' && (
            <div className="space-y-4">
              <h1 className="text-xl font-bold text-orange-400">🔍 Component Details</h1>
              
              {!selectedComponent ? (
                <div className="bg-gray-700 rounded-lg p-4 text-center text-gray-400">
                  <p>No component selected.</p>
                  <p className="text-sm mt-2">Click on a rack component in the 3D view.</p>
                </div>
              ) : (
                <>
                  <div className="bg-gray-700 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <h2 className="font-semibold text-blue-300">
                        {componentInfo?.label || selectedComponent}
                      </h2>
                      <div className="w-3 h-3 rounded-full bg-green-400 animate-pulse" title="Selected" />
                    </div>
                    <div className="text-sm text-gray-400 space-y-1">
                      <p>Type: <span className="text-white capitalize">{componentInfo?.type}</span></p>
                      {componentInfo?.bay !== undefined && (
                        <p>Bay: <span className="text-white">{componentInfo.bay + 1}</span></p>
                      )}
                      {componentInfo?.level !== undefined && (
                        <p>Level: <span className="text-white">{componentInfo.level}</span></p>
                      )}
                      {componentInfo?.side && (
                        <p>Side: <span className="text-white capitalize">{componentInfo.side}</span></p>
                      )}
                      <p>Records: <span className="text-white">{componentRecords.length}</span></p>
                      <p>Days Since Inspection: <span className="text-white">{getDaysSinceInspection(selectedComponent)}</span></p>
                    </div>
                    
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={focusOnSelected}
                        className="flex-1 text-xs bg-blue-600 hover:bg-blue-500 text-white py-2 px-3 rounded transition-colors"
                      >
                        🎯 Focus
                      </button>
                      <button
                        onClick={() => setSelectedComponent(null)}
                        className="text-xs text-gray-400 hover:text-white py-2 px-3 rounded hover:bg-gray-600 transition-colors"
                      >
                        ✕ Deselect
                      </button>
                    </div>
                  </div>

                  {/* Health Status */}
                  <div className="bg-gray-700 rounded-lg p-3">
                    <h3 className="text-sm font-semibold text-gray-300 mb-2">Health Status</h3>
                    <div className="grid grid-cols-4 gap-2">
                      {healthStatuses.map((status) => (
                        <button
                          key={status.value}
                          onClick={() => updateComponentHealth(selectedComponent, status.value)}
                          className={`py-2 px-2 rounded text-xs font-medium transition-all ${
                            componentHealth[selectedComponent] === status.value
                              ? 'ring-2 ring-white ring-offset-2 ring-offset-gray-700'
                              : 'opacity-70 hover:opacity-100'
                          }`}
                          style={{ backgroundColor: status.color }}
                        >
                          {status.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {!showAddRecord && (
                    <button
                      onClick={() => setShowAddRecord(true)}
                      className="w-full bg-orange-600 hover:bg-orange-500 text-white py-2 px-4 rounded-lg font-medium transition-colors"
                    >
                      + Add Maintenance Record
                    </button>
                  )}

                  {showAddRecord && (
                    <div className="bg-gray-700 rounded-lg p-3 space-y-3">
                      <h3 className="font-semibold text-green-400">New Record</h3>
                      
                      <div>
                        <label className="text-xs text-gray-400">Type</label>
                        <select
                          value={newRecord.type}
                          onChange={(e) => setNewRecord(prev => ({ ...prev, type: e.target.value }))}
                          className="w-full mt-1 bg-gray-600 rounded px-3 py-2 text-sm border-0 focus:ring-2 focus:ring-orange-500"
                        >
                          {maintenanceTypes.map(type => (
                            <option key={type.value} value={type.value}>{type.label}</option>
                          ))}
                        </select>
                      </div>
                      
                      <div>
                        <label className="text-xs text-gray-400">Status</label>
                        <select
                          value={newRecord.status}
                          onChange={(e) => setNewRecord(prev => ({ ...prev, status: e.target.value }))}
                          className="w-full mt-1 bg-gray-600 rounded px-3 py-2 text-sm border-0 focus:ring-2 focus:ring-orange-500"
                        >
                          {statusTypes.map(status => (
                            <option key={status.value} value={status.value}>{status.label}</option>
                          ))}
                        </select>
                      </div>
                      
                      <div>
                        <label className="text-xs text-gray-400">Technician</label>
                        <input
                          type="text"
                          value={newRecord.technician}
                          onChange={(e) => setNewRecord(prev => ({ ...prev, technician: e.target.value }))}
                          placeholder="Name (optional)"
                          className="w-full mt-1 bg-gray-600 rounded px-3 py-2 text-sm border-0 focus:ring-2 focus:ring-orange-500"
                        />
                      </div>
                      
                      <div>
                        <label className="text-xs text-gray-400">Description *</label>
                        <textarea
                          value={newRecord.description}
                          onChange={(e) => setNewRecord(prev => ({ ...prev, description: e.target.value }))}
                          placeholder="Describe the maintenance work..."
                          rows={3}
                          className="w-full mt-1 bg-gray-600 rounded px-3 py-2 text-sm resize-none border-0 focus:ring-2 focus:ring-orange-500"
                        />
                      </div>

                      {/* Image Upload */}
                      <div>
                        <label className="text-xs text-gray-400">Photos (optional)</label>
                        <input
                          ref={imageInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          multiple
                          onChange={handleImageSelect}
                          className="hidden"
                        />
                        <button
                          type="button"
                          onClick={() => imageInputRef.current?.click()}
                          className="w-full mt-1 bg-gray-600 hover:bg-gray-500 rounded px-3 py-2 text-sm transition-colors flex items-center justify-center gap-2"
                        >
                          <span>📷</span>
                          <span>Add Photos</span>
                        </button>

                        {/* Image Previews */}
                        {pendingImages.length > 0 && (
                          <div className="mt-2 grid grid-cols-3 gap-2">
                            {pendingImages.map((img, idx) => (
                              <div key={idx} className="relative group">
                                <img
                                  src={img.preview}
                                  alt={`Preview ${idx + 1}`}
                                  className="w-full h-16 object-cover rounded"
                                />
                                <button
                                  onClick={() => removeImage(idx)}
                                  className="absolute top-0 right-0 bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  X
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={addMaintenanceRecord}
                          disabled={!newRecord.description || uploadingImages}
                          className="flex-1 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white py-2 px-4 rounded font-medium text-sm transition-colors"
                        >
                          {uploadingImages ? 'Uploading...' : 'Save Record'}
                        </button>
                        <button
                          onClick={() => {
                            setShowAddRecord(false);
                            pendingImages.forEach(img => URL.revokeObjectURL(img.preview));
                            setPendingImages([]);
                          }}
                          className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded text-sm transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {componentRecords.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="font-semibold text-gray-300">Maintenance History</h3>
                      {componentRecords.map((record) => {
                        const typeInfo = maintenanceTypes.find(t => t.value === record.type);
                        const statusInfo = statusTypes.find(s => s.value === record.status);
                        
                        return (
                          <div
                            key={record.id}
                            className="bg-gray-700 rounded-lg p-3 border-l-4"
                            style={{ borderColor: typeInfo?.color }}
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-sm font-medium">{typeInfo?.label}</span>
                                  <span
                                    className="text-xs px-2 py-0.5 rounded"
                                    style={{ backgroundColor: statusInfo?.color + '33', color: statusInfo?.color }}
                                  >
                                    {statusInfo?.label}
                                  </span>
                                </div>
                                <p className="text-sm text-gray-300">{record.description}</p>
                                {record.technician && (
                                  <p className="text-xs text-gray-400 mt-1">Tech: {record.technician}</p>
                                )}
                                {/* Display images */}
                                {record.images && record.images.length > 0 && (
                                  <div className="flex gap-1 mt-2 flex-wrap">
                                    {record.images.map((imgPath, imgIdx) => (
                                      <button
                                        key={imgIdx}
                                        onClick={() => setSelectedImageModal(`/api/uploads/${imgPath}`)}
                                        className="w-12 h-12 rounded overflow-hidden hover:ring-2 hover:ring-orange-400 transition-all"
                                      >
                                        <img
                                          src={`/api/uploads/${imgPath}`}
                                          alt={`Photo ${imgIdx + 1}`}
                                          className="w-full h-full object-cover"
                                        />
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <button
                                onClick={() => deleteRecord(selectedComponent, record.id)}
                                className="text-gray-500 hover:text-red-400 ml-2 transition-colors"
                              >
                                🗑️
                              </button>
                            </div>
                            <p className="text-xs text-gray-500 mt-2">{formatDate(record.timestamp)}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Analytics Tab */}
          {activeTab === 'analytics' && (
            <div className="space-y-4">
              <h1 className="text-xl font-bold text-orange-400">📊 Analytics Dashboard</h1>
              
              {/* Summary Cards */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-700 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-white">{analytics.totalRecords}</p>
                  <p className="text-xs text-gray-400">Total Records</p>
                </div>
                <div className="bg-gray-700 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-orange-400">{analytics.pendingCount}</p>
                  <p className="text-xs text-gray-400">Pending Actions</p>
                </div>
                <div className="bg-gray-700 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-white">{analytics.componentsWithRecords}</p>
                  <p className="text-xs text-gray-400">Components Tracked</p>
                </div>
                <div className="bg-gray-700 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-white">{analytics.totalComponents}</p>
                  <p className="text-xs text-gray-400">Total Components</p>
                </div>
              </div>

              {/* Records by Type */}
              {analytics.byType.length > 0 && (
                <div className="bg-gray-700 rounded-lg p-3">
                  <h3 className="text-sm font-semibold text-gray-300 mb-3">Records by Type</h3>
                  <ResponsiveContainer width="100%" height={150}>
                    <PieChart>
                      <Pie
                        data={analytics.byType}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={50}
                        label={({ name, value }) => `${name}: ${value}`}
                        labelLine={false}
                      >
                        {analytics.byType.map((entry, index) => (
                          <Cell key={index} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Activity Over Time */}
              <div className="bg-gray-700 rounded-lg p-3">
                <h3 className="text-sm font-semibold text-gray-300 mb-3">Activity (Last 7 Days)</h3>
                <ResponsiveContainer width="100%" height={120}>
                  <LineChart data={analytics.last7Days}>
                    <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 10 }} />
                    <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#374151', border: 'none' }}
                      labelStyle={{ color: '#fff' }}
                    />
                    <Line type="monotone" dataKey="count" stroke="#f97316" strokeWidth={2} dot={{ fill: '#f97316' }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Most Maintained */}
              {analytics.topComponents.length > 0 && (
                <div className="bg-gray-700 rounded-lg p-3">
                  <h3 className="text-sm font-semibold text-gray-300 mb-3">Most Maintained Components</h3>
                  <ResponsiveContainer width="100%" height={120}>
                    <BarChart data={analytics.topComponents} layout="vertical">
                      <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 10 }} />
                      <YAxis type="category" dataKey="name" tick={{ fill: '#9ca3af', fontSize: 9 }} width={100} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#374151', border: 'none' }}
                        labelStyle={{ color: '#fff' }}
                      />
                      <Bar dataKey="count" fill="#3b82f6" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Health Distribution */}
              {analytics.healthCounts.length > 0 && (
                <div className="bg-gray-700 rounded-lg p-3">
                  <h3 className="text-sm font-semibold text-gray-300 mb-3">Health Distribution</h3>
                  <ResponsiveContainer width="100%" height={100}>
                    <BarChart data={analytics.healthCounts}>
                      <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 10 }} />
                      <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#374151', border: 'none' }}
                        labelStyle={{ color: '#fff' }}
                      />
                      <Bar dataKey="value">
                        {analytics.healthCounts.map((entry, index) => (
                          <Cell key={index} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Records by Status */}
              {analytics.byStatus.length > 0 && (
                <div className="bg-gray-700 rounded-lg p-3">
                  <h3 className="text-sm font-semibold text-gray-300 mb-2">Status Breakdown</h3>
                  <div className="space-y-2">
                    {analytics.byStatus.map((status) => (
                      <div key={status.name} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: status.color }} />
                          <span className="text-sm text-gray-300">{status.name}</span>
                        </div>
                        <span className="text-sm font-medium text-white">{status.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 3D Viewport */}
      <div className="flex-1 relative">
        <div
          ref={containerRef}
          className="w-full h-full cursor-grab active:cursor-grabbing"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          onClick={handleClick}
        />
        
        {/* Camera Presets */}
        <div className="absolute top-4 left-4 flex gap-1">
          {cameraPresets.map((preset) => (
            <button
              key={preset.name}
              onClick={() => applyCameraPreset(preset)}
              className="bg-gray-800 bg-opacity-90 hover:bg-gray-700 px-3 py-2 rounded text-xs font-medium transition-colors"
              title={preset.name}
            >
              {preset.name}
            </button>
          ))}
        </div>
        
        {/* Hover tooltip */}
        {hoveredComponent && !isDragging && (
          <div className="absolute top-16 left-4 bg-gray-800 bg-opacity-95 rounded-lg px-3 py-2 pointer-events-none shadow-lg">
            <p className="text-sm font-medium text-white">{hoveredComponent.label}</p>
            <p className="text-xs text-gray-400 capitalize">{hoveredComponent.type}</p>
            {maintenanceRecords[hoveredComponent.componentId]?.length > 0 && (
              <p className="text-xs text-orange-400 mt-1">
                📋 {maintenanceRecords[hoveredComponent.componentId].length} record(s)
              </p>
            )}
            {componentHealth[hoveredComponent.componentId] && (
              <p className="text-xs mt-1" style={{ color: healthStatuses.find(h => h.value === componentHealth[hoveredComponent.componentId])?.color }}>
                Health: {healthStatuses.find(h => h.value === componentHealth[hoveredComponent.componentId])?.label}
              </p>
            )}
          </div>
        )}

        {/* Selected indicator */}
        {selectedComponent && (
          <div className="absolute bottom-4 left-4 bg-green-600 bg-opacity-95 rounded-lg px-3 py-2 shadow-lg">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
              <p className="text-sm font-medium text-white">
                {componentInfo?.label || selectedComponent}
              </p>
            </div>
          </div>
        )}

        {/* View Mode Legend */}
        <div className="absolute top-4 right-4 bg-gray-800 bg-opacity-95 rounded-lg px-3 py-2 text-xs space-y-1 shadow-lg">
          <div className="font-medium text-gray-300 mb-1">
            {viewMode === 'normal' && 'Normal View'}
            {viewMode === 'health' && 'Health View'}
            {viewMode === 'heatmap' && 'Inspection Heatmap'}
          </div>
          {viewMode === 'normal' && (
            <>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-400" />
                <span className="text-gray-300">Selected</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-orange-500" />
                <span className="text-gray-300">Has Records</span>
              </div>
            </>
          )}
          {viewMode === 'health' && healthStatuses.map((status) => (
            <div key={status.value} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: status.color }} />
              <span className="text-gray-300">{status.label}</span>
            </div>
          ))}
          {viewMode === 'heatmap' && (
            <>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span className="text-gray-300">≤ 7 days</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-yellow-500" />
                <span className="text-gray-300">≤ 30 days</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-orange-500" />
                <span className="text-gray-300">≤ 90 days</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <span className="text-gray-300">&gt; 90 days</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-96 max-w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-orange-400 mb-4">⚙️ Settings</h2>

            {/* Colors Section */}
            <div className="mb-6">
              <h3 className="font-semibold mb-3 text-blue-300">Rack Colors</h3>
              <p className="text-xs text-gray-400 mb-3">Colors apply to the selected rack: {selectedRack?.name}</p>

              <label className="flex items-center justify-between mb-3">
                <span className="text-sm text-gray-300">Frame Color</span>
                <input
                  type="color"
                  value={config.frameColor}
                  onChange={(e) => updateConfig('frameColor', e.target.value)}
                  className="w-12 h-8 rounded cursor-pointer border-0"
                />
              </label>

              <label className="flex items-center justify-between mb-3">
                <span className="text-sm text-gray-300">Beam Color</span>
                <input
                  type="color"
                  value={config.beamColor}
                  onChange={(e) => updateConfig('beamColor', e.target.value)}
                  className="w-12 h-8 rounded cursor-pointer border-0"
                />
              </label>

              <label className="flex items-center justify-between mb-3">
                <span className="text-sm text-gray-300">Cross Bar Color</span>
                <input
                  type="color"
                  value={config.crossbarColor}
                  onChange={(e) => updateConfig('crossbarColor', e.target.value)}
                  className="w-12 h-8 rounded cursor-pointer border-0"
                />
              </label>

              <label className="flex items-center justify-between mb-3">
                <span className="text-sm text-gray-300">Wire Deck Color</span>
                <input
                  type="color"
                  value={config.wireDeckColor}
                  onChange={(e) => updateConfig('wireDeckColor', e.target.value)}
                  className="w-12 h-8 rounded cursor-pointer border-0"
                />
              </label>

              <label className="flex items-center justify-between mb-3">
                <span className="text-sm text-gray-300">Pallet Color</span>
                <input
                  type="color"
                  value={config.palletColor}
                  onChange={(e) => updateConfig('palletColor', e.target.value)}
                  className="w-12 h-8 rounded cursor-pointer border-0"
                />
              </label>
            </div>

            {/* Data Management Section */}
            <div className="mb-6">
              <h3 className="font-semibold mb-3 text-blue-300">Data Management</h3>
              <button
                onClick={() => {
                  setShowSettings(false);
                  setShowExportModal(true);
                }}
                className="w-full bg-gray-700 hover:bg-gray-600 text-white py-2 px-4 rounded font-medium transition-colors"
              >
                💾 Import / Export Data
              </button>
            </div>

            <button
              onClick={() => setShowSettings(false)}
              className="w-full bg-gray-600 hover:bg-gray-500 text-white py-2 px-4 rounded font-medium transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Export/Import Modal */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-96 max-w-full mx-4">
            <h2 className="text-xl font-bold text-orange-400 mb-4">💾 Save / Load Data</h2>
            
            <div className="space-y-4">
              <div className="bg-gray-700 rounded-lg p-4">
                <h3 className="font-semibold text-blue-300 mb-2">Export Data</h3>
                <p className="text-sm text-gray-400 mb-3">
                  Download all rack configuration, maintenance records, and health data as a JSON file.
                </p>
                <button
                  onClick={exportData}
                  className="w-full bg-green-600 hover:bg-green-500 text-white py-2 px-4 rounded font-medium transition-colors"
                >
                  📥 Download JSON
                </button>
              </div>

              <div className="bg-gray-700 rounded-lg p-4">
                <h3 className="font-semibold text-blue-300 mb-2">Import Data</h3>
                <p className="text-sm text-gray-400 mb-3">
                  Load a previously exported JSON file to restore your data.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleImport}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 px-4 rounded font-medium transition-colors"
                >
                  📤 Load JSON File
                </button>
                {importError && (
                  <p className="text-red-400 text-sm mt-2">{importError}</p>
                )}
              </div>
            </div>

            <button
              onClick={() => {
                setShowExportModal(false);
                setImportError(null);
              }}
              className="w-full mt-4 bg-gray-600 hover:bg-gray-500 text-white py-2 px-4 rounded font-medium transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Image Modal for viewing full-size images */}
      {selectedImageModal && !annotatingImage && (
        <div
          className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50"
          onClick={() => setSelectedImageModal(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] p-4" onClick={(e) => e.stopPropagation()}>
            {/* Close button */}
            <button
              onClick={() => setSelectedImageModal(null)}
              className="absolute top-2 right-2 bg-gray-800 hover:bg-gray-700 text-white rounded-full w-10 h-10 flex items-center justify-center text-xl z-10"
            >
              ×
            </button>

            {/* Annotate button */}
            <button
              onClick={() => setAnnotatingImage(selectedImageModal)}
              className="absolute top-2 left-2 bg-orange-600 hover:bg-orange-500 text-white px-4 py-2 rounded-lg flex items-center gap-2 z-10 transition-colors"
            >
              <span>✏️</span>
              <span>Annotate</span>
            </button>

            <img
              src={selectedImageModal}
              alt="Full size view"
              className="max-w-full max-h-[85vh] object-contain rounded-lg"
            />
          </div>
        </div>
      )}

      {/* Annotation Editor */}
      {annotatingImage && (
        <AnnotationEditor
          imageUrl={annotatingImage}
          onSave={handleSaveAnnotation}
          onCancel={() => setAnnotatingImage(null)}
        />
      )}
    </div>
  );
}
