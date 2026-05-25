import {
  buildSharedCameraExecutionDescriptor,
  canExecuteSharedCamera,
  canUseSharedCameraCrossCameraFederation,
  type SharedCameraExecutionDescriptor,
} from "./sharedCameraAccess";

export type JobExecutionValidationIssue = {
  code:
    | "missing_camera"
    | "shared_camera_revoked"
    | "shared_camera_execution_not_allowed"
    | "shared_camera_missing_owner_reference"
    | "cross_domain_group_inference_unsupported"
    | "cross_domain_pipeline_unsupported";
  message: string;
  camera_id?: number;
  step_id?: number;
};

export type JobExecutionSegmentPlan = {
  segment_id: string;
  execution_domain: string;
  owner_public_id: string | null;
  share_ids: number[];
  share_id_by_operator_camera_id: Record<string, number>;
  operator_camera_ids: number[];
  owner_camera_ids: number[];
  camera_id_map: Record<string, number>;
  payload: Record<string, unknown>;
  is_local: boolean;
};

export type JobExecutionPlan = {
  job_run_id: string;
  job_id: number | null;
  segments: JobExecutionSegmentPlan[];
  issues: JobExecutionValidationIssue[];
  requires_cross_camera_federation: boolean;
};

const SHARED_SEGMENT_RUN_ID_MARKER = "::sharedseg::";

function normalizeText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function clampPositiveInteger(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }
  return Number(numeric);
}

function cloneJsonObject<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function buildSegmentScopedRunId(baseRunId: unknown, segmentId: string): string {
  const normalizedSegmentId = normalizeText(segmentId);
  const normalizedBase = normalizeText(baseRunId);
  if (!normalizedSegmentId) {
    return normalizedBase || crypto.randomUUID();
  }
  if (!normalizedBase) {
    return `${crypto.randomUUID()}${SHARED_SEGMENT_RUN_ID_MARKER}${normalizedSegmentId}`;
  }
  if (normalizedBase.includes(SHARED_SEGMENT_RUN_ID_MARKER)) {
    return normalizedBase;
  }
  return `${normalizedBase}${SHARED_SEGMENT_RUN_ID_MARKER}${normalizedSegmentId}`;
}

export function extractSharedSegmentIdFromScopedRunId(value: unknown): string | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  const markerIndex = normalized.lastIndexOf(SHARED_SEGMENT_RUN_ID_MARKER);
  if (markerIndex < 0) {
    return null;
  }
  const segmentId = normalized
    .slice(markerIndex + SHARED_SEGMENT_RUN_ID_MARKER.length)
    .trim();
  return segmentId || null;
}

const CAMERA_ID_SCALAR_KEYS = new Set([
  "camera_id",
  "cameraId",
  "target_camera_id",
  "targetCameraId",
  "source_camera_id",
  "sourceCameraId",
  "matched_camera_id",
  "matchedCameraId",
]);

const CAMERA_ID_ARRAY_KEYS = new Set([
  "all_camera_ids",
  "allCameraIds",
  "camera_ids",
  "cameraIds",
]);

function remapCameraIdScalarValue(
  value: unknown,
  cameraIdMap: Record<string, number>
): unknown {
  const cameraId = clampPositiveInteger(value);
  if (!cameraId) {
    return value;
  }
  return cameraIdMap[String(cameraId)] || cameraId;
}

function remapCameraIdsInPayload(
  value: unknown,
  cameraIdMap: Record<string, number>,
  parentKey = ""
): unknown {
  if (Array.isArray(value)) {
    if (CAMERA_ID_ARRAY_KEYS.has(parentKey)) {
      return value.map((entry) => remapCameraIdScalarValue(entry, cameraIdMap));
    }
    return value.map((entry) => remapCameraIdsInPayload(entry, cameraIdMap, parentKey));
  }

  if (!value || typeof value !== "object") {
    if (CAMERA_ID_SCALAR_KEYS.has(parentKey)) {
      return remapCameraIdScalarValue(value, cameraIdMap);
    }
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
      key,
      remapCameraIdsInPayload(nestedValue, cameraIdMap, key),
    ])
  );
}

