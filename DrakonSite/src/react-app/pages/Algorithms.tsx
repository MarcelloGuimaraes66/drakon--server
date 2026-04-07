import { useParams, useNavigate, useSearchParams } from "react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Layout from "@/react-app/components/Layout";
import CameraCustomAgentEditorModal, {
  type CameraAgentEditorTarget,
  type CameraCustomAgentRow,
} from "@/react-app/components/CameraCustomAgentEditorModal";
import HubPublishModal from "@/react-app/components/hub/HubPublishModal";
import { useOnboarding } from "@/react-app/hooks/useOnboarding";
import { ONBOARDING_TARGETS } from "@/react-app/lib/onboarding";
import {
  emitOpenAiKeyRequiredPrompt,
  isOpenAiKeyRequiredError,
} from "@/react-app/utils/openAiKeyGuard";
import { Algorithm, ReIDTarget } from "@/shared/types";
import { ArrowLeft, Cpu, Plus, Trash2, MapPin, X, Pencil, Upload, AlertCircle, Sparkles } from "lucide-react";

// Algorithm state structure - keyed by algorithm_type
type AlgorithmState = {
  [algorithm_type: string]: {
    is_enabled: boolean;
    llm_prompt?: string | null;
    image_region?: string | null;
    config_json?: any | null;
  };
};

type IntruderArea = {
  name: string;
  description: string;
};

type CustomAlgorithm = {
  id: number;
  algorithm_type: string;
  display_name: string;
  is_enabled: boolean;
  input_type: "video" | "image";
  video_packaging_mode: "mosaic_2x2" | "mosaic_3x3" | "frame_sequence";
  inference_model: "core" | "ultra" | "ultra_plus" | "light" | "legacy" | "pro";
  model_fps: number;
  run_every: number;
  running_resolution: number | null;
  prompt_template: string;
  alert_condition: string;
  negative_condition: string;
  only_capture_on_motion: boolean;
  face_target_ids: number[];
  negative_reference_images: Array<{ id: number; image_url: string }>;
  analysis_regions: unknown[];
};

type FaceIdTarget = ReIDTarget & {
  image_url?: string | null;
};

type ToastMessage = {
  id: number;
  title: string;
  description: string;
  variant: "default" | "destructive";
};

const AGENT_EDITOR_ONBOARDING_STEPS = new Set([
  "agent-model",
  "agent-input-type",
  "agent-fields",
  "agent-enhance",
  "agent-polygons",
  "agent-execution",
  "agent-save",
]);

const AGENT_TUTORIAL_COMPLETION_STEPS = new Set([
  "agent-create",
  "agent-model",
  "agent-input-type",
  "agent-fields",
  "agent-enhance",
  "agent-polygons",
  "agent-execution",
  "agent-save",
]);

