type SharedCameraLike = {
  origin_type?: string | null;
  shared_owner_display_label?: string | null;
  shared_owner_handle?: string | null;
  shared_owner_email?: string | null;
  shared_origin_brand_id?: string | null;
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isPortuguese(language?: string | null): boolean {
  return normalizeText(language).toLowerCase().startsWith("pt");
}

export function isSharedCameraReference(camera: SharedCameraLike | null | undefined): boolean {
  return normalizeText(camera?.origin_type).toLowerCase() === "shared_find";
}

export function getSharedCameraProgramLabel(
  camera: SharedCameraLike | null | undefined
): string {
  const originBrandId = normalizeText(camera?.shared_origin_brand_id).toLowerCase();
  if (originBrandId === "perceptrum") {
    return "Perceptrum";
  }
  if (originBrandId === "drakon") {
    return "Drakon";
  }
  return originBrandId ? `${originBrandId.slice(0, 1).toUpperCase()}${originBrandId.slice(1)}` : "Drakon";
}

export function getSharedCameraOwnerLabel(
  camera: SharedCameraLike | null | undefined,
  language?: string | null
): string {
  const displayLabel = normalizeText(camera?.shared_owner_display_label);
  if (displayLabel) {
    return displayLabel;
  }

  const handle = normalizeText(camera?.shared_owner_handle);
  if (handle) {
    return handle.startsWith("@") ? handle : `@${handle}`;
  }

  const email = normalizeText(camera?.shared_owner_email);
  if (email) {
    return email;
  }

  return isPortuguese(language) ? "outro workspace" : "another workspace";
}

export function getSharedCameraAttribution(
  camera: SharedCameraLike | null | undefined,
  language?: string | null
): string | null {
  if (!isSharedCameraReference(camera)) {
    return null;
  }

  const ownerLabel = getSharedCameraOwnerLabel(camera, language);
  const programLabel = getSharedCameraProgramLabel(camera);
  if (isPortuguese(language)) {
    return `Compartilhada por ${ownerLabel} via ${programLabel}`;
  }

  return `Shared by ${ownerLabel} via ${programLabel}`;
}

export function getSharedCameraStatusLabel(language?: string | null): string {
  return isPortuguese(language) ? "Acesso compartilhado" : "Shared access";
}

export function getSharedCameraUnavailableReason(
  camera: SharedCameraLike | null | undefined,
  language?: string | null
): string {
  const ownerLabel = getSharedCameraOwnerLabel(camera, language);
  const programLabel = getSharedCameraProgramLabel(camera);
  if (isPortuguese(language)) {
    return `Os controles locais desta camera ficam com ${ownerLabel} no ${programLabel}.`;
  }

  return `Local controls for this camera stay with ${ownerLabel} in ${programLabel}.`;
}