function resolvePipelineInputCameraIds(
  pipeline: Record<string, unknown>,
  sourceStepTargets: Array<Record<string, unknown>>
): number[] {
  const resolved = new Set<number>();
  const inputs = Array.isArray((pipeline as any)?.inputs) ? (pipeline as any).inputs : [];

  for (const rawInput of inputs) {
    if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
      continue;
    }
    const explicitCameraId = clampPositiveInteger((rawInput as any)?.camera_id);
    if (explicitCameraId) {
      resolved.add(explicitCameraId);
      continue;
    }
    const injectKey = normalizeText(
      (rawInput as any)?.input_inject_key ?? (rawInput as any)?.inject_key
    );
    if (!injectKey) {
      continue;
    }
    const numericInjectCameraId = clampPositiveInteger(injectKey);
    if (numericInjectCameraId) {
      resolved.add(numericInjectCameraId);
      continue;
    }
    for (const target of sourceStepTargets) {
      const cameraName = normalizeText((target as any)?.camera_name);
      const slotLabel = normalizeText((target as any)?.slot_label);
      if (injectKey === cameraName || injectKey === slotLabel) {
        const matchedCameraId = clampPositiveInteger((target as any)?.camera_id);
        if (matchedCameraId) {
          resolved.add(matchedCameraId);
        }
      }
    }
  }

  const fallbackInjectKey = normalizeText((pipeline as any)?.input_inject_key);
  if (resolved.size === 0 && fallbackInjectKey) {
    const numericInjectCameraId = clampPositiveInteger(fallbackInjectKey);
    if (numericInjectCameraId) {
      resolved.add(numericInjectCameraId);
    } else {
      for (const target of sourceStepTargets) {
        const cameraName = normalizeText((target as any)?.camera_name);
        const slotLabel = normalizeText((target as any)?.slot_label);
        if (fallbackInjectKey === cameraName || fallbackInjectKey === slotLabel) {
          const matchedCameraId = clampPositiveInteger((target as any)?.camera_id);
          if (matchedCameraId) {
            resolved.add(matchedCameraId);
          }
        }
      }
    }
  }

  return [...resolved];
}

