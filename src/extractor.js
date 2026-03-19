const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizeWhitespace, normalizeForDedup, ensureDir } = require('./utils');

const OPTION_REGEX = /^\s*([A-E])\s*(?:[\)\.:\-]|\s)\s*(.*)$/i;
const QUESTION_REGEX = /^\s*Quest[aã]o\s+(\d+)\b/i;
const ANSWER_TOKEN_REGEX = /(\d{1,3})\s*[\).:\-]?\s*([A-E])\b/gi;
const COMMAND_REGEX = /^(assinale|marque|indique|julgue|considerando|com\s+base|no\s+trecho|de\s+acordo|acerca|observe|analise|leia|quanto|sobre|a\s+partir)/i;
const REFERENCE_HINT_REGEX = /(texto\s+[ivxlcdm\d]+|texto\s+adaptado|o\s+texto\s+seguinte|leia\s+o\s+texto|considere\s+o\s+texto|utilize\s+o\s+texto|servir[aá]\s+de\s+base|charge|tirinha|imagem|gr[aá]fico|tabela|quadrinho)/i;
const ANSWER_SECTION_REGEX = /(gabarito|respostas?\s+das\s+quest[õo]es?|quest[õo]es\s+comentadas?\s*\/\s*gabarito|alternativa\s+correta)/i;
const BOARD_REGEX = /\b(FGV|FUNATEC|FEPESE|VUNESP|CESPE|CEBRASPE|FCC|IBFC|IDECAN|AOCP|AVANCASP|UNESC|FGV\s+CONHECIMENTO)\b/i;
const DISCIPLINE_REGEX = /\b(Portugu[eê]s|Matem[aá]tica|Inform[aá]tica|Direito(?:\s+[A-Za-zÀ-ÿ]+)?|Conhecimentos\s+Gerais|Legisla[cç][aã]o|Hist[oó]ria|Geografia|Atualidades|Racioc[ií]nio\s+L[oó]gico|Ci[eê]ncias|Biologia|F[ií]sica|Qu[ií]mica|Enfermagem|Pedagogia|Psicologia|Medicina|Odontologia|Letras\s*-\s*[A-Za-zÀ-ÿ]+|Engenharia(?:\s+[A-Za-zÀ-ÿ]+)?)\b/i;
const POSITION_REGEX = /(Analista[^\n]*|Professor[^\n]*|Enfermeiro[^\n]*|T[eé]cnico[^\n]*|Auxiliar[^\n]*|Fiscal[^\n]*|Agente[^\n]*|Escritur[aá]rio[^\n]*|Odont[oó]logo[^\n]*|M[eé]dico[^\n]*|Cuidador[^\n]*|Eletricista[^\n]*|Motorista[^\n]*|Assistente[^\n]*)/i;
const INSTITUTION_REGEX = /(Prefeitura[^\n]*|Assembleia[^\n]*|Tribunal[^\n]*|Instituto[^\n]*|C[aâ]mara[^\n]*|Secretaria[^\n]*|Universidade[^\n]*|Servi[cç]o\s+Aut[oô]nomo[^\n]*)/i;
const TRAILING_ID_REGEX = /\s+\d{7,}\s*$/;

function uuid() {
  return crypto.randomUUID();
}

function cleanContentLine(text) {
  return normalizeWhitespace(text)
    .replace(TRAILING_ID_REGEX, '')
    .replace(/^[-–—]\s*/, '')
    .trim();
}

function isNoiseLine(text) {
  if (!text) return true;
  if (/^\d{7,}$/.test(text)) return true;
  if (/essa\s+quest[aã]o\s+possui\s+coment[aá]rio/i.test(text)) return true;
  if (/^p[aá]gina\s+\d+/i.test(text)) return true;
  return false;
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
      text: cleanContentLine(line.chunks.sort((a, b) => a.x - b.x).map((c) => c.text).join(' ')),
    }))
    .filter((line) => line.text.length > 0 && !isNoiseLine(line.text))
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

