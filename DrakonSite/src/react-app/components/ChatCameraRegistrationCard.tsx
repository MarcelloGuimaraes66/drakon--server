import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, MapPin } from "lucide-react";
import { normalizeCountryCode } from "@/shared/brazilStates";
import type { CameraRegistrationDraftMessageMetadata } from "@/react-app/utils/chatUtils";

type CameraRegistrationFormData = {
  name: string;
  connection_method: "RTSP" | "WEBCAM" | "HTTP" | "ONVIF";
  ip_address: string;
  rtsp_port: string;
  manufacturer: string;
  username: string;
  password: string;
  channel: string;
  subtype: string;
  webcam_index: number | null;
  street: string;
  number: string;
  city: string;
  state: string;
  zip_code: string;
  country: string;
  retention_days: 1 | 3 | 7 | 15 | 30 | 90 | 180;
  allowpublicaccess: boolean;
  shared_find_invitee_query: string;
};

type AddressLookupResponse = {
  found: boolean;
  source: "viacep" | "google-geocoding" | null;
  postal_code: string;
  country: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  message: string | null;
};

type Props = {
  messageId: number;
  metadata: CameraRegistrationDraftMessageMetadata;
  onSubmit: (messageId: number, draft: Record<string, unknown>) => Promise<void>;
};

const VALID_RETENTION_DAYS = [1, 3, 7, 15, 30, 90, 180] as const;

function toNonEmptyString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeRetentionDays(value: unknown): CameraRegistrationFormData["retention_days"] {
  const parsed = toNullableNumber(value);
  return VALID_RETENTION_DAYS.includes(parsed as CameraRegistrationFormData["retention_days"])
    ? (parsed as CameraRegistrationFormData["retention_days"])
    : 1;
}

function normalizeConnectionMethod(value: unknown): CameraRegistrationFormData["connection_method"] {
  const normalized = toNonEmptyString(value).toUpperCase();
  if (normalized === "WEBCAM" || normalized === "HTTP" || normalized === "ONVIF") {
    return normalized;
  }
  return "RTSP";
}

function normalizePostalCodeForLookup(value: string, countryCode: string | null): string {
  const raw = value.trim();
  if (!raw) {
    return "";
  }

  if (countryCode === "BR") {
    return raw.replace(/\D+/g, "").slice(0, 8);
  }

  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9 -]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isPostalCodeReadyForLookup(postalCode: string, countryCode: string | null): boolean {
  if (!postalCode) {
    return false;
  }

  if (countryCode === "BR") {
    return postalCode.length === 8;
  }

  return postalCode.length >= 3;
}

function normalizeFormDraft(draft: Record<string, unknown>): CameraRegistrationFormData {
  return {
    name: toNonEmptyString(draft.name),
    connection_method: normalizeConnectionMethod(draft.connection_method),
    ip_address: toNonEmptyString(draft.ip_address),
    rtsp_port: toNonEmptyString(draft.rtsp_port),
    manufacturer: toNonEmptyString(draft.manufacturer),
    username: toNonEmptyString(draft.username),
    password: toNonEmptyString(draft.password),
    channel: toNonEmptyString(draft.channel),
    subtype: toNonEmptyString(draft.subtype),
    webcam_index: toNullableNumber(draft.webcam_index),
    street: toNonEmptyString(draft.street),
    number: toNonEmptyString(draft.number),
    city: toNonEmptyString(draft.city),
    state: toNonEmptyString(draft.state),
    zip_code: toNonEmptyString(draft.zip_code),
    country: toNonEmptyString(draft.country),
    retention_days: normalizeRetentionDays(draft.retention_days),
    allowpublicaccess: toBoolean(draft.allowpublicaccess),
    shared_find_invitee_query: toNonEmptyString(draft.shared_find_invitee_query),
  };
}

function buildSubmitPayload(form: CameraRegistrationFormData): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    ...form,
  };
  const shareInviteeQuery = form.shared_find_invitee_query.trim();
  if (form.connection_method === "WEBCAM" && form.webcam_index !== null && form.webcam_index !== undefined) {
    payload.webcam_index = form.webcam_index;
  } else {
    delete payload.webcam_index;
  }
  if (shareInviteeQuery) {
    payload.shared_find_invitee_query = shareInviteeQuery;
  } else {
    delete payload.shared_find_invitee_query;
  }
  return payload;
}

