export const SECRET_RECOVERY_QUESTION_KEYS = [
  "first_pet",
  "childhood_street",
  "favorite_teacher",
  "first_school",
  "mother_birth_city",
] as const;

export type SecretRecoveryQuestionKey =
  (typeof SECRET_RECOVERY_QUESTION_KEYS)[number];

export const SECRET_RECOVERY_MAX_ANSWER_LENGTH = 200;

export const SECRET_RECOVERY_QUESTION_TRANSLATION_KEYS: Record<
  SecretRecoveryQuestionKey,
  string
> = {
  first_pet: "securityRecovery.question.firstPet",
  childhood_street: "securityRecovery.question.childhoodStreet",
  favorite_teacher: "securityRecovery.question.favoriteTeacher",
  first_school: "securityRecovery.question.firstSchool",
  mother_birth_city: "securityRecovery.question.motherBirthCity",
};

export function isSecretRecoveryQuestionKey(
  value: unknown
): value is SecretRecoveryQuestionKey {
  return (
    typeof value === "string" &&
    SECRET_RECOVERY_QUESTION_KEYS.includes(value as SecretRecoveryQuestionKey)
  );
}

export function normalizeSecretRecoveryQuestionKey(
  value: unknown
): SecretRecoveryQuestionKey | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return isSecretRecoveryQuestionKey(normalized) ? normalized : null;
}

export function normalizeSecretRecoveryAnswer(value: unknown): string {
  const raw =
    typeof value === "string"
      ? value
      : value === null || value === undefined
      ? ""
      : String(value);

  return raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function isValidSecretRecoveryAnswer(value: unknown): boolean {
  const normalized = normalizeSecretRecoveryAnswer(value);
  return (
    normalized.length >= 2 &&
    normalized.length <= SECRET_RECOVERY_MAX_ANSWER_LENGTH
  );
}
