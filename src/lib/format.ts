/** Capitalize first letter of each word — "john smith" → "John Smith" */
export function properCase(str: string): string {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Format donor name as "Last, First" with proper capitalization */
export function formatDonorName(donor: { firstName: string; lastName: string } | null): string {
  if (!donor) return "—";
  return `${properCase(donor.lastName)}, ${properCase(donor.firstName)}`;
}

/** Format donor name as "First Last" with proper capitalization */
export function formatDonorFullName(donor: { firstName: string; lastName: string } | null): string {
  if (!donor) return "Unknown";
  return `${properCase(donor.firstName)} ${properCase(donor.lastName)}`;
}