function buildErrors(form: CameraRegistrationFormData): Record<string, boolean> {
  const nextErrors: Record<string, boolean> = {};

  if (!form.name.trim()) {
    nextErrors.name = true;
  }

  if (form.connection_method === "WEBCAM") {
    if (form.webcam_index === null || form.webcam_index === undefined) {
      nextErrors.webcam_index = true;
    }
  } else {
    [
      "ip_address",
      "rtsp_port",
      "manufacturer",
      "username",
      "password",
    ].forEach((field) => {
      if (!toNonEmptyString(form[field as keyof CameraRegistrationFormData])) {
        nextErrors[field] = true;
      }
    });
  }

  ["street", "number", "city", "state"].forEach((field) => {
    if (!toNonEmptyString(form[field as keyof CameraRegistrationFormData])) {
      nextErrors[field] = true;
    }
  });

  return nextErrors;
}

function useCardCopy(languageInput?: string) {
  const language = (languageInput || "en").toLowerCase();
  const key = language.startsWith("pt")
    ? "pt"
    : language.startsWith("es")
      ? "es"
      : language.startsWith("fr")
        ? "fr"
        : "en";

  return useMemo(() => {
    if (key === "pt") {
      return {
        title: "Cadastro da camera",
        connection: "Conexao",
        address: "Endereco",
        options: "Opcoes",
        register: "Registrar",
        registering: "Registrando...",
        registered: "Camera registrada",
        required: "Preencha os campos obrigatorios destacados.",
        lookupLoading: "Buscando endereco pelo CEP...",
        lookupFallback: "Nao foi possivel preencher o endereco automaticamente com esse CEP.",
        name: "Nome da camera",
        connectionMethod: "Metodo de conexao",
        ipAddress: "IP ou host",
        rtspPort: "Porta RTSP",
        manufacturer: "Fabricante",
        username: "Usuario",
        password: "Senha",
        channel: "Canal",
        subtype: "Subtype",
        webcamIndex: "Indice da webcam",
        zipCode: "CEP ou zipcode",
        street: "Rua",
        number: "Numero",
        city: "Cidade",
        state: "Estado",
        country: "Pais",
        retention: "Retencao",
        allowPublicAccess: "Compartilhar com colaboradores",
        shareInviteeHint: "Informe o nome de usuario ou email que deve receber acesso a esta camera.",
        shareInviteePlaceholder: "@usuario ou email",
      };
    }
    if (key === "es") {
      return {
        title: "Registro de la camara",
        connection: "Conexion",
        address: "Direccion",
        options: "Opciones",
        register: "Registrar",
        registering: "Registrando...",
        registered: "Camara registrada",
        required: "Completa los campos obligatorios marcados.",
        lookupLoading: "Buscando la direccion por codigo postal...",
        lookupFallback: "No se pudo completar la direccion automaticamente con ese codigo postal.",
        name: "Nombre de la camara",
        connectionMethod: "Metodo de conexion",
        ipAddress: "IP o host",
        rtspPort: "Puerto RTSP",
        manufacturer: "Fabricante",
        username: "Usuario",
        password: "Contrasena",
        channel: "Canal",
        subtype: "Subtype",
        webcamIndex: "Indice de la webcam",
        zipCode: "Codigo postal o zipcode",
        street: "Calle",
        number: "Numero",
        city: "Ciudad",
        state: "Estado",
        country: "Pais",
        retention: "Retencion",
        allowPublicAccess: "Compartir con colaboradores",
        shareInviteeHint: "Indica el usuario o correo que debe recibir acceso a esta camara.",
        shareInviteePlaceholder: "@usuario o correo",
      };
    }
    if (key === "fr") {
      return {
        title: "Enregistrement de la camera",
        connection: "Connexion",
        address: "Adresse",
        options: "Options",
        register: "Enregistrer",
        registering: "Enregistrement...",
        registered: "Camera enregistree",
        required: "Remplissez les champs obligatoires mis en evidence.",
        lookupLoading: "Recherche de l'adresse via le code postal...",
        lookupFallback: "Impossible de remplir automatiquement l'adresse avec ce code postal.",
        name: "Nom de la camera",
        connectionMethod: "Methode de connexion",
        ipAddress: "IP ou hote",
        rtspPort: "Port RTSP",
        manufacturer: "Fabricant",
        username: "Nom d'utilisateur",
        password: "Mot de passe",
        channel: "Canal",
        subtype: "Subtype",
        webcamIndex: "Indice de la webcam",
        zipCode: "Code postal ou zipcode",
        street: "Rue",
        number: "Numero",
        city: "Ville",
        state: "Etat",
        country: "Pays",
        retention: "Retention",
        allowPublicAccess: "Partager avec des collaborateurs",
        shareInviteeHint: "Indiquez le nom d'utilisateur ou l'email qui doit recevoir l'acces a cette camera.",
        shareInviteePlaceholder: "@utilisateur ou email",
      };
    }
    return {
      title: "Camera registration",
      connection: "Connection",
      address: "Address",
      options: "Options",
      register: "Register",
      registering: "Registering...",
      registered: "Camera registered",
      required: "Fill in the highlighted required fields.",
      lookupLoading: "Looking up the address from the postal code...",
      lookupFallback: "The postal code could not auto-fill the address.",
      name: "Camera name",
      connectionMethod: "Connection method",
      ipAddress: "IP or host",
      rtspPort: "RTSP port",
      manufacturer: "Manufacturer",
      username: "Username",
      password: "Password",
      channel: "Channel",
      subtype: "Subtype",
      webcamIndex: "Webcam index",
      zipCode: "ZIP code or zipcode",
      street: "Street",
      number: "Number",
      city: "City",
      state: "State",
      country: "Country",
      retention: "Retention",
      allowPublicAccess: "Share with collaborators",
      shareInviteeHint: "Enter the username or email that should receive access to this camera.",
      shareInviteePlaceholder: "@username or email",
    };
  }, [key]);
}

