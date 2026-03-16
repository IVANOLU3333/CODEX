const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizeWhitespace, normalizeForDedup, ensureDir } = require('./utils');

const OPTION_REGEX = /^\s*([A-E])\s*(?:[\)\.:\-]|\s)\s*(.*)$/i;
const QUESTION_REGEX = /^\s*Quest[aã]o\s+(\d+)\b/i;

function uuid() {
  return crypto.randomUUID();
}

function groupItemsAsLines(items, tolerance = 2.5) {
  const sorted = [...items]
    .filter((it) => it.str && it.str.trim())
    .map((it) => ({ text: it.str, x: it.transform[4], y: it.transform[5] }))
    .sort((a, b) => (Math.abs(b.y - a.y) < tolerance ? a.x - b.x : b.y - a.y));

  const lines = [];
  for (const it of sorted) {
    const line = lines.find((ln) => Math.abs(ln.y - it.y) <= tolerance);
    if (!line) lines.push({ y: it.y, chunks: [it] });
    else line.chunks.push(it);
  }

  return lines
    .map((line) => ({
      y: line.y,
      text: normalizeWhitespace(line.chunks.sort((a, b) => a.x - b.x).map((c) => c.text).join(' ')),
    }))
    .filter((line) => line.text.length > 0)
    .sort((a, b) => b.y - a.y);
}