export default function Algorithms() {
  const { t } = useTranslation();
  const { cameraId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    currentStepId: onboardingStepId,
    isOpen: isOnboardingOpen,
    tutorialCameraId,
    tutorialAgentId,
    completeAgentTutorial,
  } = useOnboarding();
  const tutorialManagedEditorRef = useRef(false);
  const numericCameraId = Number(cameraId || 0);
  const isTutorialCamera =
    typeof tutorialCameraId === "number" &&
    Number.isInteger(tutorialCameraId) &&
    tutorialCameraId > 0 &&
    tutorialCameraId === numericCameraId;
  
  const [algorithmState, setAlgorithmState] = useState<AlgorithmState>({});
  const [customAlgorithms, setCustomAlgorithms] = useState<CustomAlgorithm[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [reidTargets, setReidTargets] = useState<ReIDTarget[]>([]);
  const [faceIdTargets, setFaceIdTargets] = useState<FaceIdTarget[]>([]);
  const [intruderAreas, setIntruderAreas] = useState<IntruderArea[]>([]);
  const [showAddPerson, setShowAddPerson] = useState(false);
  const [showAddFace, setShowAddFace] = useState(false);
  const [showAddArea, setShowAddArea] = useState(false);
  const [showCustomEditor, setShowCustomEditor] = useState(false);
  const [customEditorAgent, setCustomEditorAgent] = useState<CameraCustomAgentRow | null>(null);
  const [newPersonName, setNewPersonName] = useState("");
  const [newPersonDescription, setNewPersonDescription] = useState("");
  const [newFaceName, setNewFaceName] = useState("");
  const [newFaceDescription, setNewFaceDescription] = useState("");
  const [newFaceImage, setNewFaceImage] = useState<File | null>(null);
  const [newFaceImagePreview, setNewFaceImagePreview] = useState<string | null>(null);
  const [newAreaName, setNewAreaName] = useState("");
  const [newAreaDescription, setNewAreaDescription] = useState("");
  const [editingFace, setEditingFace] = useState<{
    id: number;
    name: string;
    description: string;
    imageUrl: string | null;
    newImage: File | null;
    newImagePreview: string | null;
  } | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [publishingCustomAgent, setPublishingCustomAgent] = useState<CustomAlgorithm | null>(null);
  const [publishingToHub, setPublishingToHub] = useState(false);
  const customEditorTarget: CameraAgentEditorTarget | null =
    numericCameraId > 0
      ? {
          type: "camera",
          camera_id: numericCameraId,
        }
      : null;

  // Toast helper function
  const showToast = (title: string, description: string, variant: "default" | "destructive" = "default") => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, title, description, variant }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  };

  const dismissToast = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const openHubAgentBrowser = () => {
    navigate(
      `/hub?type=agent&installTarget=camera&cameraId=${cameraId}&returnTo=${encodeURIComponent(
        `/algorithms/${cameraId}`
      )}`
    );
  };

  const publishCustomAgentToHub = async (payload: {
    title: string;
    summary: string;
    description: string;
    tags: string[];
  }) => {
    if (!publishingCustomAgent) return;
    setPublishingToHub(true);
    try {
      const response = await fetch(
        `/api/hub/agents/publish-from-camera/${publishingCustomAgent.id}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to publish agent to Hub");
      }
      setPublishingCustomAgent(null);
      showToast("Hub publish complete", "The agent was uploaded to the Hub.");
    } catch (error: any) {
      showToast("Hub publish failed", String(error?.message || error), "destructive");
    } finally {
      setPublishingToHub(false);
    }
  };

  // Define all built-in algorithms with metadata
  const algorithmDefinitions = [
    { id: "weapon", name: "Weapon Detection", description: "Detect firearms, knives, and other weapons", type: "simple" },
    { id: "masked", name: "Masked Person Detection", description: "Detect people wearing masks or face coverings", type: "simple" },
    { id: "robbery", name: "Robbery Detection (Hands Raised)", description: "Detect potential robbery situations with raised hands", type: "simple" },
    { id: "fallen", name: "Person Fallen", description: "Detect people who have fallen or collapsed", type: "simple" },
    { id: "crowd", name: "Crowd Detection", description: "Detect unusual crowd formations or gatherings", type: "simple" },
    { id: "abandoned", name: "Abandoned Object/Bag", description: "Detect unattended bags or objects", type: "simple" },
    { id: "reid", name: "ReID (Person Identification)", description: "Identify specific people across camera feeds", type: "special" },
  ];

  useEffect(() => {
    if (cameraId) {
      fetchCamera();
      fetchAlgorithms();
      fetchCustomAlgorithms();
      fetchReIDTargets();
      fetchFaceIdTargets();
    }
  }, [cameraId]);

  const fetchCamera = async () => {
    try {
      await fetch(`/api/cameras/${cameraId}`);
    } catch (error) {
      console.error("Failed to fetch camera:", error);
    }
  };

  const fetchAlgorithms = async () => {
    try {
      const response = await fetch(`/api/cameras/${cameraId}/algorithms`);
      const data: Algorithm[] = await response.json();
      const state: AlgorithmState = {};

      data
        .filter((alg) => !alg.algorithm_type.startsWith("custom_"))
        .forEach((alg) => {
          state[alg.algorithm_type] = {
            is_enabled: alg.is_enabled === 1,
            llm_prompt: alg.llm_prompt || null,
            image_region: alg.image_region || null,
            config_json: alg.config_json ? JSON.parse(alg.config_json) : null,
          };
        });

      // Initialize state for built-in algorithms that don't exist yet
      algorithmDefinitions.forEach(alg => {
        if (!state[alg.id]) {
          state[alg.id] = {
            is_enabled: false,
            llm_prompt: null,
            image_region: null,
            config_json: null,
          };
        }
      });

      setAlgorithmState(state);

      // Extract intruder areas from config_json
      const intruderAlgo = data.find(d => d.algorithm_type === "intruder");
      if (intruderAlgo?.config_json) {
        try {
          const areas = JSON.parse(intruderAlgo.config_json);
          if (Array.isArray(areas)) {
            setIntruderAreas(areas);
          }
        } catch (e) {
          console.error("Failed to parse intruder areas:", e);
        }
      }
    } catch (error) {
      console.error("Failed to fetch algorithms:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchCustomAlgorithms = async () => {
    try {
      const response = await fetch(`/api/cameras/${cameraId}/custom-agents`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.message || data?.error || "Failed to fetch custom agents");
      }
      const agentsRaw = Array.isArray(data?.agents) ? data.agents : [];
      const customAlgos: CustomAlgorithm[] = agentsRaw
        .map((row: any) => {
          const id = Number(row?.id);
          if (!Number.isInteger(id) || id <= 0) return null;
          const config = row?.config_json && typeof row.config_json === "object" ? row.config_json : {};
          const displayName =
            typeof config?.display_name === "string" && config.display_name.trim()
              ? config.display_name.trim()
              : typeof row?.algorithm_type === "string"
              ? row.algorithm_type
              : `custom_${id}`;
          const negativeReferenceImages = Array.isArray(row?.negative_reference_images)
            ? row.negative_reference_images
                .map((img: any) => {
                  const imageId = Number(img?.id);
                  const imageUrl = typeof img?.image_url === "string" ? img.image_url.trim() : "";
                  if (!Number.isInteger(imageId) || imageId <= 0 || !imageUrl) return null;
                  return { id: imageId, image_url: imageUrl };
                })
                .filter(Boolean) as Array<{ id: number; image_url: string }>
            : [];
          return {
            id,
            algorithm_type: String(row?.algorithm_type || ""),
            display_name: displayName,
            is_enabled:
              typeof row?.is_enabled === "boolean"
                ? row.is_enabled
                : Number(row?.is_enabled || 0) !== 0,
            input_type:
              String(row?.input_type || "").trim().toLowerCase() === "image" ? "image" : "video",
            video_packaging_mode: (() => {
              const mode = String(row?.video_packaging_mode || "").trim().toLowerCase();
              return mode === "frame_sequence" ||
                mode === "frame-sequence" ||
                mode === "full_frame" ||
                mode === "full-frame" ||
                mode === "frames" ||
                mode === "high_resolution" ||
                mode === "high-resolution" ||
                mode === "high resolution"
                ? "frame_sequence"
                : mode === "mosaic_2x2" ||
                    mode === "mosaic-2x2" ||
                    mode === "2x2" ||
                    mode === "standard_resolution" ||
                    mode === "standard-resolution" ||
                    mode === "standard resolution"
                  ? "mosaic_2x2"
                  : "mosaic_3x3";
            })(),
            inference_model: (() => {
              const model = String(row?.inference_model || "").trim().toLowerCase();
              return model === "core" ||
                model === "legacy" ||
                model === "pro" ||
                model === "ultra" ||
                model === "ultra_plus" ||
                model === "light"
                ? model
                : "ultra";
            })(),
            model_fps: Number.isFinite(Number(row?.model_fps))
              ? Number(row.model_fps)
              : 1,
            run_every: Number.isFinite(Number(row?.run_every))
              ? Number(row.run_every)
              : 60,
            running_resolution:
              Number(row?.running_resolution) === 640 || Number(row?.running_resolution) === 1024
                ? Number(row.running_resolution)
                : null,
            prompt_template: String(row?.prompt_template || row?.llm_prompt || ""),
            alert_condition: String(row?.alert_condition || ""),
            negative_condition: String(row?.negative_condition || ""),
            only_capture_on_motion:
              typeof row?.only_capture_on_motion === "boolean"
                ? row.only_capture_on_motion
                : Number(row?.only_capture_on_motion || 0) !== 0,
            face_target_ids: Array.isArray(row?.face_target_ids)
              ? row.face_target_ids
                  .map((value: unknown) => Number(value))
                  .filter((value: number) => Number.isInteger(value) && value > 0)
              : [],
            negative_reference_images: negativeReferenceImages,
            analysis_regions: Array.isArray(row?.analysis_regions) ? row.analysis_regions : [],
          } as CustomAlgorithm;
        })
        .filter(Boolean) as CustomAlgorithm[];

      setCustomAlgorithms(customAlgos);
    } catch (error) {
      console.error("Failed to fetch custom algorithms:", error);
    }
  };

  const fetchReIDTargets = async () => {
    try {
      const response = await fetch(`/api/cameras/${cameraId}/reid-targets`);
      const data = await response.json();
      setReidTargets(data);
    } catch (error) {
      console.error("Failed to fetch ReID targets:", error);
    }
  };

  const fetchFaceIdTargets = async () => {
    try {
      const response = await fetch(`/api/cameras/${cameraId}/faceid-targets`);
      const data = await response.json();
      setFaceIdTargets(data);
    } catch (error) {
      console.error("Failed to fetch FaceID targets:", error);
    }
  };

  const handleFaceImageSelect = (file: File | null) => {
    setNewFaceImage(file);
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setNewFaceImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      setNewFaceImagePreview(null);
    }
  };

  const handleEditFaceImageSelect = (file: File | null) => {
    if (!editingFace) return;
    
    setEditingFace({
      ...editingFace,
      newImage: file,
    });

    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setEditingFace(prev => prev ? { ...prev, newImagePreview: reader.result as string } : null);
      };
      reader.readAsDataURL(file);
    } else {
      setEditingFace(prev => prev ? { ...prev, newImagePreview: null } : null);
    }
  };

  const openCreateCustomEditor = () => {
    setCustomEditorAgent(null);
    setShowCustomEditor(true);
  };

  const openEditCustomEditor = (custom: CustomAlgorithm) => {
    setCustomEditorAgent({
      id: custom.id,
      algorithm_type: custom.algorithm_type,
      is_enabled: custom.is_enabled,
      input_type: custom.input_type,
      video_packaging_mode: custom.video_packaging_mode,
      inference_model: custom.inference_model,
      model_fps: custom.model_fps,
      run_every: custom.run_every,
      running_resolution: custom.running_resolution,
      only_capture_on_motion: custom.only_capture_on_motion,
      prompt_template: custom.prompt_template,
      alert_condition: custom.alert_condition,
      negative_condition: custom.negative_condition,
      face_target_ids: custom.face_target_ids,
      negative_reference_images: custom.negative_reference_images,
      analysis_regions: custom.analysis_regions,
      config_json: { display_name: custom.display_name },
    });
    setShowCustomEditor(true);
  };

  useEffect(() => {
    const rawAgentId = searchParams.get("agentId");
    const shouldOpenAgent = searchParams.get("openAgent") === "1";
    const agentId = Number(rawAgentId || 0);

    if (!shouldOpenAgent || !Number.isInteger(agentId) || agentId <= 0) {
      return;
    }

    const deepLinkedAgent = customAlgorithms.find((candidate) => candidate.id === agentId);
    if (!deepLinkedAgent) {
      return;
    }

    openEditCustomEditor(deepLinkedAgent);

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("agentId");
    nextParams.delete("openAgent");
    setSearchParams(nextParams, { replace: true });
  }, [customAlgorithms, searchParams, setSearchParams]);

  const handleCustomEditorSaved = async (savedAgentId?: number | null) => {
    await fetchCustomAlgorithms();
    if (
      isOnboardingOpen &&
      isTutorialCamera &&
      onboardingStepId &&
      AGENT_TUTORIAL_COMPLETION_STEPS.has(onboardingStepId)
    ) {
      completeAgentTutorial(savedAgentId);
    }
  };

  const closeCustomEditor = () => {
    setShowCustomEditor(false);
    setCustomEditorAgent(null);
  };

  useEffect(() => {
    if (!isTutorialCamera || !isOnboardingOpen || !onboardingStepId) {
      if (tutorialManagedEditorRef.current && showCustomEditor) {
        setShowCustomEditor(false);
        setCustomEditorAgent(null);
      }
      tutorialManagedEditorRef.current = false;
      return;
    }

    if (onboardingStepId === "agent-intro" || onboardingStepId === "agent-create") {
      if (tutorialManagedEditorRef.current && showCustomEditor) {
        setShowCustomEditor(false);
        setCustomEditorAgent(null);
      }
      tutorialManagedEditorRef.current = false;
      return;
    }

    if (AGENT_EDITOR_ONBOARDING_STEPS.has(onboardingStepId)) {
      tutorialManagedEditorRef.current = true;
      if (!showCustomEditor) {
        setCustomEditorAgent(null);
        setShowCustomEditor(true);
      }
      return;
    }

    if (tutorialManagedEditorRef.current && showCustomEditor) {
      setShowCustomEditor(false);
      setCustomEditorAgent(null);
    }
    tutorialManagedEditorRef.current = false;
  }, [isOnboardingOpen, isTutorialCamera, onboardingStepId, showCustomEditor]);

  // Auto-save when toggling algorithm on/off
  const toggleAlgorithm = async (algorithmType: string) => {
    const currentState = algorithmState[algorithmType] || { is_enabled: false };
    const newEnabled = !currentState.is_enabled;
    
    // Optimistically update UI
    setAlgorithmState(prev => ({
      ...prev,
      [algorithmType]: {
        ...currentState,
        is_enabled: newEnabled,
      },
    }));

    try {
      // Build request body with only defined fields
      const requestBody: any = {
        camera_id: Number(cameraId),
        algorithm_type: algorithmType,
        is_enabled: newEnabled ? 1 : 0,
      };

      // Only include optional fields if they have values
      if (currentState.llm_prompt) {
        requestBody.llm_prompt = currentState.llm_prompt;
      }
      if (currentState.image_region) {
        requestBody.image_region = currentState.image_region;
      }
      if (currentState.config_json) {
        // config_json is already an object in state, stringify it for the API
        requestBody.config_json = typeof currentState.config_json === 'string' 
          ? currentState.config_json 
          : JSON.stringify(currentState.config_json);
      }

      const response = await fetch(`/api/cameras/${cameraId}/algorithms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("Toggle algorithm error - Status:", response.status, "Data:", errorData);
        
        if (isOpenAiKeyRequiredError(errorData)) {
          emitOpenAiKeyRequiredPrompt();
          setAlgorithmState(prev => ({
            ...prev,
            [algorithmType]: currentState,
          }));
          showToast("OpenAI API Key Required", "Add your OpenAI API key in Settings to enable AI agents.", "destructive");
          return;
        }

        // Handle token limit reached (403)
        if (response.status === 403 && errorData.error === "TOKEN_LIMIT_REACHED") {
          // Revert immediately for token limit
          setAlgorithmState(prev => ({
            ...prev,
            [algorithmType]: currentState,
          }));
          
          showToast("Token Limit Reached", errorData.message || "Your AI subscription token limit has been reached for this billing period.", "destructive");
          return;
        }
        
        throw new Error(`Failed to save algorithm: ${response.status}`);
      }

      // Backend automatically sends update_algorithms command if camera is running
    } catch (error) {
      console.error("Failed to toggle algorithm:", error);
      // Revert on error
      setAlgorithmState(prev => ({
        ...prev,
        [algorithmType]: currentState,
      }));
      
      showToast("Error", "Failed to save algorithm setting. Please try again.", "destructive");
    }
  };

  const toggleCustomAlgorithm = async (custom: CustomAlgorithm) => {
    const nextEnabled = !custom.is_enabled;
    setCustomAlgorithms((prev) =>
      prev.map((row) =>
        row.id === custom.id
          ? {
              ...row,
              is_enabled: nextEnabled,
            }
          : row
      )
    );

    try {
      const response = await fetch(`/api/cameras/${cameraId}/custom-agents/${custom.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_enabled: nextEnabled ? 1 : 0 }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (isOpenAiKeyRequiredError(data)) {
          emitOpenAiKeyRequiredPrompt();
          throw new Error("OpenAI API key is required in Settings.");
        }
        throw new Error(data?.message || data?.error || "Failed to update custom agent");
      }
      await fetchCustomAlgorithms();
    } catch (error) {
      console.error("Failed to toggle custom agent:", error);
      setCustomAlgorithms((prev) =>
        prev.map((row) =>
          row.id === custom.id
            ? {
                ...row,
                is_enabled: !nextEnabled,
              }
            : row
        )
      );
      showToast(
        "Error",
        error instanceof Error ? error.message : "Failed to update custom agent",
        "destructive"
      );
    }
  };

  const saveIntruderArea = async () => {
    if (!newAreaName.trim() || !newAreaDescription.trim()) return;

    try {
      const updatedAreas = [
        ...intruderAreas,
        { name: newAreaName, description: newAreaDescription }
      ];

      const currentState = algorithmState["intruder"] || { is_enabled: false };
      
      const requestBody: any = {
        camera_id: Number(cameraId),
        algorithm_type: "intruder",
        is_enabled: currentState.is_enabled ? 1 : 0,
        config_json: JSON.stringify(updatedAreas),
      };

      if (currentState.llm_prompt) {
        requestBody.llm_prompt = currentState.llm_prompt;
      }
      if (currentState.image_region) {
        requestBody.image_region = currentState.image_region;
      }

      const response = await fetch(`/api/cameras/${cameraId}/algorithms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error("Failed to save area");
      }

      setIntruderAreas(updatedAreas);
      setAlgorithmState(prev => ({
        ...prev,
        intruder: {
          ...currentState,
          config_json: updatedAreas,
        },
      }));

      setNewAreaName("");
      setNewAreaDescription("");
      setShowAddArea(false);
    } catch (error) {
      console.error("Failed to add intruder area:", error);
      showToast("Error", "Failed to add area. Please try again.", "destructive");
    }
  };

  const deleteIntruderArea = async (index: number) => {
    if (!confirm("Are you sure you want to delete this area?")) return;

    try {
      const updatedAreas = intruderAreas.filter((_, i) => i !== index);
      const currentState = algorithmState["intruder"] || { is_enabled: false };

      const requestBody: any = {
        camera_id: Number(cameraId),
        algorithm_type: "intruder",
        is_enabled: currentState.is_enabled ? 1 : 0,
        config_json: JSON.stringify(updatedAreas),
      };

      if (currentState.llm_prompt) {
        requestBody.llm_prompt = currentState.llm_prompt;
      }
      if (currentState.image_region) {
        requestBody.image_region = currentState.image_region;
      }

      const response = await fetch(`/api/cameras/${cameraId}/algorithms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error("Failed to delete area");
      }

      setIntruderAreas(updatedAreas);
      setAlgorithmState(prev => ({
        ...prev,
        intruder: {
          ...currentState,
          config_json: updatedAreas,
        },
      }));
    } catch (error) {
      console.error("Failed to delete intruder area:", error);
      showToast("Error", "Failed to delete area. Please try again.", "destructive");
    }
  };

  const addReIDTarget = async () => {
    if (!newPersonName.trim() || !newPersonDescription.trim()) return;

    try {
      await fetch(`/api/cameras/${cameraId}/reid-targets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          camera_id: Number(cameraId),
          person_name: newPersonName,
          person_description: newPersonDescription,
        }),
      });

      // Send command to EXE
      await fetch("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          camera_id: Number(cameraId),
          command_type: "add_reid_target",
          payload: JSON.stringify({
            person_name: newPersonName,
            person_description: newPersonDescription,
          }),
        }),
      });

      setNewPersonName("");
      setNewPersonDescription("");
      setShowAddPerson(false);
      fetchReIDTargets();
    } catch (error) {
      console.error("Failed to add ReID target:", error);
      showToast("Error", "Failed to add person. Please try again.", "destructive");
    }
  };

  const deleteReIDTarget = async (id: number) => {
    if (!confirm("Are you sure you want to delete this person?")) return;

    try {
      await fetch(`/api/cameras/${cameraId}/reid-targets/${id}`, {
        method: "DELETE",
      });

      // Send command to EXE
      await fetch("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          camera_id: Number(cameraId),
          command_type: "delete_reid_target",
          payload: JSON.stringify({ target_id: id }),
        }),
      });

      fetchReIDTargets();
    } catch (error) {
      console.error("Failed to delete ReID target:", error);
    }
  };

  const addFaceIdTarget = async () => {
    // Validation: name is required, and at least one of description or image
    if (!newFaceName.trim()) {
      showToast("Validation Error", "Please enter a face name", "destructive");
      return;
    }
    
    if (!newFaceDescription.trim() && !newFaceImage) {
      showToast("Validation Error", "Please provide either a face description or upload an image (or both)", "destructive");
      return;
    }

    try {
      const formData = new FormData();
      formData.append("person_name", newFaceName);
      formData.append("person_description", newFaceDescription.trim());
      if (newFaceImage) {
        formData.append("image", newFaceImage);
      }

      const response = await fetch(`/api/cameras/${cameraId}/faceid-targets`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Failed to add FaceID target");
      }

      const newTarget = await response.json();

      // Send command to EXE for FaceID
      await fetch("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          camera_id: Number(cameraId),
          command_type: "add_faceid_target",
          payload: JSON.stringify({
            person_name: newFaceName,
            person_description: newFaceDescription,
            image_url: newTarget.image_url || null,
          }),
        }),
      });

      setNewFaceName("");
      setNewFaceDescription("");
      setNewFaceImage(null);
      setNewFaceImagePreview(null);
      setShowAddFace(false);
      fetchFaceIdTargets();
    } catch (error) {
      console.error("Failed to add FaceID target:", error);
      showToast("Error", "Failed to add face. Please try again.", "destructive");
    }
  };

  const updateFaceIdTarget = async () => {
    if (!editingFace) return;
    
    // Validation: name is required, and at least one of description or image
    if (!editingFace.name.trim()) {
      showToast("Validation Error", "Please enter a face name", "destructive");
      return;
    }
    
    const hasDescription = editingFace.description.trim().length > 0;
    const hasImage = editingFace.imageUrl || editingFace.newImage;
    
    if (!hasDescription && !hasImage) {
      showToast("Validation Error", "Please provide either a face description or upload an image (or both)", "destructive");
      return;
    }

    try {
      const formData = new FormData();
      formData.append("person_name", editingFace.name);
      formData.append("person_description", editingFace.description);
      if (editingFace.newImage) {
        formData.append("image", editingFace.newImage);
      }

      const response = await fetch(`/api/cameras/${cameraId}/faceid-targets/${editingFace.id}`, {
        method: "PATCH",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Failed to update FaceID target");
      }

      const updatedTarget = await response.json();

      // Send command to EXE for FaceID update
      await fetch("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          camera_id: Number(cameraId),
          command_type: "update_faceid_target",
          payload: JSON.stringify({
            target_id: editingFace.id,
            person_name: editingFace.name,
            person_description: editingFace.description,
            image_url: updatedTarget.image_url || null,
          }),
        }),
      });

      setEditingFace(null);
      fetchFaceIdTargets();
    } catch (error) {
      console.error("Failed to update FaceID target:", error);
      showToast("Error", "Failed to update face. Please try again.", "destructive");
    }
  };

  const deleteFaceIdTarget = async (id: number) => {
    if (!confirm("Are you sure you want to delete this face?")) return;

    try {
      await fetch(`/api/cameras/${cameraId}/faceid-targets/${id}`, {
        method: "DELETE",
      });

      // Send command to EXE for FaceID
      await fetch("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          camera_id: Number(cameraId),
          command_type: "delete_faceid_target",
          payload: JSON.stringify({ target_id: id }),
        }),
      });

      fetchFaceIdTargets();
    } catch (error) {
      console.error("Failed to delete FaceID target:", error);
    }
  };

  const deleteCustomAlgorithm = async (custom: CustomAlgorithm) => {
    if (!confirm("Are you sure you want to delete this custom AI agent?")) return;

    try {
      const response = await fetch(`/api/cameras/${cameraId}/custom-agents/${custom.id}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.message || data?.error || "Failed to delete custom algorithm");
      }

      setCustomAlgorithms(prev => prev.filter(ca => ca.id !== custom.id));
    } catch (error) {
      console.error("Failed to delete custom algorithm:", error);
      showToast(
        "Error",
        error instanceof Error ? error.message : "Failed to delete custom AI agent. Please try again.",
        "destructive"
      );
    }
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-gray-400">Loading...</div>
        </div>
      </Layout>
    );
  }

  // Separate simple algorithms from special ones
  const simpleAlgorithms = algorithmDefinitions.filter(a => a.type === "simple");
  const faceIdAlgorithm = algorithmDefinitions.find(a => a.id === "faceid");
  const intruderAlgorithm = algorithmDefinitions.find(a => a.id === "intruder");
  const reidAlgorithm = algorithmDefinitions.find(a => a.id === "reid");

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        {/* Toast notifications */}
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-3 max-w-md pointer-events-none">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`${
                toast.variant === "destructive"
                  ? "bg-gradient-to-br from-red-900/95 to-red-950/95 border-red-700/50"
                  : "bg-gradient-to-br from-gray-800/95 to-gray-900/95 border-gray-700/50"
              } backdrop-blur-xl border rounded-xl shadow-2xl p-4 pointer-events-auto animate-slide-in`}
            >
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 ${
                  toast.variant === "destructive" ? "bg-red-500/20" : "bg-blue-500/20"
                } rounded-lg flex items-center justify-center flex-shrink-0`}>
                  <AlertCircle className={`w-5 h-5 ${
                    toast.variant === "destructive" ? "text-red-400" : "text-blue-400"
                  }`} />
                </div>
                
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold text-gray-100 mb-1">
                    {toast.title}
                  </h4>
                  <p className="text-sm text-gray-300">
                    {toast.description}
                  </p>
                </div>

                <button
                  onClick={() => dismissToast(toast.id)}
                  className={`p-1.5 text-gray-400 hover:text-gray-200 ${
                    toast.variant === "destructive" ? "hover:bg-red-800/30" : "hover:bg-gray-800/30"
                  } rounded-lg transition-colors flex-shrink-0`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Header */}
        <div className="mb-6 md:mb-8">
          <button
            onClick={() => navigate("/ai-agents")}
            className="flex items-center gap-2 text-gray-400 hover:text-gray-200 mb-4 transition-colors min-h-[44px] md:min-h-0"
          >
            <ArrowLeft className="w-4 h-4" />
            {t("algorithms.backToDashboard")}
          </button>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 md:w-12 h-10 md:h-12 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center flex-shrink-0">
              <Cpu className="w-5 md:w-6 h-5 md:h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-gray-100">
                {t("algorithms.title")}
              </h1>
              <p className="text-sm md:text-base text-gray-400">Camera #{cameraId}</p>
            </div>
          </div>
        </div>

        {/* Info banner */}
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 mb-6">
          <p className="text-sm text-blue-300">
            Toggle algorithms on or off. Changes are saved automatically. Enabled algorithms will analyze camera frames.
          </p>
        </div>

        {/* Create Custom AI Agent button */}
        <div className="mb-6 grid gap-3 md:grid-cols-2">
          <button
            onClick={openCreateCustomEditor}
            data-onboarding-target={ONBOARDING_TARGETS.algorithmsCreateCustom}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-purple-500/20 to-pink-500/20 hover:from-purple-500/30 hover:to-pink-500/30 border border-purple-500/30 text-purple-300 rounded-xl font-medium transition-all shadow-lg shadow-purple-500/10"
          >
            <Plus className="w-5 h-5" />
            Create Custom AI Agent
          </button>
          <button
            onClick={openHubAgentBrowser}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-orange-500/30 bg-orange-500/10 text-orange-200 font-medium transition-all hover:bg-orange-500/15"
          >
            <Sparkles className="w-5 h-5" />
            Browse Hub Agents
          </button>
        </div>

        {/* Edit Face Modal */}
        {editingFace && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl shadow-2xl">
              <div className="flex items-center justify-between p-6 border-b border-gray-800">
                <h2 className="text-xl font-bold text-gray-100">Edit Face</h2>
                <button
                  onClick={() => setEditingFace(null)}
                  className="p-2 text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Face Name *
                  </label>
                  <input
                    type="text"
                    value={editingFace.name}
                    onChange={(e) => setEditingFace({ ...editingFace, name: e.target.value })}
                    className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    placeholder="e.g., John Smith"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Face Description (LLM Prompt)
                  </label>
                  <textarea
                    rows={3}
                    value={editingFace.description}
                    onChange={(e) => setEditingFace({ ...editingFace, description: e.target.value })}
                    className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all resize-none"
                    placeholder="Describe the person's facial features in detail..."
                  />
                  <p className="text-xs text-gray-500 mt-1">At least one of description or image is required</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Face Image
                  </label>
                  <div className="flex items-start gap-4">
                    {(editingFace.newImagePreview || editingFace.imageUrl) && (
                      <div className="w-24 h-24 rounded-lg overflow-hidden bg-gray-800 flex-shrink-0">
                        <img
                          src={editingFace.newImagePreview || editingFace.imageUrl || ""}
                          alt="Face preview"
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                    <label className="flex-1 cursor-pointer">
                      <div className="border-2 border-dashed border-gray-700 rounded-lg p-4 hover:border-blue-500 transition-colors">
                        <div className="flex flex-col items-center gap-2">
                          <Upload className="w-8 h-8 text-gray-400" />
                          <p className="text-sm text-gray-400 text-center">
                            Click to {editingFace.imageUrl || editingFace.newImagePreview ? "change" : "upload"} image
                          </p>
                          <p className="text-xs text-gray-500">JPG, PNG up to 10MB</p>
                        </div>
                      </div>
                      <input
                        type="file"
                        accept="image/jpeg,image/png"
                        className="hidden"
                        onChange={(e) => handleEditFaceImageSelect(e.target.files?.[0] || null)}
                      />
                    </label>
                  </div>
                  {editingFace.newImagePreview && (
                    <button
                      onClick={() => handleEditFaceImageSelect(null)}
                      className="mt-2 text-sm text-red-400 hover:text-red-300"
                    >
                      Remove new image
                    </button>
                  )}
                </div>

                <div className="flex flex-col md:flex-row items-center justify-end gap-3 pt-4">
                  <button
                    onClick={() => setEditingFace(null)}
                    className="w-full md:w-auto px-5 py-3 md:py-2.5 text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded-lg font-medium transition-colors min-h-[44px] md:min-h-0"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={updateFaceIdTarget}
                    className="w-full md:w-auto px-5 py-3 md:py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors shadow-lg shadow-blue-500/30 min-h-[44px] md:min-h-0"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Custom Analytics cards */}
        {customAlgorithms.length > 0 && (
          <div className="space-y-3 mb-6 md:mb-8">
            {customAlgorithms.map((custom) => {
              const isEnabled = !!custom.is_enabled;
              const isTutorialAgentToggleTarget =
                isOnboardingOpen &&
                onboardingStepId === "agent-toggle" &&
                typeof tutorialAgentId === "number" &&
                tutorialAgentId > 0 &&
                tutorialAgentId === custom.id;
              const regionCount = Array.isArray(custom.analysis_regions)
                ? custom.analysis_regions.filter((region: any) => !region?.full_frame).length
                : 0;
              const faceCount = Array.isArray(custom.face_target_ids) ? custom.face_target_ids.length : 0;
              const negativeCount = Array.isArray(custom.negative_reference_images)
                ? custom.negative_reference_images.length
                : 0;
              return (
                <div
                  key={custom.id}
                  className="bg-gradient-to-br from-purple-900/20 to-pink-900/20 backdrop-blur-sm border border-purple-800/30 rounded-xl p-4 hover:border-purple-700/50 transition-all"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1 flex-wrap">
                        <h3 className="text-base md:text-lg font-semibold text-gray-100">
                          {custom.display_name}
                        </h3>
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-500/20 text-purple-300">
                          Custom
                        </span>
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            isEnabled
                              ? "bg-green-500/10 text-green-400"
                              : "bg-gray-700/50 text-gray-500"
                          }`}
                        >
                          {isEnabled ? "Enabled" : "Disabled"}
                        </span>
                      </div>
                      <p className="text-sm text-gray-400 line-clamp-2">
                        {custom.prompt_template || "Custom analytics using LLM prompt"}
                      </p>
                      <p className="text-xs text-gray-500 mt-2">
                        {regionCount > 0 ? `${regionCount} polygon region(s)` : "Full frame"} • {faceCount} face
                        target(s) • {negativeCount} negative image(s)
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setPublishingCustomAgent(custom)}
                        className="p-2 text-orange-300 hover:bg-orange-500/10 rounded-lg transition-colors"
                        title="Publish to Hub"
                      >
                        <Sparkles className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => openEditCustomEditor(custom)}
                        className="p-2 text-purple-400 hover:bg-purple-500/10 rounded-lg transition-colors"
                        title="Edit agent"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => void deleteCustomAlgorithm(custom)}
                        className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                        title="Delete custom agent"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => void toggleCustomAlgorithm(custom)}
                        data-onboarding-target={
                          isTutorialAgentToggleTarget
                            ? ONBOARDING_TARGETS.algorithmsCustomAgentToggle
                            : undefined
                        }
                        className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors flex-shrink-0 ${
                          isEnabled ? "bg-purple-500" : "bg-gray-700"
                        }`}
                      >
                        <span
                          className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                            isEnabled ? "translate-x-7" : "translate-x-1"
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* FaceID Section - Expanded card */}
        {faceIdAlgorithm && (
          <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800/50 rounded-xl p-4 md:p-6 mb-6 md:mb-8">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="text-lg font-semibold text-gray-100">
                    {faceIdAlgorithm.name}
                  </h3>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      algorithmState[faceIdAlgorithm.id]?.is_enabled
                        ? "bg-green-500/10 text-green-400"
                        : "bg-gray-700/50 text-gray-500"
                    }`}
                  >
                    {algorithmState[faceIdAlgorithm.id]?.is_enabled ? "Enabled" : "Disabled"}
                  </span>
                </div>
                <p className="text-sm text-gray-400">
                  {faceIdAlgorithm.description}
                </p>
              </div>
              
              <button
                onClick={() => toggleAlgorithm(faceIdAlgorithm.id)}
                className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ml-4 flex-shrink-0 ${
                  algorithmState[faceIdAlgorithm.id]?.is_enabled ? "bg-blue-500" : "bg-gray-700"
                }`}
              >
                <span
                  className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                    algorithmState[faceIdAlgorithm.id]?.is_enabled ? "translate-x-7" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {/* Face list */}
            <div className="space-y-3 mb-4">
              <label className="block text-sm font-medium text-gray-300">
                Registered Faces
              </label>
              
              {faceIdTargets.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">
                  No faces registered yet
                </div>
              ) : (
                <div className="space-y-2">
                  {faceIdTargets.map((target) => (
                    <div
                      key={target.id}
                      className="bg-gray-800 rounded-lg p-4 flex items-start gap-4"
                    >
                      {target.image_url && (
                        <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-700 flex-shrink-0">
                          <img
                            src={target.image_url}
                            alt={target.person_name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}
                      <div className="flex-1">
                        <h4 className="font-semibold text-gray-100 mb-1">
                          {target.person_name}
                        </h4>
                        <p className="text-sm text-gray-400">
                          {target.person_description}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setEditingFace({
                            id: target.id,
                            name: target.person_name,
                            description: target.person_description,
                            imageUrl: target.image_url || null,
                            newImage: null,
                            newImagePreview: null,
                          })}
                          className="p-2 text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                          title="Edit face"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => deleteFaceIdTarget(target.id)}
                          className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Add face form */}
            {showAddFace ? (
              <div className="bg-gray-800 rounded-lg p-4 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Face Name *
                  </label>
                  <input
                    type="text"
                    value={newFaceName}
                    onChange={(e) => setNewFaceName(e.target.value)}
                    className="w-full px-4 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    placeholder="e.g., John Smith"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Face Description (LLM Prompt)
                  </label>
                  <textarea
                    rows={3}
                    value={newFaceDescription}
                    onChange={(e) => setNewFaceDescription(e.target.value)}
                    className="w-full px-4 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all resize-none"
                    placeholder="Describe the person's facial features in detail..."
                  />
                  <p className="text-xs text-gray-500 mt-1">At least one of description or image is required</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Face Image
                  </label>
                  <div className="flex items-start gap-4">
                    {newFaceImagePreview && (
                      <div className="w-24 h-24 rounded-lg overflow-hidden bg-gray-700 flex-shrink-0">
                        <img
                          src={newFaceImagePreview}
                          alt="Preview"
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                    <label className="flex-1 cursor-pointer">
                      <div className="border-2 border-dashed border-gray-600 rounded-lg p-4 hover:border-blue-500 transition-colors">
                        <div className="flex flex-col items-center gap-2">
                          <Upload className="w-8 h-8 text-gray-400" />
                          <p className="text-sm text-gray-400 text-center">
                            Click to upload image
                          </p>
                          <p className="text-xs text-gray-500">JPG, PNG up to 10MB</p>
                        </div>
                      </div>
                      <input
                        type="file"
                        accept="image/jpeg,image/png"
                        className="hidden"
                        onChange={(e) => handleFaceImageSelect(e.target.files?.[0] || null)}
                      />
                    </label>
                  </div>
                  {newFaceImagePreview && (
                    <button
                      onClick={() => handleFaceImageSelect(null)}
                      className="mt-2 text-sm text-red-400 hover:text-red-300"
                    >
                      Remove image
                    </button>
                  )}
                </div>
                <div className="flex flex-col md:flex-row gap-2">
                  <button
                    onClick={addFaceIdTarget}
                    className="w-full md:w-auto px-4 py-3 md:py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors min-h-[44px] md:min-h-0"
                  >
                    Add Face
                  </button>
                  <button
                    onClick={() => {
                      setShowAddFace(false);
                      setNewFaceName("");
                      setNewFaceDescription("");
                      setNewFaceImage(null);
                      setNewFaceImagePreview(null);
                    }}
                    className="w-full md:w-auto px-4 py-3 md:py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg font-medium transition-colors min-h-[44px] md:min-h-0"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowAddFace(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg font-medium transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Face
              </button>
            )}
          </div>
        )}

        {/* Simple Algorithm cards - just toggle */}
        <div className="space-y-3 mb-6 md:mb-8">
          {simpleAlgorithms.map((algorithm) => {
            const state = algorithmState[algorithm.id] || { is_enabled: false };
            return (
              <div
                key={algorithm.id}
                className="bg-gray-900/50 backdrop-blur-sm border border-gray-800/50 rounded-xl p-4 hover:border-gray-700/50 transition-all"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                      <h3 className="text-base md:text-lg font-semibold text-gray-100">
                        {algorithm.name}
                      </h3>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          state.is_enabled
                            ? "bg-green-500/10 text-green-400"
                            : "bg-gray-700/50 text-gray-500"
                        }`}
                      >
                        {state.is_enabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                    <p className="text-sm text-gray-400">{algorithm.description}</p>
                  </div>

                  <button
                    onClick={() => toggleAlgorithm(algorithm.id)}
                    className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors flex-shrink-0 ${
                      state.is_enabled ? "bg-blue-500" : "bg-gray-700"
                    }`}
                  >
                    <span
                      className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                        state.is_enabled ? "translate-x-7" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Intruder Detection - Expanded card */}
        {intruderAlgorithm && (
          <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800/50 rounded-xl p-4 md:p-6 mb-6 md:mb-8">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="text-lg font-semibold text-gray-100">
                    {intruderAlgorithm.name}
                  </h3>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      algorithmState[intruderAlgorithm.id]?.is_enabled
                        ? "bg-green-500/10 text-green-400"
                        : "bg-gray-700/50 text-gray-500"
                    }`}
                  >
                    {algorithmState[intruderAlgorithm.id]?.is_enabled ? "Enabled" : "Disabled"}
                  </span>
                </div>
                <p className="text-sm text-gray-400">
                  {intruderAlgorithm.description}
                </p>
              </div>
              
              <button
                onClick={() => toggleAlgorithm(intruderAlgorithm.id)}
                className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ml-4 flex-shrink-0 ${
                  algorithmState[intruderAlgorithm.id]?.is_enabled ? "bg-blue-500" : "bg-gray-700"
                }`}
              >
                <span
                  className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                    algorithmState[intruderAlgorithm.id]?.is_enabled ? "translate-x-7" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {/* Areas section */}
            <div className="space-y-3 mb-4">
              <label className="block text-sm font-medium text-gray-300">
                Monitored Areas
              </label>
              
              {intruderAreas.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">
                  No areas defined yet
                </div>
              ) : (
                <div className="space-y-2">
                  {intruderAreas.map((area, index) => (
                    <div
                      key={index}
                      className="bg-gray-800 rounded-lg p-4 flex items-start justify-between"
                    >
                      <div className="flex-1">
                        <h4 className="font-semibold text-gray-100 mb-1">
                          {area.name}
                        </h4>
                        <p className="text-sm text-gray-400">
                          {area.description}
                        </p>
                      </div>
                      <button
                        onClick={() => deleteIntruderArea(index)}
                        className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Add area form */}
            {showAddArea ? (
              <div className="bg-gray-800 rounded-lg p-4 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Area Name
                  </label>
                  <input
                    type="text"
                    value={newAreaName}
                    onChange={(e) => setNewAreaName(e.target.value)}
                    className="w-full px-4 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    placeholder="e.g., Main Entrance"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Area Description (LLM Prompt)
                  </label>
                  <textarea
                    rows={3}
                    value={newAreaDescription}
                    onChange={(e) => setNewAreaDescription(e.target.value)}
                    className="w-full px-4 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all resize-none"
                    placeholder="Describe the restricted area and detection criteria..."
                  />
                </div>
                <div className="flex flex-col md:flex-row gap-2">
                  <button
                    onClick={saveIntruderArea}
                    className="w-full md:w-auto px-4 py-3 md:py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors min-h-[44px] md:min-h-0"
                  >
                    Add Area
                  </button>
                  <button
                    onClick={() => {
                      setShowAddArea(false);
                      setNewAreaName("");
                      setNewAreaDescription("");
                    }}
                    className="w-full md:w-auto px-4 py-3 md:py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg font-medium transition-colors min-h-[44px] md:min-h-0"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowAddArea(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg font-medium transition-colors"
              >
                <MapPin className="w-4 h-4" />
                Delimit Area
              </button>
            )}
          </div>
        )}

        {/* ReID Section - Expanded card */}
        {reidAlgorithm && (
          <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800/50 rounded-xl p-4 md:p-6 mb-6 md:mb-8">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="text-lg font-semibold text-gray-100">
                    {reidAlgorithm.name}
                  </h3>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      algorithmState[reidAlgorithm.id]?.is_enabled
                        ? "bg-green-500/10 text-green-400"
                        : "bg-gray-700/50 text-gray-500"
                    }`}
                  >
                    {algorithmState[reidAlgorithm.id]?.is_enabled ? "Enabled" : "Disabled"}
                  </span>
                </div>
                <p className="text-sm text-gray-400">
                  {reidAlgorithm.description}
                </p>
              </div>
              
              <button
                onClick={() => toggleAlgorithm(reidAlgorithm.id)}
                className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ml-4 flex-shrink-0 ${
                  algorithmState[reidAlgorithm.id]?.is_enabled ? "bg-blue-500" : "bg-gray-700"
                }`}
              >
                <span
                  className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                    algorithmState[reidAlgorithm.id]?.is_enabled ? "translate-x-7" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {/* Target list */}
            <div className="space-y-3 mb-4">
              <label className="block text-sm font-medium text-gray-300">
                {t("algorithms.targets")}
              </label>
              
              {reidTargets.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">
                  {t("algorithms.noTargets")}
                </div>
              ) : (
                <div className="space-y-2">
                  {reidTargets.map((target) => (
                    <div
                      key={target.id}
                      className="bg-gray-800 rounded-lg p-4 flex items-start justify-between"
                    >
                      <div className="flex-1">
                        <h4 className="font-semibold text-gray-100 mb-1">
                          {target.person_name}
                        </h4>
                        <p className="text-sm text-gray-400">
                          {target.person_description}
                        </p>
                      </div>
                      <button
                        onClick={() => deleteReIDTarget(target.id)}
                        className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Add person form */}
            {showAddPerson ? (
              <div className="bg-gray-800 rounded-lg p-4 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Person Name
                  </label>
                  <input
                    type="text"
                    value={newPersonName}
                    onChange={(e) => setNewPersonName(e.target.value)}
                    className="w-full px-4 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    placeholder="e.g., John - Blue Jacket"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Person Description (LLM Prompt)
                  </label>
                  <textarea
                    rows={3}
                    value={newPersonDescription}
                    onChange={(e) => setNewPersonDescription(e.target.value)}
                    className="w-full px-4 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all resize-none"
                    placeholder="Describe the person's appearance in detail..."
                  />
                </div>
                <div className="flex flex-col md:flex-row gap-2">
                  <button
                    onClick={addReIDTarget}
                    className="w-full md:w-auto px-4 py-3 md:py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors min-h-[44px] md:min-h-0"
                  >
                    Add Person
                  </button>
                  <button
                    onClick={() => {
                      setShowAddPerson(false);
                      setNewPersonName("");
                      setNewPersonDescription("");
                    }}
                    className="w-full md:w-auto px-4 py-3 md:py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg font-medium transition-colors min-h-[44px] md:min-h-0"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowAddPerson(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg font-medium transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Person
              </button>
            )}
          </div>
        )}

        <CameraCustomAgentEditorModal
          open={showCustomEditor}
          editorTarget={customEditorTarget}
          initialAgent={customEditorAgent}
          onClose={closeCustomEditor}
          onSaved={handleCustomEditorSaved}
          showToast={showToast}
        />

        <HubPublishModal
          isOpen={!!publishingCustomAgent}
          title="Publish Agent to Hub"
          itemLabel="agent"
          defaultTitle={publishingCustomAgent?.display_name || "Custom Agent"}
          defaultSummary={
            publishingCustomAgent?.alert_condition ||
            publishingCustomAgent?.prompt_template ||
            "Reusable custom agent"
          }
          defaultDescription={publishingCustomAgent?.prompt_template || ""}
          submitting={publishingToHub}
          onClose={() => {
            if (publishingToHub) return;
            setPublishingCustomAgent(null);
          }}
          onSubmit={publishCustomAgentToHub}
        />

        {/* Back to AI Agents button */}
        <div className="flex justify-end">
          <button
            onClick={() => navigate("/ai-agents")}
            className="w-full md:w-auto px-6 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg font-medium transition-colors min-h-[44px]"
          >
            {t("algorithms.backToDashboard")}
          </button>
        </div>
      </div>
    </Layout>
  );
}
