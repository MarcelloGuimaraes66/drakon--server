import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Eye, EyeOff, X } from "lucide-react";

const CAMERA_LABEL_OPTIONS = [
  { value: "kitchen", label: "Kitchen" },
  { value: "living_room", label: "Living Room" },
  { value: "bedroom", label: "Bedroom" },
  { value: "childrens_room", label: "Children's Room" },
  { value: "office_room", label: "Office Room" },
  { value: "corridor", label: "Corridor" },
  { value: "elevator", label: "Elevator" },
  { value: "classroom", label: "Classroom" },
  { value: "parking_lot", label: "Parking Lot" },
  { value: "garage", label: "Garage" },
  { value: "street", label: "Street" },
  { value: "intersection", label: "Intersection" },
  { value: "park", label: "Park" },
  { value: "yard", label: "Yard" },
  { value: "frontyard", label: "Frontyard" },
  { value: "backyard", label: "Backyard" },
  { value: "store", label: "Store" },
  { value: "supermarket", label: "Supermarket" },
  { value: "warehouse", label: "Warehouse" },
  { value: "staircase", label: "Staircase" },
  { value: "lobby", label: "Lobby" },
  { value: "reception", label: "Reception" },
  { value: "restaurant", label: "Restaurant" },
  { value: "bar", label: "Bar" },
  { value: "cafe", label: "Cafe" },
  { value: "gym", label: "Gym" },
  { value: "front_door", label: "Front Door" },
  { value: "back_door", label: "Back Door" },
  { value: "other_indoor", label: "Other Indoor" },
  { value: "other_outdoor", label: "Other Outdoor" },
] as const;

type RetentionDays = 1 | 3 | 7 | 15 | 30 | 90 | 180;
type CameraConnectionTab = "WEBCAM" | "IP_RTSP";
type CameraConnectionMethod = "WEBCAM" | "RTSP" | "HTTP" | "ONVIF";

type BaseFormData = {
  name: string;
  street: string;
  number: string;
  city: string;
  state: string;
  zip_code: string;
  country: string;
  retention_days: RetentionDays;
  allowpublicaccess: boolean;
};

type WebcamFormData = BaseFormData & {
  webcam_index: number | null;
};

type RtspFormData = BaseFormData & {
  ip_address: string;
  rtsp_port: string;
  manufacturer: string;
  username: string;
  password: string;
  channel: string;
  subtype: string;
  connection_method: Exclude<CameraConnectionMethod, "WEBCAM">;
};

type EditFormData = BaseFormData & {
  ip_address: string;
  rtsp_port: string;
  manufacturer: string;
  username: string;
  password: string;
  channel: string;
  subtype: string;
  connection_method: CameraConnectionMethod;
  webcam_index: number | null;
};

export type CameraEditorCamera = {
  id: number;
  name: string;
  ip_address?: string | null;
  rtsp_port?: string | null;
  manufacturer?: string | null;
  username?: string | null;
  password?: string | null;
  channel?: string | null;
  subtype?: string | null;
  connection_method?: string | null;
  description?: string | null;
  street?: string | null;
  number?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  country?: string | null;
  retention_days?: number | null;
  webcam_index?: number | null;
  allowpublicaccess?: number | boolean | null;
};

export type CameraEditorDraft = Partial<Omit<CameraEditorCamera, "id">>;

type CameraEditorModalProps = {
  isOpen: boolean;
  camera: CameraEditorCamera | null;
  draftCamera?: CameraEditorDraft | null;
  onClose: () => void;
  onSaved?: () => Promise<void> | void;
};

const VALID_RETENTION_DAYS: RetentionDays[] = [1, 3, 7, 15, 30, 90, 180];

function createEmptyWebcamForm(): WebcamFormData {
  return {
    name: "",
    webcam_index: null,
    street: "",
    number: "",
    city: "",
    state: "",
    zip_code: "",
    country: "",
    retention_days: 1,
    allowpublicaccess: false,
  };
}

function createEmptyRtspForm(): RtspFormData {
  return {
    name: "",
    ip_address: "",
    rtsp_port: "",
    manufacturer: "",
    username: "",
    password: "",
    channel: "",
    subtype: "",
    connection_method: "RTSP",
    street: "",
    number: "",
    city: "",
    state: "",
    zip_code: "",
    country: "",
    retention_days: 1,
    allowpublicaccess: false,
  };
}

function normalizeManufacturerValue(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase();
}

function isSubtypeLockedForManufacturer(value: unknown): boolean {
  return normalizeManufacturerValue(value) === "hikvision";
}

