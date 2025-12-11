// Normalize to E.164 for North America (default +1)
// Accepts things like "2896819206", "1-289-681-9206", "+1 (289) 681-9206"
const normalizePhone = (raw: string): string => {
  if (!raw) return raw;

  const trimmed = raw.trim();

  // If user already gave us +..., trust it
  if (trimmed.startsWith('+')) {
    return trimmed;
  }

  // Strip everything that's not a digit
  const digits = trimmed.replace(/\D/g, '');

  // 10 digits -> assume North America -> +1XXXXXXXXXX
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  // 11 digits starting with 1 -> +1XXXXXXXXXX
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  // Fallback: return original trimmed (at least Twilio will log an error)
  return trimmed;
};