function inputClass(hasError: boolean) {
  return `w-full rounded-2xl border bg-black/20 px-3 py-2.5 text-sm text-white outline-none transition ${
    hasError
      ? "border-rose-400/70 focus:border-rose-300"
      : "border-white/10 focus:border-sky-300/70"
  }`;
}

function sectionTitle(title: string) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-200/80">
      <span className="h-px flex-1 bg-white/10" />
      <span>{title}</span>
      <span className="h-px flex-1 bg-white/10" />
    </div>
  );
}

export default function ChatCameraRegistrationCard({
  messageId,
  metadata,
  onSubmit,
}: Props) {
  const copy = useCardCopy(metadata.language);
  const metadataDraftKey = useMemo(() => JSON.stringify(metadata.draft || {}), [metadata.draft]);
  const [form, setForm] = useState<CameraRegistrationFormData>(() => normalizeFormDraft(metadata.draft));
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lookupState, setLookupState] = useState<{
    status: "idle" | "loading" | "error";
    message: string | null;
  }>({ status: "idle", message: null });
  const lookupRequestIdRef = useRef(0);

  useEffect(() => {
    setForm(normalizeFormDraft(metadata.draft));
    setErrors({});
    setSubmitError(null);
    setIsSubmitting(false);
  }, [messageId, metadata.status, metadata.created_camera_id, metadataDraftKey]);

  useEffect(() => {
    if (metadata.status !== "awaiting_confirmation") {
      return;
    }

    const countryCode = normalizeCountryCode(form.country, null);
    const normalizedPostalCode = normalizePostalCodeForLookup(form.zip_code, countryCode);

    if (!isPostalCodeReadyForLookup(normalizedPostalCode, countryCode)) {
      setLookupState({ status: "idle", message: null });
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      const requestId = ++lookupRequestIdRef.current;
      setLookupState({ status: "loading", message: copy.lookupLoading });

      try {
        const response = await fetch("/api/address-lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            postal_code: normalizedPostalCode,
            country: form.country || undefined,
          }),
        });
        const result = (await response.json().catch(() => ({}))) as AddressLookupResponse & {
          error?: string;
        };

        if (requestId !== lookupRequestIdRef.current) {
          return;
        }

        if (!response.ok || !result.found) {
          setLookupState({
            status: "error",
            message: result.message || result.error || copy.lookupFallback,
          });
          return;
        }

        setForm((current) => ({
          ...current,
          zip_code: result.postal_code || current.zip_code,
          street: result.street || current.street,
          city: result.city || current.city,
          state: result.state || current.state,
          country: result.country || current.country,
        }));
        setErrors((current) => {
          const next = { ...current };
          delete next.zip_code;
          if (result.street) delete next.street;
          if (result.city) delete next.city;
          if (result.state) delete next.state;
          if (result.country) delete next.country;
          return next;
        });
        setLookupState({ status: "idle", message: null });
      } catch (error) {
        if (requestId !== lookupRequestIdRef.current) {
          return;
        }
        setLookupState({
          status: "error",
          message: error instanceof Error ? error.message : copy.lookupFallback,
        });
      }
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [copy.lookupFallback, copy.lookupLoading, form.country, form.zip_code, metadata.status]);

  const isRegistered = metadata.status === "registered";
  const isWebcam = form.connection_method === "WEBCAM";

  const handleSubmit = async () => {
    const nextErrors = buildErrors(form);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      setSubmitError(copy.required);
      return;
    }

    setErrors({});
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      await onSubmit(messageId, buildSubmitPayload(form));
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : copy.required);
    } finally {
      setIsSubmitting(false);
    }
  };

  const setField = <K extends keyof CameraRegistrationFormData>(
    key: K,
    value: CameraRegistrationFormData[K]
  ) => {
    if (submitError) {
      setSubmitError(null);
    }
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key as string]) {
        return current;
      }
      const next = { ...current };
      delete next[key as string];
      return next;
    });
  };

  return (
    <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(56,74,96,0.32),rgba(15,18,28,0.55))] p-4 shadow-[0_26px_80px_-44px_rgba(0,0,0,0.9)]">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">{copy.title}</p>
          <p className="mt-1 text-xs text-slate-300">
            {isRegistered ? copy.registered : copy.required}
          </p>
        </div>
        {isRegistered ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-medium text-emerald-200">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {copy.registered}
          </span>
        ) : null}
      </div>

      <div className="space-y-4">
        {sectionTitle(copy.connection)}
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs text-slate-300">{copy.name}</span>
            <input
              value={form.name}
              disabled={isRegistered}
              onChange={(e) => setField("name", e.target.value)}
              className={inputClass(!!errors.name)}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs text-slate-300">{copy.connectionMethod}</span>
            <select
              value={form.connection_method}
              disabled={isRegistered}
              onChange={(e) => setField("connection_method", e.target.value as CameraRegistrationFormData["connection_method"])}
              className={inputClass(!!errors.connection_method)}
            >
              <option value="RTSP">RTSP</option>
              <option value="HTTP">HTTP</option>
              <option value="ONVIF">ONVIF</option>
              <option value="WEBCAM">WEBCAM</option>
            </select>
          </label>

          {isWebcam ? (
            <label className="block md:col-span-2">
              <span className="mb-1.5 block text-xs text-slate-300">{copy.webcamIndex}</span>
              <input
                type="number"
                value={form.webcam_index ?? ""}
                disabled={isRegistered}
                onChange={(e) => setField("webcam_index", e.target.value ? Number.parseInt(e.target.value, 10) : null)}
                className={inputClass(!!errors.webcam_index)}
              />
            </label>
          ) : (
            <>
              <label className="block">
                <span className="mb-1.5 block text-xs text-slate-300">{copy.ipAddress}</span>
                <input
                  value={form.ip_address}
                  disabled={isRegistered}
                  onChange={(e) => setField("ip_address", e.target.value)}
                  className={inputClass(!!errors.ip_address)}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs text-slate-300">{copy.rtspPort}</span>
                <input
                  value={form.rtsp_port}
                  disabled={isRegistered}
                  onChange={(e) => setField("rtsp_port", e.target.value)}
                  className={inputClass(!!errors.rtsp_port)}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs text-slate-300">{copy.manufacturer}</span>
                <input
                  value={form.manufacturer}
                  disabled={isRegistered}
                  onChange={(e) => setField("manufacturer", e.target.value)}
                  className={inputClass(!!errors.manufacturer)}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs text-slate-300">{copy.username}</span>
                <input
                  value={form.username}
                  disabled={isRegistered}
                  onChange={(e) => setField("username", e.target.value)}
                  className={inputClass(!!errors.username)}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs text-slate-300">{copy.password}</span>
                <input
                  type="password"
                  value={form.password}
                  disabled={isRegistered}
                  onChange={(e) => setField("password", e.target.value)}
                  className={inputClass(!!errors.password)}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs text-slate-300">{copy.channel}</span>
                <input
                  value={form.channel}
                  disabled={isRegistered}
                  onChange={(e) => setField("channel", e.target.value)}
                  className={inputClass(false)}
                />
              </label>
              <label className="block md:col-span-2">
                <span className="mb-1.5 block text-xs text-slate-300">{copy.subtype}</span>
                <input
                  value={form.subtype}
                  disabled={isRegistered}
                  onChange={(e) => setField("subtype", e.target.value)}
                  className={inputClass(false)}
                />
              </label>
            </>
          )}
        </div>

        {sectionTitle(copy.address)}
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs text-slate-300">{copy.zipCode}</span>
            <input
              value={form.zip_code}
              disabled={isRegistered}
              onChange={(e) => setField("zip_code", e.target.value)}
              className={inputClass(!!errors.zip_code)}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs text-slate-300">{copy.country}</span>
            <input
              value={form.country}
              disabled={isRegistered}
              onChange={(e) => setField("country", e.target.value)}
              className={inputClass(!!errors.country)}
            />
          </label>
          <label className="block md:col-span-2">
            <span className="mb-1.5 block text-xs text-slate-300">{copy.street}</span>
            <input
              value={form.street}
              disabled={isRegistered}
              onChange={(e) => setField("street", e.target.value)}
              className={inputClass(!!errors.street)}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs text-slate-300">{copy.number}</span>
            <input
              value={form.number}
              disabled={isRegistered}
              onChange={(e) => setField("number", e.target.value)}
              className={inputClass(!!errors.number)}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs text-slate-300">{copy.city}</span>
            <input
              value={form.city}
              disabled={isRegistered}
              onChange={(e) => setField("city", e.target.value)}
              className={inputClass(!!errors.city)}
            />
          </label>
          <label className="block md:col-span-2">
            <span className="mb-1.5 block text-xs text-slate-300">{copy.state}</span>
            <input
              value={form.state}
              disabled={isRegistered}
              onChange={(e) => setField("state", e.target.value)}
              className={inputClass(!!errors.state)}
            />
          </label>
        </div>

        {lookupState.status !== "idle" ? (
          <div className={`flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs ${
            lookupState.status === "error"
              ? "border-amber-300/20 bg-amber-400/10 text-amber-100"
              : "border-sky-300/20 bg-sky-400/10 text-sky-100"
          }`}>
            {lookupState.status === "loading" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <MapPin className="h-3.5 w-3.5" />
            )}
            <span>{lookupState.message}</span>
          </div>
        ) : null}

        {sectionTitle(copy.options)}
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs text-slate-300">{copy.retention}</span>
            <select
              value={form.retention_days}
              disabled={isRegistered}
              onChange={(e) => setField("retention_days", Number.parseInt(e.target.value, 10) as CameraRegistrationFormData["retention_days"])}
              className={inputClass(false)}
            >
              {VALID_RETENTION_DAYS.map((day) => (
                <option key={day} value={day}>
                  {day}d
                </option>
              ))}
            </select>
          </label>

          <div className="md:col-span-2 space-y-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
            <div>
              <p className="text-sm font-medium text-slate-100">{copy.allowPublicAccess}</p>
              <p className="mt-1 text-xs text-slate-300">{copy.shareInviteeHint}</p>
            </div>
            <input
              value={form.shared_find_invitee_query}
              disabled={isRegistered}
              onChange={(e) => setField("shared_find_invitee_query", e.target.value)}
              placeholder={copy.shareInviteePlaceholder}
              className={inputClass(false)}
            />
          </div>
        </div>

        {submitError ? (
          <div className="rounded-2xl border border-rose-300/25 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">
            {submitError}
          </div>
        ) : null}

        {!isRegistered ? (
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 rounded-2xl border border-sky-300/25 bg-sky-400/15 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-sky-400/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isSubmitting ? copy.registering : copy.register}
          </button>
        ) : null}
      </div>
    </div>
  );
}