function normalizeOptionalField(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeRetentionDays(value: number | null | undefined): RetentionDays {
  if (value && VALID_RETENTION_DAYS.includes(value as RetentionDays)) {
    return value as RetentionDays;
  }
  return 1;
}

function parseDescription(description: string | null | undefined) {
  let label = "other_indoor";
  let text = "";

  if (!description) {
    return { label, text };
  }

  const labelMatch = description.match(/LABEL:\s*(.+?)\s*DESCRIPTION:/);
  const descMatch = description.match(/DESCRIPTION:\s*(.+)$/s);

  if (labelMatch && descMatch) {
    const extractedLabel = labelMatch[1].trim();
    text = descMatch[1].trim();
    const allowedValues = CAMERA_LABEL_OPTIONS.map((option) => option.value);
    if (allowedValues.includes(extractedLabel as (typeof CAMERA_LABEL_OPTIONS)[number]["value"])) {
      label = extractedLabel;
    }
  } else {
    text = description;
  }

  return { label, text };
}

function buildEditForm(camera: CameraEditorCamera): EditFormData {
  return {
    name: camera.name,
    ip_address: camera.ip_address || "",
    rtsp_port: camera.rtsp_port || "",
    manufacturer: camera.manufacturer || "",
    username: camera.username || "",
    password: camera.password || "",
    channel: camera.channel || "",
    subtype: camera.subtype || "",
    connection_method:
      camera.connection_method === "WEBCAM" ||
      camera.connection_method === "HTTP" ||
      camera.connection_method === "ONVIF"
        ? camera.connection_method
        : "RTSP",
    retention_days: normalizeRetentionDays(camera.retention_days),
    street: camera.street || "",
    number: camera.number || "",
    city: camera.city || "",
    state: camera.state || "",
    zip_code: camera.zip_code || "",
    country: camera.country || "",
    webcam_index: camera.webcam_index ?? null,
    allowpublicaccess: Boolean(camera.allowpublicaccess),
  };
}

function buildDraftWebcamForm(camera: CameraEditorDraft): WebcamFormData {
  return {
    ...createEmptyWebcamForm(),
    name: camera.name || "",
    webcam_index:
      typeof camera.webcam_index === "number" ? camera.webcam_index : null,
    street: camera.street || "",
    number: camera.number || "",
    city: camera.city || "",
    state: camera.state || "",
    zip_code: camera.zip_code || "",
    country: camera.country || "",
    retention_days: normalizeRetentionDays(camera.retention_days),
    allowpublicaccess: Boolean(camera.allowpublicaccess),
  };
}

function buildDraftRtspForm(camera: CameraEditorDraft): RtspFormData {
  return {
    ...createEmptyRtspForm(),
    name: camera.name || "",
    ip_address: camera.ip_address || "",
    rtsp_port: camera.rtsp_port || "",
    manufacturer: camera.manufacturer || "",
    username: camera.username || "",
    password: camera.password || "",
    channel: camera.channel || "",
    subtype: camera.subtype || "",
    connection_method:
      camera.connection_method === "HTTP" || camera.connection_method === "ONVIF"
        ? camera.connection_method
        : "RTSP",
    street: camera.street || "",
    number: camera.number || "",
    city: camera.city || "",
    state: camera.state || "",
    zip_code: camera.zip_code || "",
    country: camera.country || "",
    retention_days: normalizeRetentionDays(camera.retention_days),
    allowpublicaccess: Boolean(camera.allowpublicaccess),
  };
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (
    error &&
    typeof error === "object" &&
    "error" in error &&
    typeof (error as { error?: unknown }).error === "string"
  ) {
    return (error as { error: string }).error;
  }
  return fallback;
}

async function parseApiError(response: Response, fallback: string): Promise<string> {
  const responseText = await response.text();

  try {
    const errorData = JSON.parse(responseText);

    if (typeof errorData.error === "string") {
      return errorData.error;
    }

    if (errorData.error && typeof errorData.error === "object" && Array.isArray(errorData.error.issues)) {
      return `Validation error: ${errorData.error.issues
        .map((issue: { path?: string[]; message: string }) => {
          const fieldPath = Array.isArray(issue.path) ? issue.path.join(".") : "field";
          return `${fieldPath}: ${issue.message}`;
        })
        .join(", ")}`;
    }

    if (typeof errorData.message === "string") {
      return errorData.message;
    }

    if (Array.isArray(errorData.details)) {
      return `Validation error: ${errorData.details
        .map((issue: { path?: string[]; message: string }) => {
          const fieldPath = Array.isArray(issue.path) ? issue.path.join(".") : "field";
          return `${fieldPath}: ${issue.message}`;
        })
        .join(", ")}`;
    }
  } catch {
    if (responseText.trim().length > 0) {
      return `Server error (${response.status}): ${responseText}`;
    }
  }

  return fallback;
}

export default function CameraEditorModal({
  isOpen,
  camera,
  draftCamera = null,
  onClose,
  onSaved,
}: CameraEditorModalProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<CameraConnectionTab>("IP_RTSP");
  const [webcamForm, setWebcamForm] = useState<WebcamFormData>(createEmptyWebcamForm);
  const [rtspForm, setRtspForm] = useState<RtspFormData>(createEmptyRtspForm);
  const [editForm, setEditForm] = useState<EditFormData | null>(null);
  const [descriptionLabel, setDescriptionLabel] = useState("other_indoor");
  const [descriptionText, setDescriptionText] = useState("");
  const [isAddressExpanded, setIsAddressExpanded] = useState(false);
  const [addressErrors, setAddressErrors] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showPublicAccessModal, setShowPublicAccessModal] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setSubmitError(null);
    setAddressErrors({});
    setIsAddressExpanded(false);
    setIsSubmitting(false);
    setShowPublicAccessModal(false);
    setShowPassword(false);

    if (camera) {
      const isWebcam = camera.connection_method === "WEBCAM" || camera.webcam_index != null;
      const { label, text } = parseDescription(camera.description);

      setActiveTab(isWebcam ? "WEBCAM" : "IP_RTSP");
      setEditForm(buildEditForm(camera));
      setDescriptionLabel(label);
      setDescriptionText(text);
      return;
    }

    if (draftCamera) {
      const isWebcam =
        draftCamera.connection_method === "WEBCAM" || draftCamera.webcam_index != null;

      setActiveTab(isWebcam ? "WEBCAM" : "IP_RTSP");
      setWebcamForm(buildDraftWebcamForm(draftCamera));
      setRtspForm(buildDraftRtspForm(draftCamera));
      setEditForm(null);
      setDescriptionLabel("other_indoor");
      setDescriptionText("");
      setIsAddressExpanded(true);
      return;
    }

    setActiveTab("IP_RTSP");
    setWebcamForm(createEmptyWebcamForm());
    setRtspForm(createEmptyRtspForm());
    setEditForm(null);
    setDescriptionLabel("other_indoor");
    setDescriptionText("");
  }, [camera, draftCamera, isOpen]);

  if (!isOpen) {
    return null;
  }

  const isEditing = !!camera;
  const formData = isEditing ? editForm : activeTab === "WEBCAM" ? webcamForm : rtspForm;
  const currentManufacturer =
    formData && "manufacturer" in formData ? formData.manufacturer : undefined;
  const subtypeLocked =
    activeTab === "IP_RTSP" && isSubtypeLockedForManufacturer(currentManufacturer);
  const webcamFields = formData && "webcam_index" in formData ? formData : null;
  const rtspFields = formData && "ip_address" in formData ? formData : null;

  const handleTabChange = (tab: CameraConnectionTab) => {
    setActiveTab(tab);
    setAddressErrors({});
    setSubmitError(null);
  };

  const updateCurrentFormData = (
    updates: Partial<EditFormData> | Partial<WebcamFormData> | Partial<RtspFormData>
  ) => {
    if (isEditing) {
      setEditForm((current) =>
        current ? { ...current, ...(updates as Partial<EditFormData>) } : current
      );
      return;
    }

    if (activeTab === "WEBCAM") {
      setWebcamForm((current) => ({
        ...current,
        ...(updates as Partial<WebcamFormData>),
      }));
      return;
    }

    setRtspForm((current) => ({
      ...current,
      ...(updates as Partial<RtspFormData>),
    }));
  };

  const handlePublicAccessToggle = (newValue: boolean) => {
    const currentValue = Boolean(formData?.allowpublicaccess);

    if (!currentValue && newValue) {
      setShowPublicAccessModal(true);
      return;
    }

    updateCurrentFormData({ allowpublicaccess: newValue });
  };

  const confirmPublicAccess = () => {
    updateCurrentFormData({ allowpublicaccess: true });
    setShowPublicAccessModal(false);
  };

  const cancelPublicAccess = () => {
    setShowPublicAccessModal(false);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);

    const errors: Record<string, boolean> = {};
    const requiredAddressFields = ["street", "number", "city", "state", "zip_code", "country"] as const;

    if (isEditing) {
      if (!camera || !editForm) {
        return;
      }

      if (!editForm.name.trim()) {
        errors.name = true;
      }

      requiredAddressFields.forEach((field) => {
        if (!editForm[field].trim()) {
          errors[field] = true;
        }
      });

      if (editForm.connection_method !== "WEBCAM") {
        const requiredRtspFields = [
          "ip_address",
          "rtsp_port",
          "manufacturer",
          "connection_method",
          "username",
          "password",
        ] as const;

        requiredRtspFields.forEach((field) => {
          if (!editForm[field].trim()) {
            errors[field] = true;
          }
        });
      }

      if (Object.keys(errors).length > 0) {
        setAddressErrors(errors);
        setIsAddressExpanded(true);
        const errorFields = Object.keys(errors).join(", ");
        setSubmitError(`Please fill in all required fields: ${errorFields}`);
        alert(`Validation failed. Missing required fields: ${errorFields}`);
        return;
      }

      setIsSubmitting(true);

      try {
        const finalDescription =
          descriptionLabel.trim() || descriptionText.trim()
            ? `LABEL: ${descriptionLabel.trim()} DESCRIPTION: ${descriptionText.trim()}`
            : null;

        let payload: Record<string, unknown>;

        if (editForm.connection_method === "WEBCAM") {
          payload = {
            name: editForm.name,
            connection_method: "WEBCAM",
            webcam_index: editForm.webcam_index,
            retention_days: editForm.retention_days,
            allowpublicaccess: editForm.allowpublicaccess,
            street: editForm.street,
            number: editForm.number,
            city: editForm.city,
            state: editForm.state,
            zip_code: editForm.zip_code,
            country: editForm.country,
            description: finalDescription,
          };
        } else {
          payload = {
            name: editForm.name,
            ip_address: editForm.ip_address,
            rtsp_port: normalizeOptionalField(editForm.rtsp_port),
            manufacturer: normalizeOptionalField(editForm.manufacturer),
            username: normalizeOptionalField(editForm.username),
            password: normalizeOptionalField(editForm.password),
            channel: normalizeOptionalField(editForm.channel),
            subtype: isSubtypeLockedForManufacturer(editForm.manufacturer)
              ? undefined
              : normalizeOptionalField(editForm.subtype),
            connection_method: editForm.connection_method,
            retention_days: editForm.retention_days,
            allowpublicaccess: editForm.allowpublicaccess,
            street: editForm.street,
            number: editForm.number,
            city: editForm.city,
            state: editForm.state,
            zip_code: editForm.zip_code,
            country: editForm.country,
            description: finalDescription,
          };
        }

        const response = await fetch(`/api/cameras/${camera.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(await parseApiError(response, "Failed to update camera"));
        }

        await onSaved?.();
        onClose();
      } catch (error) {
        console.error("Failed to update camera:", error);
        setSubmitError(getErrorMessage(error, "Failed to save camera. Please try again."));
      } finally {
        setIsSubmitting(false);
      }

      return;
    }

    const currentFormData = activeTab === "WEBCAM" ? webcamForm : rtspForm;

    if (!currentFormData.name.trim()) {
      errors.name = true;
    }

    requiredAddressFields.forEach((field) => {
      if (!currentFormData[field].trim()) {
        errors[field] = true;
      }
    });

    if (activeTab === "WEBCAM") {
      if (webcamForm.webcam_index === null || webcamForm.webcam_index === undefined) {
        errors.webcam_index = true;
      }
    } else {
      const requiredRtspFields = [
        "ip_address",
        "rtsp_port",
        "manufacturer",
        "connection_method",
        "username",
        "password",
      ] as const;

      requiredRtspFields.forEach((field) => {
        if (!rtspForm[field].trim()) {
          errors[field] = true;
        }
      });
    }

    if (Object.keys(errors).length > 0) {
      setAddressErrors(errors);
      setIsAddressExpanded(true);
      setSubmitError("Please fill in all required fields");
      return;
    }

    setAddressErrors({});
    setIsSubmitting(true);

    try {
      let payload: Record<string, unknown>;

      if (activeTab === "WEBCAM") {
        payload = {
          name: webcamForm.name,
          connection_method: "WEBCAM",
          webcam_index: webcamForm.webcam_index,
          store_frames: true,
          retention_days: webcamForm.retention_days,
          allowpublicaccess: webcamForm.allowpublicaccess,
          street: webcamForm.street,
          number: webcamForm.number,
          city: webcamForm.city,
          state: webcamForm.state,
          zip_code: webcamForm.zip_code,
          country: webcamForm.country,
        };
      } else {
        payload = {
          name: rtspForm.name,
          ip_address: rtspForm.ip_address,
          rtsp_port: normalizeOptionalField(rtspForm.rtsp_port),
          manufacturer: normalizeOptionalField(rtspForm.manufacturer),
          username: normalizeOptionalField(rtspForm.username),
          password: normalizeOptionalField(rtspForm.password),
          channel: normalizeOptionalField(rtspForm.channel),
          subtype: isSubtypeLockedForManufacturer(rtspForm.manufacturer)
            ? undefined
            : normalizeOptionalField(rtspForm.subtype),
          connection_method: rtspForm.connection_method,
          store_frames: true,
          retention_days: rtspForm.retention_days,
          allowpublicaccess: rtspForm.allowpublicaccess,
          street: rtspForm.street,
          number: rtspForm.number,
          city: rtspForm.city,
          state: rtspForm.state,
          zip_code: rtspForm.zip_code,
          country: rtspForm.country,
        };
      }

      const response = await fetch("/api/cameras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed to create camera"));
      }

      await onSaved?.();
      onClose();
    } catch (error) {
      console.error("Failed to create camera:", error);
      setSubmitError(getErrorMessage(error, "Failed to create camera. Please try again."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const addressValidationCount = Object.keys(addressErrors).filter(
    (key) =>
      key !== "webcam_index" &&
      key !== "ip_address" &&
      key !== "rtsp_port" &&
      key !== "manufacturer" &&
      key !== "connection_method" &&
      key !== "username" &&
      key !== "password" &&
      key !== "name"
  ).length;

  return (
    <>
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between p-4 md:p-6 border-b border-gray-800 sticky top-0 bg-gray-900 z-10">
            <h2 className="text-lg md:text-xl font-bold text-gray-100">
              {isEditing ? "Edit Camera" : "Add New Camera"}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex border-b border-gray-800 bg-gray-900">
            <button
              type="button"
              onClick={() => handleTabChange("IP_RTSP")}
              disabled={isEditing}
              className={`flex-1 px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === "IP_RTSP"
                  ? "text-blue-400 border-b-2 border-blue-400 bg-gray-800/30"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/30"
              } ${isEditing ? "cursor-not-allowed opacity-50" : ""}`}
            >
              IP / RTSP Camera
            </button>
            <button
              type="button"
              onClick={() => handleTabChange("WEBCAM")}
              disabled={isEditing}
              className={`flex-1 px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === "WEBCAM"
                  ? "text-blue-400 border-b-2 border-blue-400 bg-gray-800/30"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/30"
              } ${isEditing ? "cursor-not-allowed opacity-50" : ""}`}
            >
              Webcam
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-4 md:p-6" autoComplete={isEditing ? "on" : "off"}>
            {submitError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400 text-sm">
                {submitError}
              </div>
            )}

            {Object.keys(addressErrors).length > 0 && (
              <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/50 rounded-lg text-yellow-400 text-sm">
                <div className="font-semibold mb-1">Please fix the following errors:</div>
                <ul className="list-disc list-inside text-xs">
                  {Object.keys(addressErrors).map((key) => (
                    <li key={key}>{key.replace(/_/g, " ")}: Required</li>
                  ))}
                </ul>
              </div>
            )}

            {activeTab === "WEBCAM" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-300 mb-2">Camera Name *</label>
                  <input
                    type="text"
                    value={formData?.name || ""}
                    onChange={(e) => updateCurrentFormData({ name: e.target.value })}
                    className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    placeholder="e.g., Front Entrance"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-300 mb-2">Webcam Index *</label>
                  <select
                    value={webcamFields?.webcam_index ?? ""}
                    onChange={(e) =>
                      updateCurrentFormData({
                        webcam_index: e.target.value ? parseInt(e.target.value, 10) : null,
                      })
                    }
                    className={`w-full px-4 py-2.5 bg-gray-800 border ${
                      addressErrors.webcam_index ? "border-red-500" : "border-gray-700"
                    } rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
                  >
                    <option value="">Select webcam index...</option>
                    <option value="0">0</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                  </select>
                  {addressErrors.webcam_index && (
                    <p className="text-red-400 text-xs mt-1">Webcam index is required</p>
                  )}
                </div>
              </div>
            )}

            {activeTab === "IP_RTSP" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                {!isEditing && (
                  <div className="sr-only" aria-hidden="true">
                    <input type="text" name="username" autoComplete="username" tabIndex={-1} />
                    <input
                      type="password"
                      name="password"
                      autoComplete="current-password"
                      tabIndex={-1}
                    />
                  </div>
                )}

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-300 mb-2">Camera Name *</label>
                  <input
                    type="text"
                    value={formData?.name || ""}
                    onChange={(e) => updateCurrentFormData({ name: e.target.value })}
                    className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    placeholder="e.g., Front Entrance"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">IP Address *</label>
                  <input
                    type="text"
                    name="camera_network_ip"
                    value={rtspFields?.ip_address || ""}
                    onChange={(e) => updateCurrentFormData({ ip_address: e.target.value })}
                    autoComplete="one-time-code"
                    data-lpignore="true"
                    data-form-type="other"
                    className={`w-full px-4 py-2.5 bg-gray-800 border ${
                      addressErrors.ip_address ? "border-red-500" : "border-gray-700"
                    } rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
                    placeholder="192.168.1.100"
                  />
                  {addressErrors.ip_address && (
                    <p className="text-red-400 text-xs mt-1">IP Address is required</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">RTSP Port *</label>
                  <input
                    type="text"
                    name="camera_rtsp_port"
                    value={rtspFields?.rtsp_port || ""}
                    onChange={(e) => updateCurrentFormData({ rtsp_port: e.target.value })}
                    autoComplete="one-time-code"
                    data-lpignore="true"
                    data-form-type="other"
                    className={`w-full px-4 py-2.5 bg-gray-800 border ${
                      addressErrors.rtsp_port ? "border-red-500" : "border-gray-700"
                    } rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
                    placeholder="554"
                  />
                  {addressErrors.rtsp_port && (
                    <p className="text-red-400 text-xs mt-1">RTSP Port is required</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Manufacturer *</label>
                  <select
                    value={rtspFields?.manufacturer || ""}
                    onChange={(e) => {
                      const nextManufacturer = e.target.value;
                      updateCurrentFormData({
                        manufacturer: nextManufacturer,
                        ...(isSubtypeLockedForManufacturer(nextManufacturer) ? { subtype: "" } : {}),
                      });
                    }}
                    className={`w-full px-4 py-2.5 bg-gray-800 border ${
                      addressErrors.manufacturer ? "border-red-500" : "border-gray-700"
                    } rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
                  >
                    <option value="">Select...</option>
                    <option value="Hikvision">Hikvision</option>
                    <option value="Intelbras">Intelbras</option>
                    <option value="Axis">Axis</option>
                    <option value="Dahua">Dahua</option>
                    <option value="ONVIF">ONVIF</option>
                    <option value="Other">Other</option>
                  </select>
                  {addressErrors.manufacturer && (
                    <p className="text-red-400 text-xs mt-1">Manufacturer is required</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Connection Method *
                  </label>
                  <select
                    value={
                      rtspFields?.connection_method || "RTSP"
                    }
                    onChange={(e) =>
                      updateCurrentFormData({
                        connection_method: e.target.value as Exclude<CameraConnectionMethod, "WEBCAM">,
                      })
                    }
                    className={`w-full px-4 py-2.5 bg-gray-800 border ${
                      addressErrors.connection_method ? "border-red-500" : "border-gray-700"
                    } rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
                  >
                    <option value="RTSP">RTSP</option>
                    <option value="HTTP">HTTP</option>
                    <option value="ONVIF">ONVIF</option>
                  </select>
                  {addressErrors.connection_method && (
                    <p className="text-red-400 text-xs mt-1">Connection Method is required</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Channel</label>
                  <input
                    type="text"
                    value={rtspFields?.channel || ""}
                    onChange={(e) => updateCurrentFormData({ channel: e.target.value })}
                    className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    placeholder="1 or 201"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Subtype</label>
                  <input
                    type="text"
                    value={subtypeLocked ? "" : rtspFields?.subtype || ""}
                    onChange={(e) => updateCurrentFormData({ subtype: e.target.value })}
                    disabled={subtypeLocked}
                    className={`w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all ${
                      subtypeLocked ? "opacity-60 cursor-not-allowed" : ""
                    }`}
                    placeholder={subtypeLocked ? "Locked for Hikvision" : "0, 1, 2..."}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Username *</label>
                  <input
                    type="text"
                    name={isEditing ? "username" : "camera_auth_username"}
                    value={rtspFields?.username || ""}
                    onChange={(e) => updateCurrentFormData({ username: e.target.value })}
                    autoComplete={isEditing ? "username" : "off"}
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    className={`w-full px-4 py-2.5 bg-gray-800 border ${
                      addressErrors.username ? "border-red-500" : "border-gray-700"
                    } rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
                    placeholder="admin"
                  />
                  {addressErrors.username && (
                    <p className="text-red-400 text-xs mt-1">Username is required</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Password *</label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      name={isEditing ? "password" : "camera_auth_password"}
                      value={rtspFields?.password || ""}
                      onChange={(e) => updateCurrentFormData({ password: e.target.value })}
                      autoComplete={isEditing ? "current-password" : "new-password"}
                      data-lpignore="true"
                      data-1p-ignore="true"
                      data-form-type="other"
                      className={`w-full px-4 py-2.5 pr-12 bg-gray-800 border ${
                        addressErrors.password ? "border-red-500" : "border-gray-700"
                      } rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
                      placeholder="********"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 transition-colors hover:text-white"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? (
                        <EyeOff className="h-5 w-5" />
                      ) : (
                        <Eye className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                  {addressErrors.password && (
                    <p className="text-red-400 text-xs mt-1">Password is required</p>
                  )}
                </div>
              </div>
            )}

            <div
              className={`mb-6 border rounded-lg overflow-hidden transition-all ${
                Object.keys(addressErrors).length > 0 ? "border-red-500/50" : "border-gray-700"
              }`}
            >
              <button
                type="button"
                onClick={() => setIsAddressExpanded((current) => !current)}
                className="w-full px-4 py-3 bg-gray-800/50 hover:bg-gray-800 flex items-center justify-between transition-colors"
              >
                <span className="text-sm font-medium text-gray-300">
                  Address & Location *{" "}
                  {addressValidationCount > 0 && (
                    <span className="text-red-400 ml-2">(Required fields missing)</span>
                  )}
                </span>
                {isAddressExpanded ? (
                  <ChevronUp className="w-4 h-4 text-gray-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                )}
              </button>

              {isAddressExpanded && (
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 animate-slide-down">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-300 mb-2">Street *</label>
                    <input
                      type="text"
                      name="camera_location_street"
                      value={formData?.street || ""}
                      onChange={(e) => updateCurrentFormData({ street: e.target.value })}
                      autoComplete="section-camera-location address-line1"
                      className={`w-full px-4 py-2.5 bg-gray-800 border ${
                        addressErrors.street ? "border-red-500" : "border-gray-700"
                      } rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
                      placeholder="e.g., Main Street"
                    />
                    {addressErrors.street && <p className="text-red-400 text-xs mt-1">Required</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Number *</label>
                    <input
                      type="text"
                      name="camera_location_number"
                      value={formData?.number || ""}
                      onChange={(e) => updateCurrentFormData({ number: e.target.value })}
                      autoComplete="section-camera-location address-line2"
                      className={`w-full px-4 py-2.5 bg-gray-800 border ${
                        addressErrors.number ? "border-red-500" : "border-gray-700"
                      } rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
                      placeholder="123"
                    />
                    {addressErrors.number && <p className="text-red-400 text-xs mt-1">Required</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">City *</label>
                    <input
                      type="text"
                      name="camera_location_city"
                      value={formData?.city || ""}
                      onChange={(e) => updateCurrentFormData({ city: e.target.value })}
                      autoComplete="section-camera-location address-level2"
                      className={`w-full px-4 py-2.5 bg-gray-800 border ${
                        addressErrors.city ? "border-red-500" : "border-gray-700"
                      } rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
                      placeholder="New York"
                    />
                    {addressErrors.city && <p className="text-red-400 text-xs mt-1">Required</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">State *</label>
                    <input
                      type="text"
                      name="camera_location_state"
                      value={formData?.state || ""}
                      onChange={(e) => updateCurrentFormData({ state: e.target.value })}
                      autoComplete="section-camera-location address-level1"
                      className={`w-full px-4 py-2.5 bg-gray-800 border ${
                        addressErrors.state ? "border-red-500" : "border-gray-700"
                      } rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
                      placeholder="NY"
                    />
                    {addressErrors.state && <p className="text-red-400 text-xs mt-1">Required</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">ZIP Code *</label>
                    <input
                      type="text"
                      name="camera_location_zip"
                      value={formData?.zip_code || ""}
                      onChange={(e) => updateCurrentFormData({ zip_code: e.target.value })}
                      autoComplete="section-camera-location postal-code"
                      className={`w-full px-4 py-2.5 bg-gray-800 border ${
                        addressErrors.zip_code ? "border-red-500" : "border-gray-700"
                      } rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
                      placeholder="10001"
                    />
                    {addressErrors.zip_code && <p className="text-red-400 text-xs mt-1">Required</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Country *</label>
                    <input
                      type="text"
                      name="camera_location_country"
                      value={formData?.country || ""}
                      onChange={(e) => updateCurrentFormData({ country: e.target.value })}
                      autoComplete="section-camera-location country-name"
                      className={`w-full px-4 py-2.5 bg-gray-800 border ${
                        addressErrors.country ? "border-red-500" : "border-gray-700"
                      } rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
                      placeholder="United States"
                    />
                    {addressErrors.country && <p className="text-red-400 text-xs mt-1">Required</p>}
                  </div>
                </div>
              )}
            </div>

            {isEditing && (
              <div className="mb-6 pt-4 border-t border-gray-800">
                <h3 className="text-sm font-semibold text-gray-300 mb-4">
                  {t("cameras.cameraDescription")}
                </h3>
                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      {t("cameras.label")}
                    </label>
                    <select
                      value={descriptionLabel}
                      onChange={(e) => setDescriptionLabel(e.target.value)}
                      className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    >
                      {CAMERA_LABEL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      {t("cameras.description")}
                    </label>
                    <textarea
                      value={descriptionText}
                      onChange={(e) => setDescriptionText(e.target.value)}
                      className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all resize-none"
                      placeholder={t("cameras.descriptionPlaceholder")}
                      rows={3}
                      maxLength={1900}
                    />
                    <p className="text-xs text-gray-500 mt-1">{descriptionText.length}/1900 characters</p>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 pt-4 border-t border-gray-800">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <div className="relative inline-flex items-center opacity-75">
                    <div className="w-11 h-6 bg-blue-500 rounded-full after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:translate-x-full" />
                  </div>
                  <span className="text-sm font-medium text-gray-300">Store Frames for Past Search</span>
                </div>
                <p className="text-xs text-gray-500 ml-14">Required for timeline & past search</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {t("cameras.retention")}
                </label>
                <select
                  value={formData?.retention_days || 1}
                  onChange={(e) =>
                    updateCurrentFormData({
                      retention_days: parseInt(e.target.value, 10) as RetentionDays,
                    })
                  }
                  className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                >
                  <option value={1}>1 day</option>
                  <option value={3}>3 days</option>
                  <option value={7}>7 days</option>
                  <option value={15}>15 days</option>
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                  <option value={180}>180 days</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 border-t border-gray-800 pt-4">
              <div className="md:col-span-2 flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handlePublicAccessToggle(!Boolean(formData?.allowpublicaccess))}
                    className={`relative inline-flex items-center h-6 w-11 rounded-full transition-colors ${
                      formData?.allowpublicaccess ? "bg-blue-500" : "bg-gray-600"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white border border-gray-300 transition-transform ${
                        formData?.allowpublicaccess ? "translate-x-6" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                  <span className="text-sm font-medium text-gray-300">Allow Public Access</span>
                </div>
                <p className="text-xs text-gray-500 ml-14">
                  Enable authorized law enforcement access to this camera
                </p>
              </div>
            </div>

            <div className="flex flex-col md:flex-row items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="w-full md:w-auto px-5 py-3 md:py-2.5 text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded-lg font-medium transition-colors min-h-[44px] md:min-h-0"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full md:w-auto px-5 py-3 md:py-2.5 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors shadow-lg shadow-blue-500/30 min-h-[44px] md:min-h-0 flex items-center justify-center gap-2"
              >
                {isSubmitting && (
                  <svg
                    className="animate-spin h-4 w-4 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                )}
                {isSubmitting ? "Saving..." : isEditing ? "Save Changes" : "Add Camera"}
              </button>
            </div>
          </form>
        </div>
      </div>

      {showPublicAccessModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="p-6">
              <h2 className="text-xl font-bold text-gray-100 mb-4">
                Enable public access for this camera?
              </h2>
              <p className="text-gray-300 mb-6">
                By enabling <strong>Allow Public Access</strong>, you agree that authorized law
                enforcement partners may access this camera's stream and recorded frames when legally
                requested.
                <br />
                <br />
                Only enable this if you understand and accept this responsibility.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={cancelPublicAccess}
                  className="flex-1 px-4 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmPublicAccess}
                  className="flex-1 px-4 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors text-center"
                >
                  I understand and agree
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
