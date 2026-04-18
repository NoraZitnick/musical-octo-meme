export function normalizeSchoolName(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeTown(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function stateOrEmpty(value) {
  return (value || "").trim().toUpperCase();
}

export function toLocalDateTimeInput(value) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
