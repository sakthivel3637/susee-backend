
const generateSlug = (text) => {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
};


const generateUniqueSlug = async (baseSlug, existsCallback) => {
  const cleanBaseSlug = generateSlug(baseSlug);

  if (!cleanBaseSlug) {
    return '';
  }

  let candidateSlug = cleanBaseSlug;
  let suffix = 1;

  while (await existsCallback(candidateSlug)) {
    candidateSlug = `${cleanBaseSlug}-${suffix}`;
    suffix += 1;
  }

  return candidateSlug;
};

module.exports = {
  generateSlug,
  generateUniqueSlug
};
