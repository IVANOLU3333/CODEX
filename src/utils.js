const fs = require('fs');
const path = require('path');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

function normalizeWhitespace(text) {
  return (text || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function normalizeForDedup(text) {
  return normalizeWhitespace(text)
    .toLowerCase()
    .replace(/[“”"'`´]/g, '')
    .replace(/[.,;:!?()\[\]{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  ensureDir,
  writeJson,
  normalizeWhitespace,
  normalizeForDedup,
};
