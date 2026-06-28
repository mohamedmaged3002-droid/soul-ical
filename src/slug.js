// Matching/dedup key — lowercase, trim, collapse internal whitespace runs to one space.
function normalizeCode(code) {
  return String(code || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// URL/file-safe feed filename. ORIGINAL CASE preserved for recognizability:
// trim, collapse whitespace runs to a single '-', drop anything not [A-Za-z0-9._-].
function codeSlug(code) {
  return String(code || '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._-]/g, '');
}

module.exports = { normalizeCode, codeSlug };