function isMetadataLine(text) {
  if (!text) return false;
  if (/^(quest[õo]es\s+oficiais|n[ií]vel\s+superior|executivo\s*\(|educacional\s*\(|legislativo|letras\s*-|medicina|psicologia|sa[uú]de)\b/i.test(text)) return true;
  if (BOARD_REGEX.test(text) || INSTITUTION_REGEX.test(text) || POSITION_REGEX.test(text) || DISCIPLINE_REGEX.test(text)) return true;
  if (/^(19|20)\d{2}(\s+(19|20)\d{2})*$/.test(text)) return true;
  if (/^(?:[A-ZÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇ][A-Za-zÀ-ÿ/()\-]+\s*){1,6}$/.test(text) && text.length < 80 && !/[.!?]/.test(text)) return true;
  return false;
}

function parseOptions(blockLines) {
  const options = {};
  let currentOption = null;
  let firstOptionIndex = -1;

  blockLines.forEach((ln, index) => {
    if (QUESTION_REGEX.test(ln.text)) return;
    const optMatch = ln.text.match(OPTION_REGEX);
    if (optMatch) {
      if (firstOptionIndex === -1) firstOptionIndex = index;
      currentOption = optMatch[1].toUpperCase();
      options[currentOption] = cleanContentLine(optMatch[2] || '');
      return;
    }

    if (currentOption) {
      options[currentOption] = normalizeWhitespace(`${options[currentOption]} ${cleanContentLine(ln.text)}`);
    }
  });

  return { options, firstOptionIndex };
}

function splitPreOptionSections(preOptionLines) {
  const filtered = preOptionLines
    .map((line) => ({ ...line, text: cleanContentLine(line.text) }))
    .filter((line) => line.text && !QUESTION_REGEX.test(line.text) && !isNoiseLine(line.text));

  const metadataLines = [];
  let cursor = 0;
  while (cursor < filtered.length && isMetadataLine(filtered[cursor].text)) {
    metadataLines.push(filtered[cursor].text);
    cursor += 1;
  }

  const contentLines = filtered.slice(cursor).map((line) => line.text);
  if (contentLines.length === 0) {
    return { metadataLines, referenceLines: [], statementLines: [] };
  }

  let statementStart = contentLines.findIndex((line) => COMMAND_REGEX.test(line));
  if (statementStart === -1 && REFERENCE_HINT_REGEX.test(contentLines.join('\n'))) {
    statementStart = contentLines.findIndex((line, idx) => idx > 0 && COMMAND_REGEX.test(line));
  }

  if (statementStart === -1) {
    const fallbackIdx = Math.max(contentLines.length - 2, 0);
    statementStart = fallbackIdx;
  }

  const beforeStatement = contentLines.slice(0, statementStart);
  const statementLines = contentLines.slice(statementStart);

  const referenceLines = beforeStatement.filter((line) => !isMetadataLine(line));
  const extraMetadata = beforeStatement.filter((line) => isMetadataLine(line));

  return {
    metadataLines: metadataLines.concat(extraMetadata),
    referenceLines,
    statementLines,
  };
}

function parseOptionsAndStatement(blockLines) {
  const { options, firstOptionIndex } = parseOptions(blockLines);
  const preOptionLines = firstOptionIndex === -1 ? blockLines : blockLines.slice(0, firstOptionIndex);
  const { metadataLines, referenceLines, statementLines } = splitPreOptionSections(preOptionLines);

  return {
    metadataLines,
    referenceLines,
    statement: normalizeWhitespace(statementLines.join('\n')),
    options,
  };
}

function splitReferenceFromParts(referenceLines) {
  const referenceText = normalizeWhitespace(referenceLines.join('\n'));
  return referenceText || null;
}

function collectMetadataCandidates(lines) {
  return normalizeWhitespace(lines.join(' '));
}

function extractMetadataFromLines(metadataLines, sourceFile, page) {
  const header = collectMetadataCandidates(metadataLines);
  const yearMatch = header.match(/\b(19|20)\d{2}\b/);
  const boardMatch = header.match(BOARD_REGEX);
  const institutionMatch = header.match(INSTITUTION_REGEX);
  const positionMatch = header.match(POSITION_REGEX);
  const disciplineMatch = header.match(DISCIPLINE_REGEX);

  return {
    exam_board: boardMatch ? normalizeWhitespace(boardMatch[1].replace(/\s+CONHECIMENTO/i, '')) : null,
    institution: institutionMatch ? normalizeWhitespace(institutionMatch[1]) : null,
    position: positionMatch ? normalizeWhitespace(positionMatch[1]) : null,
    year: yearMatch ? Number(yearMatch[0]) : null,
    discipline: disciplineMatch ? normalizeWhitespace(disciplineMatch[1]) : null,
    source_file: sourceFile,
    page,
  };
}

function extractAnswerKey(linesByPage) {
  const answerMap = new Map();
  const candidatePages = linesByPage.slice(Math.max(linesByPage.length - 6, 0));

  for (const page of candidatePages) {
    const pageText = page.lines.map((line) => line.text).join('\n');
    if (!ANSWER_SECTION_REGEX.test(pageText) && !/\b1\s*[\).:\-]?\s*[A-E]\b/i.test(pageText)) continue;

    const normalized = pageText.replace(/\n/g, ' ');
    let match;
    // eslint-disable-next-line no-cond-assign
    while ((match = ANSWER_TOKEN_REGEX.exec(normalized)) !== null) {
      const qNum = Number(match[1]);
      const answer = match[2].toUpperCase();
      if (qNum > 0 && qNum <= 500) {
        answerMap.set(qNum, answer);
      }
    }
  }

  return answerMap;
}

function buildQuestionRecords(blocks, sourceFile, answerMap = new Map()) {
  const questions = [];
  const metadata = [];
  const references = [];
  const questionReferenceLinks = [];
  const referenceMap = new Map();

  for (const block of blocks) {
    const { metadataLines, referenceLines, statement, options } = parseOptionsAndStatement(block.lines);
    const referenceText = splitReferenceFromParts(referenceLines);
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
      statement,
      options,
      answer: answerMap.get(block.question_number) || null,
    });

    metadata.push({ question_id: questionId, ...extractMetadataFromLines(metadataLines, sourceFile, block.source_page) });
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
  const answerMap = extractAnswerKey(linesByPage);
  const records = buildQuestionRecords(blocks, sourceFile, answerMap);

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
  splitReferenceFromParts,
  extractAnswerKey,
  extractMetadataFromLines,
};
