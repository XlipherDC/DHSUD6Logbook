const organizationPattern = /(?:\b(inc\.?|incorporated|corp\.?|corporation|company|co\.?|development|developers?|realty|properties|property|government|city of|lgu|land|landholdings?|homes|housing|hotel|resort|estate|ventures?|enterprises?|association|afpmbai|afmmbai|megaworld|filinvest|profriends|smdc|geri|ggtt|pueblo|bank|bpi|university|authority|cooperative|foundation|premium|higher ground|compa(?:n|ñ)a|8990|csd|jjm)\b|&\s*sons\b)/i;
const hiddenDetailPattern = /^(remarks(?:\/changes)?|natureofalteration|or[_ ]?number|or[_ ]?datereceived|signature|tel\/cp)$/i;
const partyKeyPattern = /^(applicant|owner|authrep|developer)$/i;

export function isOrganization(value) {
  return organizationPattern.test(String(value || ""));
}

function surname(value) {
  const cleaned = String(value || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(?:sps?\.?|atty\.?|engr\.?|arch\.?|mr\.?|mrs\.?|ms\.?)\b/gi, " ")
    .replace(/[;,]+$/g, "")
    .trim();
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && /^(?:jr\.?|sr\.?|ii|iii|iv|v)$/i.test(tokens.at(-1))) tokens.pop();
  return (tokens.at(-1) || "").replace(/^[^\p{L}]+|[^\p{L}'’-]+$/gu, "");
}

export function sanitizeParty(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const slashParts = text.split(/\s+\/\s+/);
  if (slashParts.length > 1) {
    return slashParts.map((part) => sanitizeParty(part)).filter(Boolean).join(" / ");
  }
  if (isOrganization(text) || !/\s/.test(text)) return text;
  return surname(text);
}

export function sanitizeRecord(record) {
  const details = {};
  for (const [key, value] of Object.entries(record.details || {})) {
    if (hiddenDetailPattern.test(key)) continue;
    details[key] = partyKeyPattern.test(key) ? sanitizeParty(value) : value;
  }
  return {
    ...record,
    applicant: sanitizeParty(record.applicant),
    owner: sanitizeParty(record.owner),
    developer: sanitizeParty(record.developer),
    or_number: "",
    remarks: "",
    assigned_to: "",
    details,
  };
}

export function containsHiddenPublicFields(record) {
  return Boolean(record.or_number || record.remarks)
    || Object.keys(record.details || {}).some((key) => hiddenDetailPattern.test(key));
}