async function loadCameraExecutionRows(
  db: D1Database,
  userId: string,
  cameraIds: number[]
): Promise<Map<number, SharedCameraExecutionDescriptor>> {
  const uniqueIds = [...new Set(cameraIds.filter((cameraId) => Number.isInteger(cameraId) && cameraId > 0))];
  if (uniqueIds.length === 0) {
    return new Map<number, SharedCameraExecutionDescriptor>();
  }

  const placeholders = uniqueIds.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT
         id,
         name,
         origin_type,
         shared_share_id,
         shared_owner_public_id,
         shared_owner_local_camera_id,
         shared_status,
         shared_permission_profile,
         shared_access_config_json
       FROM cameras
       WHERE user_id = ?
         AND id IN (${placeholders})`
    )
    .bind(userId, ...uniqueIds)
    .all();

  const map = new Map<number, SharedCameraExecutionDescriptor>();
  for (const row of results || []) {
    const descriptor = buildSharedCameraExecutionDescriptor(row);
    if (descriptor) {
      map.set(descriptor.cameraId, descriptor);
    }
  }
  return map;
}

export async function loadJobExecutionDescriptors(
  db: D1Database,
  userId: string,
  cameraIds: number[]
): Promise<Map<number, SharedCameraExecutionDescriptor>> {
  return loadCameraExecutionRows(db, userId, cameraIds);
}

function buildSegmentPayload(
  basePayload: Record<string, unknown>,
  cameraIds: Set<number>,
  segmentId: string,
  cameraIdMap: Record<string, number>,
  executionDomain: string,
  ownerPublicId: string | null,
  requiresCrossCameraFederation: boolean
): Record<string, unknown> {
  const cloned = cloneJsonObject(basePayload);
  const steps = Array.isArray((cloned as any)?.steps) ? (cloned as any).steps : [];
  const stepTargetsById = new Map<number, Array<Record<string, unknown>>>();

  const filteredSteps = steps
    .map((rawStep: any) => {
      const targets = Array.isArray(rawStep?.targets) ? rawStep.targets : [];
      const retainedTargets = targets.filter((target: any) =>
        cameraIds.has(clampPositiveInteger(target?.camera_id) || 0)
      );
      if (retainedTargets.length === 0) {
        return null;
      }

      const retainedTargetIds = new Set(
        retainedTargets
          .map((target: any) => clampPositiveInteger(target?.id))
          .filter((targetId: number | null): targetId is number => !!targetId)
      );

      const retainedAgents = (Array.isArray(rawStep?.agents) ? rawStep.agents : []).filter(
        (agent: any) => {
          const agentCameraId = clampPositiveInteger(agent?.camera_id);
          return !agentCameraId || cameraIds.has(agentCameraId);
        }
      )
      .map((agent: any) => ({
        ...agent,
        agent_run_id: buildSegmentScopedRunId(
          normalizeText(agent?.agent_run_id) || crypto.randomUUID(),
          segmentId
        ),
      }));

      const stepObject =
        rawStep?.step && typeof rawStep.step === "object" && !Array.isArray(rawStep.step)
          ? cloneJsonObject(rawStep.step)
          : {};
      const stepRunId = buildSegmentScopedRunId(
        normalizeText(rawStep?.step_run_id ?? (stepObject as any)?.step_run_id) || crypto.randomUUID(),
        segmentId
      );
      (stepObject as any).step_run_id = stepRunId;
      const rawInferenceGroups = Array.isArray((stepObject as any)?.inference_groups)
        ? (stepObject as any).inference_groups
        : [];
      (stepObject as any).inference_groups = rawInferenceGroups
        .map((group: any) => {
          const nextTargetIds = Array.isArray(group?.targetIds)
            ? group.targetIds.filter((targetId: unknown) =>
                retainedTargetIds.has(clampPositiveInteger(targetId) || 0)
              )
            : [];
          if (nextTargetIds.length === 0) {
            return null;
          }
          const nextBindings = Array.isArray(group?.analysis_bindings)
            ? group.analysis_bindings.filter((binding: any) =>
                retainedTargetIds.has(clampPositiveInteger(binding?.target_id) || 0)
              )
            : [];
          return {
            ...group,
            targetIds: nextTargetIds,
            analysis_bindings: nextBindings,
          };
        })
        .filter((group: Record<string, unknown> | null): group is Record<string, unknown> => !!group);

      if (Array.isArray((stepObject as any)?.pipelines)) {
        (stepObject as any).pipelines = (stepObject as any).pipelines.filter((pipeline: any) =>
          cameraIds.has(clampPositiveInteger(pipeline?.target_camera_id) || 0)
        );
      }

      if (
        (stepObject as any)?.pipeline &&
        typeof (stepObject as any).pipeline === "object" &&
        !Array.isArray((stepObject as any).pipeline)
      ) {
        const singlePipeline = (stepObject as any).pipeline as Record<string, unknown>;
        const pipelineCameraId = clampPositiveInteger(singlePipeline.camera_id);
        if (pipelineCameraId && !cameraIds.has(pipelineCameraId)) {
          delete (stepObject as any).pipeline;
        }
      }

      stepTargetsById.set(
        clampPositiveInteger(stepObject?.id) || 0,
        retainedTargets.map((target: any) => ({ ...target }))
      );

      return {
        ...rawStep,
        step_run_id: stepRunId,
        step: stepObject,
        targets: retainedTargets,
        agents: retainedAgents,
      };
    })
    .filter((step: Record<string, unknown> | null): step is Record<string, unknown> => !!step);

  (cloned as any).steps = filteredSteps;
  (cloned as any).all_camera_ids = [...cameraIds];
  (cloned as any).shared_segment_id = segmentId;
  (cloned as any).shared_execution_domain = executionDomain;
  (cloned as any).shared_owner_public_id = ownerPublicId || null;
  (cloned as any).shared_cross_camera_federation_required = requiresCrossCameraFederation;
  delete (cloned as any).start_camera_payloads;
  delete (cloned as any).camera_start_payloads;

  return remapCameraIdsInPayload(cloned, cameraIdMap) as Record<string, unknown>;
}

export function buildJobExecutionPlan(
  basePayload: Record<string, unknown>,
  executionByCamera: Map<number, SharedCameraExecutionDescriptor>
): JobExecutionPlan {
  const allCameraIds = Array.isArray((basePayload as any)?.all_camera_ids)
    ? (basePayload as any).all_camera_ids
        .map((cameraId: unknown) => clampPositiveInteger(cameraId))
        .filter((cameraId: number | null): cameraId is number => !!cameraId)
    : [];
  const issues: JobExecutionValidationIssue[] = [];
  const domains = new Map<string, Set<number>>();
  const requiresCrossCameraFederationDomains = new Set<string>();

  for (const cameraId of allCameraIds) {
    const descriptor = executionByCamera.get(cameraId);
    if (!descriptor) {
      issues.push({
        code: "missing_camera",
        message: `Camera ${cameraId} is no longer available for this job.`,
        camera_id: cameraId,
      });
      continue;
    }
    if (descriptor.isShared) {
      if ((descriptor.sharedStatus || "accepted") !== "accepted") {
        issues.push({
          code: "shared_camera_revoked",
          message: `Shared camera ${cameraId} is no longer accepted on this workspace.`,
          camera_id: cameraId,
        });
        continue;
      }
      if (!descriptor.ownerPublicId || !descriptor.ownerLocalCameraId) {
        issues.push({
          code: "shared_camera_missing_owner_reference",
          message: `Shared camera ${cameraId} is missing the owner camera reference required for task execution.`,
          camera_id: cameraId,
        });
        continue;
      }
      if (!canExecuteSharedCamera(descriptor.permissionProfile, descriptor.accessConfig)) {
        issues.push({
          code: "shared_camera_execution_not_allowed",
          message: `Shared camera ${cameraId} does not allow task execution under the current share profile.`,
          camera_id: cameraId,
        });
        continue;
      }
      if (
        canUseSharedCameraCrossCameraFederation(
          descriptor.permissionProfile,
          descriptor.accessConfig
        )
      ) {
        requiresCrossCameraFederationDomains.add(descriptor.executionDomain);
      }
    }

    let bucket = domains.get(descriptor.executionDomain);
    if (!bucket) {
      bucket = new Set<number>();
      domains.set(descriptor.executionDomain, bucket);
    }
    bucket.add(cameraId);
  }

  const steps = Array.isArray((basePayload as any)?.steps) ? (basePayload as any).steps : [];
  const stepTargetsById = new Map<number, Array<Record<string, unknown>>>();
  for (const rawStep of steps) {
    const stepId = clampPositiveInteger(rawStep?.step?.id);
    if (!stepId) continue;
    const stepTargets = Array.isArray(rawStep?.targets)
      ? rawStep.targets.map((target: any) => ({ ...target }))
      : [];
    stepTargetsById.set(stepId, stepTargets);

    const inferenceGroups = Array.isArray(rawStep?.step?.inference_groups)
      ? rawStep.step.inference_groups
      : [];
    for (const group of inferenceGroups) {
      const groupDomains = new Set<string>();
      const targetIds = Array.isArray(group?.targetIds) ? group.targetIds : [];
      for (const targetIdValue of targetIds) {
        const targetId = clampPositiveInteger(targetIdValue);
        if (!targetId) continue;
        const matchingTarget = stepTargets.find(
          (target: any) => clampPositiveInteger((target as any)?.id) === targetId
        );
        const cameraId = clampPositiveInteger((matchingTarget as any)?.camera_id);
        if (!cameraId) continue;
        const descriptor = executionByCamera.get(cameraId);
        if (descriptor) {
          groupDomains.add(descriptor.executionDomain);
        }
      }
      if (groupDomains.size > 1) {
        issues.push({
          code: "cross_domain_group_inference_unsupported",
          message:
            "A grouped multi-camera task step mixes local and shared domains. This would require live stream packing across workspaces and is not supported.",
          step_id: stepId,
        });
      }
    }

    const pipelines = Array.isArray(rawStep?.step?.pipelines) ? rawStep.step.pipelines : [];
    for (const pipeline of pipelines) {
      const targetCameraId = clampPositiveInteger((pipeline as any)?.target_camera_id);
      const targetDescriptor = targetCameraId ? executionByCamera.get(targetCameraId) || null : null;
      const sourceStepId = clampPositiveInteger((pipeline as any)?.input_from_step_id);
      const sourceTargets = sourceStepId ? stepTargetsById.get(sourceStepId) || [] : [];
      const pipelineSourceCameraIds = resolvePipelineInputCameraIds(pipeline, sourceTargets);
      const pipelineDomains = new Set<string>();
      if (targetDescriptor) {
        pipelineDomains.add(targetDescriptor.executionDomain);
      }
      for (const sourceCameraId of pipelineSourceCameraIds) {
        const sourceDescriptor = executionByCamera.get(sourceCameraId);
        if (sourceDescriptor) {
          pipelineDomains.add(sourceDescriptor.executionDomain);
        }
      }
      if (pipelineDomains.size > 1) {
        issues.push({
          code: "cross_domain_pipeline_unsupported",
          message:
            "A task pipeline tries to inject output across local/shared domains. Cross-domain stream injection is not supported without live transport.",
          step_id: stepId,
        });
      }
    }
  }

  const segments: JobExecutionSegmentPlan[] = [];
  for (const [executionDomain, cameraIds] of domains.entries()) {
    const sortedCameraIds = [...cameraIds].sort((left, right) => left - right);
    const firstDescriptor =
      executionByCamera.get(sortedCameraIds[0]) || null;
    const ownerCameraIds = sortedCameraIds.map((cameraId) => {
      const descriptor = executionByCamera.get(cameraId) || null;
      if (!descriptor?.isShared) {
        return cameraId;
      }
      return descriptor.ownerLocalCameraId || cameraId;
    });
    const shareIds: number[] = [];
    const shareIdByOperatorCameraId: Record<string, number> = {};
    const cameraIdMap: Record<string, number> = {};
    for (const cameraId of sortedCameraIds) {
      const descriptor = executionByCamera.get(cameraId) || null;
      if (descriptor?.isShared && descriptor.ownerLocalCameraId) {
        cameraIdMap[String(cameraId)] = descriptor.ownerLocalCameraId;
        if (descriptor.shareId) {
          shareIdByOperatorCameraId[String(cameraId)] = descriptor.shareId;
          shareIds.push(descriptor.shareId);
        }
      } else {
        cameraIdMap[String(cameraId)] = cameraId;
      }
    }
    const segmentId = crypto.randomUUID();
    const payload = buildSegmentPayload(
      basePayload,
      cameraIds,
      segmentId,
      cameraIdMap,
      executionDomain,
      firstDescriptor?.ownerPublicId || null,
      domains.size > 1 && requiresCrossCameraFederationDomains.size > 0
    );
    segments.push({
      segment_id: segmentId,
      execution_domain: executionDomain,
      owner_public_id: firstDescriptor?.ownerPublicId || null,
      share_ids: [...new Set(shareIds)].sort((left, right) => left - right),
      share_id_by_operator_camera_id: shareIdByOperatorCameraId,
      operator_camera_ids: sortedCameraIds,
      owner_camera_ids: ownerCameraIds,
      camera_id_map: cameraIdMap,
      payload,
      is_local: executionDomain === "local",
    });
  }

  return {
    job_run_id: normalizeText((basePayload as any)?.job_run_id),
    job_id: clampPositiveInteger((basePayload as any)?.job?.id),
    segments,
    issues,
    requires_cross_camera_federation: domains.size > 1 && requiresCrossCameraFederationDomains.size > 0,
  };
}