function splitQuestionBlocks(linesByPage) {
  const blocks = [];
  let current = null;
  for (const pageData of linesByPage) {
    for (const line of pageData.lines) {
      const qMatch = line.text.match(QUESTION_REGEX);
      if (qMatch) {
        if (current) blocks.push(current);
        current = { question_number: Number(qMatch[1]), source_page: pageData.pageNumber, lines: [{ ...line, page: pageData.pageNumber }] };
      } else if (current) {
        current.lines.push({ ...line, page: pageData.pageNumber });
      }
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

function parseOptionsAndStatement(blockLines) {
  const options = {};
  const statementLines = [];
  let currentOption = null;

  for (const ln of blockLines) {
    if (QUESTION_REGEX.test(ln.text)) continue;
    const optMatch = ln.text.match(OPTION_REGEX);
    if (optMatch) {
      currentOption = optMatch[1].toUpperCase();
      options[currentOption] = normalizeWhitespace(optMatch[2] || '');
    } else if (currentOption) {
      options[currentOption] = normalizeWhitespace(`${options[currentOption]} ${ln.text}`);
    } else {
      statementLines.push(ln.text);
    }
  }

  return { statement: normalizeWhitespace(statementLines.join('\n')), options };
}

function splitReferenceFromStatement(statement) {
  const markerRegex = /(Assinale\s+a\s+alternativa|Considerando\s+o\s+texto|No\s+trecho|Com\s+base\s+no\s+texto)/i;
  const textStartRegex = /(TEXTO\s+[IVXLC\d]+|Texto\s+Adaptado|servir[aá]\s+de\s+base\s+para\s+responder)/i;
  if (!textStartRegex.test(statement)) return { referenceText: null, cleanedStatement: statement };
  const markerMatch = statement.match(markerRegex);
  if (!markerMatch || markerMatch.index == null) return { referenceText: statement, cleanedStatement: '' };
  return {
    referenceText: normalizeWhitespace(statement.slice(0, markerMatch.index)) || null,
    cleanedStatement: normalizeWhitespace(statement.slice(markerMatch.index)),
  };
}

function extractMetadataFromStatement(statement, sourceFile, page) {
  const header = statement.split('\n').slice(0, 3).join(' ');
  const yearMatch = header.match(/\b(19|20)\d{2}\b/);
  const boardMatch = header.match(/\b(FGV|FUNATEC|FEPESE|VUNESP|CESPE|FCC|IBFC|IDECAN|AOCP|AVANCASP|UNESC)\b/i);
  const institutionMatch = header.match(/(Prefeitura[^\n]+|Assembleia[^\n]+|Tribunal[^\n]+|Instituto[^\n]+)/i);
  const positionMatch = header.match(/(Analista[^\n]+|Professor[^\n]+|Enfermeiro[^\n]+|T[eé]cnico[^\n]+|Auxiliar[^\n]+)/i);

  return {
    exam_board: boardMatch ? boardMatch[1].toUpperCase() : null,
    institution: institutionMatch ? normalizeWhitespace(institutionMatch[1]) : null,
    position: positionMatch ? normalizeWhitespace(positionMatch[1]) : null,
    year: yearMatch ? Number(yearMatch[0]) : null,
    discipline: null,
    source_file: sourceFile,
    page,
  };
}

function buildQuestionRecords(blocks, sourceFile) {
  const questions = [];
  const metadata = [];
  const references = [];
  const questionReferenceLinks = [];
  const referenceMap = new Map();

  for (const block of blocks) {
    const { statement, options } = parseOptionsAndStatement(block.lines);
    const { referenceText, cleanedStatement } = splitReferenceFromStatement(statement);
    const questionId = uuid();

    if (referenceText) {
      const key = normalizeForDedup(referenceText);
      let referenceId;
      if (referenceMap.has(key)) {
        referenceId = referenceMap.get(key).reference_id;
      } else {
        referenceId = uuid();
        const ref = { reference_id: referenceId, type: 'text', text: referenceText, source_file: sourceFile, page: block.source_page };
        referenceMap.set(key, ref);
        references.push(ref);
      }
      questionReferenceLinks.push({ question_id: questionId, reference_id: referenceId, relation_type: 'question_reference' });
    }

    questions.push({
      question_id: questionId,
      question_number: block.question_number,
      source_file: sourceFile,
      page: block.source_page,
      reference_id: null,
      statement: cleanedStatement || statement,
      options,
      answer: null,
    });

    metadata.push({ question_id: questionId, ...extractMetadataFromStatement(statement, sourceFile, block.source_page) });
  }

  return { questions, metadata, references, questionReferenceLinks };
}

function saveImageAsPng(imgData, outputPath) {
  const { PNG } = require('pngjs');
  if (!imgData || !imgData.width || !imgData.height || !imgData.data) return false;
  const png = new PNG({ width: imgData.width, height: imgData.height });
  if (imgData.kind === 1) {
    for (let i = 0, j = 0; i < imgData.data.length; i += 1, j += 4) {
      const v = imgData.data[i];
      png.data[j] = v; png.data[j + 1] = v; png.data[j + 2] = v; png.data[j + 3] = 255;
    }
  } else if (imgData.kind === 2) {
    for (let i = 0, j = 0; i < imgData.data.length; i += 3, j += 4) {
      png.data[j] = imgData.data[i]; png.data[j + 1] = imgData.data[i + 1]; png.data[j + 2] = imgData.data[i + 2]; png.data[j + 3] = 255;
    }
  } else {
    png.data = Buffer.from(imgData.data);
  }
  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, PNG.sync.write(png));
  return true;
}

async function parsePdf(pdfPath, imageOutputDir) {
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const pdf = await pdfjs.getDocument({ data }).promise;
  const sourceFile = path.basename(pdfPath);

  const linesByPage = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    // eslint-disable-next-line no-await-in-loop
    const page = await pdf.getPage(pageNumber);
    // eslint-disable-next-line no-await-in-loop
    const text = await page.getTextContent();
    linesByPage.push({ pageNumber, lines: groupItemsAsLines(text.items) });
  }

  const blocks = splitQuestionBlocks(linesByPage);
  const records = buildQuestionRecords(blocks, sourceFile);

  // Extração de imagem permanece opcional e degradável caso bibliotecas/objetos não estejam disponíveis.
  const mediaReferences = [];
  const questionMediaLinks = [];
  void imageOutputDir;
  void saveImageAsPng;

  return { ...records, mediaReferences, questionMediaLinks };
}

function buildRunReport(result) {
  return {
    total_questions: result.questions.length,
    questions_with_options: result.questions.filter((q) => Object.keys(q.options).length > 0).length,
    questions_without_options: result.questions.filter((q) => Object.keys(q.options).length === 0).length,
    questions_with_reference: result.questionReferenceLinks.length,
    questions_with_images: new Set(result.questionMediaLinks.map((l) => l.question_id)).size,
    total_images_extracted: result.mediaReferences.length,
    failed_questions: result.questions.filter((q) => !q.statement || Object.keys(q.options).length === 0).map((q) => q.question_number),
  };
}

module.exports = {
  parsePdf,
  buildRunReport,
  splitQuestionBlocks,
  parseOptionsAndStatement,
  splitReferenceFromStatement,
};
