const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizeWhitespace, normalizeForDedup, ensureDir } = require('./utils');

const OPTION_REGEX = /^\s*([A-E])\s*(?:[\)\.:\-]|\s)\s*(.*)$/i;
const QUESTION_REGEX = /^\s*Quest[aã]o\s+(\d+)\b/i;
const ANSWER_TOKEN_REGEX = /(\d{1,3})\s*[\).:\-]?\s*([A-E])\b/gi;
const ANSWER_SECTION_REGEX = /(gabarito|respostas?\s+das\s+quest[õo]es?|quest[õo]es\s+comentadas?\s*\/\s*gabarito|alternativa\s+correta)/i;
const BOARD_REGEX = /\b(FGV|FUNATEC|FEPESE|VUNESP|CESPE|CEBRASPE|FCC|IBFC|IDECAN|AOCP|AVANCASP|UNESC|FGV\s+CONHECIMENTO)\b/i;
const DISCIPLINE_REGEX = /\b(Portugu[eê]s|Matem[aá]tica|Inform[aá]tica|Direito(?:\s+[A-Za-zÀ-ÿ]+)?|Conhecimentos\s+Gerais|Legisla[cç][aã]o|Hist[oó]ria|Geografia|Atualidades|Racioc[ií]nio\s+L[oó]gico|Ci[eê]ncias|Biologia|F[ií]sica|Qu[ií]mica|Enfermagem|Pedagogia|Psicologia|Medicina|Odontologia|Desenho\s+T[eé]cnico|Letras\s*-\s*[A-Za-zÀ-ÿ]+|Engenharia(?:\s+[A-Za-zÀ-ÿ]+)?)\b/i;
const POSITION_REGEX = /(Analista[^\n]*|Professor[^\n]*|Enfermeiro[^\n]*|T[eé]cnico[^\n]*|Auxiliar[^\n]*|Fiscal[^\n]*|Agente[^\n]*|Escritur[aá]rio[^\n]*|Odont[oó]logo[^\n]*|M[eé]dico[^\n]*|Cuidador[^\n]*|Eletricista[^\n]*|Motorista[^\n]*|Assistente[^\n]*)/i;
const INSTITUTION_REGEX = /(Prefeitura[^\n]*|Assembleia[^\n]*|Tribunal[^\n]*|Instituto[^\n]*|C[aâ]mara[^\n]*|Secretaria[^\n]*|Universidade[^\n]*|Servi[cç]o\s+Aut[oô]nomo[^\n]*)/i;
const METADATA_HINT_REGEX = /(quest[õo]es\s+oficiais|n[ií]vel\s+superior|executivo\s*\(|educacional\s*\(|legislativo|sa[uú]de|medicina|psicologia|letras\s*-|administrativa\/geral)/i;
const BODY_MARKER_REGEX = /^(TEXTO\s+[IVXLCDM\d]+|Texto\s+Adaptado|ATEN[CÇ][AÃ]O:|Leia\s+o\s+texto|Observe\s+o\s+texto)/i;
const PROMPT_HINT_REGEX = /(?:assinale|marque|indique|julgue|considerando|com\s+base|de\s+acordo|acerca|analise|nesse\s+caso|pode-se|pode\s+afirmar|a\s+alternativa|est[aá]\s+correta|est[aá]\s+incorreta|o\s+problema|quanto\s+ao\s+texto|sobre\s+a\s+linguagem|na\s+situa[cç][aã]o|corretamente|incorretamente)/i;
const TRAILING_ID_REGEX = /\s+\d{7,}\s*$/;
const FOOTER_ID_REGEX = /^\d{8,}$/;

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
  if (FOOTER_ID_REGEX.test(text)) return true;
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
  if (BOARD_REGEX.test(text) || INSTITUTION_REGEX.test(text) || POSITION_REGEX.test(text) || DISCIPLINE_REGEX.test(text)) return true;
  if (METADATA_HINT_REGEX.test(text)) return true;
  if (/^(19|20)\d{2}(\s+(19|20)\d{2})*$/.test(text)) return true;
  if (/^(?:[A-ZÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇ][A-Za-zÀ-ÿ/()\-]+\s*){1,8}$/.test(text) && text.length < 90 && !/[.!?]/.test(text)) return true;
  return false;
}

function isPromptLine(text) {
  if (!text) return false;
  if (PROMPT_HINT_REGEX.test(text)) return true;
  if (/[:?]$/.test(text)) return true;
  if (/^(Nesse\s+caso|Com\s+base|De\s+acordo|Quanto\s+ao|Sobre\s+o|Acerca\s+de)/i.test(text)) return true;
  return false;
}

function isBodyMarkerLine(text) {
  return BODY_MARKER_REGEX.test(text || '');
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

function splitMetadataAndBody(preOptionLines) {
  const filtered = preOptionLines
    .map((line) => ({ ...line, text: cleanContentLine(line.text) }))
    .filter((line) => line.text && !QUESTION_REGEX.test(line.text) && !isNoiseLine(line.text));

  const metadataLines = [];
  let cursor = 0;
  while (cursor < filtered.length && isMetadataLine(filtered[cursor].text)) {
    metadataLines.push(filtered[cursor].text);
    cursor += 1;
  }

  return {
    metadataLines,
    bodyLines: filtered.slice(cursor).map((line) => line.text),
  };
}

function extractPromptFromBody(bodyLines) {
  if (bodyLines.length === 0) return { statement: '', referenceLines: [] };

  let promptStart = -1;
  for (let i = bodyLines.length - 1; i >= 0; i -= 1) {
    if (isPromptLine(bodyLines[i])) {
      promptStart = i;
    }
  }

  if (promptStart === -1) {
    const lastNonMarker = bodyLines.map((line, idx) => ({ line, idx })).filter(({ line }) => !isBodyMarkerLine(line));
    promptStart = lastNonMarker.length > 0 ? lastNonMarker[lastNonMarker.length - 1].idx : 0;
  }

  const statementLines = bodyLines.slice(promptStart).filter((line) => !isBodyMarkerLine(line) || bodyLines.length === 1);
  const statement = normalizeWhitespace(statementLines.join('\n'));
  const referenceLines = bodyLines;

  return { statement, referenceLines };
}

function parseQuestionContent(blockLines) {
  const { options, firstOptionIndex } = parseOptions(blockLines);
  const preOptionLines = firstOptionIndex === -1 ? blockLines : blockLines.slice(0, firstOptionIndex);
  const { metadataLines, bodyLines } = splitMetadataAndBody(preOptionLines);
  const { statement, referenceLines } = extractPromptFromBody(bodyLines);

  return {
    metadataLines,
    bodyLines,
    referenceLines,
    statement,
    options,
  };
}

function splitReferenceFromParts(referenceLines) {
  const referenceText = normalizeWhitespace(referenceLines.join('\n'));
  return referenceText || null;
}

function trimMetadataValue(value) {
  return normalizeWhitespace(value)
    .replace(BOARD_REGEX, '')
    .replace(/\bQuest[õo]es\s+oficiais\b/gi, '')
    .replace(/\b(N[ií]vel\s+Superior\s+em\s+Qualquer\s+[AÁ]rea|Executivo\s*\(Administrativa\/Geral\)|Legislativo|Educacional\s*\(Professores\)|Sa[uú]de\s*\([^)]*\))\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractMetadataFromLines(metadataLines, sourceFile, page) {
  const year = metadataLines.find((line) => /\b(19|20)\d{2}\b/.test(line));
  const boardLine = metadataLines.find((line) => BOARD_REGEX.test(line));
  const disciplineLine = metadataLines.find((line) => DISCIPLINE_REGEX.test(line) && line.length < 60);

  let institution = metadataLines.find((line) => INSTITUTION_REGEX.test(line)) || null;
  let position = metadataLines.find((line) => POSITION_REGEX.test(line)) || null;

  if (institution && position && institution === position) {
    position = null;
  }

  if (!institution) {
    const institutionCarrier = metadataLines.find((line) => INSTITUTION_REGEX.test(line));
    if (institutionCarrier) {
      const match = institutionCarrier.match(INSTITUTION_REGEX);
      institution = match ? match[1] : null;
    }
  }

  if (!position) {
    const positionCarrier = metadataLines.find((line) => POSITION_REGEX.test(line));
    if (positionCarrier) {
      const match = positionCarrier.match(POSITION_REGEX);
      position = match ? match[1] : null;
    }
  }

  return {
    exam_board: boardLine ? boardLine.match(BOARD_REGEX)[1].replace(/\s+CONHECIMENTO/i, '') : null,
    institution: institution ? trimMetadataValue(institution) : null,
    position: position ? trimMetadataValue(position) : null,
    year: year ? Number(year.match(/\b(19|20)\d{2}\b/)[0]) : null,
    discipline: disciplineLine ? disciplineLine.match(DISCIPLINE_REGEX)[1] : null,
    source_file: sourceFile,
    page,
  };
}

function extractAnswerKey(linesByPage) {
  const answerMap = new Map();
  const candidatePages = linesByPage.slice(Math.max(linesByPage.length - 8, 0));

  for (const page of candidatePages) {
    const pageText = page.lines.map((line) => line.text).join('\n');
    if (!ANSWER_SECTION_REGEX.test(pageText) && !/\b1\s*[\).:\-]?\s*[A-E]\b/i.test(pageText)) continue;

    const normalized = pageText.replace(/\n/g, ' ');
    let match;
    // eslint-disable-next-line no-cond-assign
    while ((match = ANSWER_TOKEN_REGEX.exec(normalized)) !== null) {
      const qNum = Number(match[1]);
      const answer = match[2].toUpperCase();
      if (qNum > 0 && qNum <= 500) answerMap.set(qNum, answer);
    }
  }

  return answerMap;
}

function getQuestionPageRanges(block) {
  const pageRanges = new Map();
  for (const ln of block.lines) {
    if (!pageRanges.has(ln.page)) {
      pageRanges.set(ln.page, { minY: ln.y, maxY: ln.y });
      continue;
    }
    const range = pageRanges.get(ln.page);
    range.minY = Math.min(range.minY, ln.y);
    range.maxY = Math.max(range.maxY, ln.y);
  }
  return pageRanges;
}

function multiplyTransform(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

async function getImageDataByName(page, name) {
  return new Promise((resolve) => {
    page.objs.get(name, (imgData) => resolve(imgData));
  });
}

async function extractImagesFromPage(page, pdfjs) {
  const opList = await page.getOperatorList();
  const { OPS } = pdfjs;
  const images = [];
  let transform = [1, 0, 0, 1, 0, 0];
  const stack = [];

  for (let i = 0; i < opList.fnArray.length; i += 1) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];

    if (fn === OPS.save) {
      stack.push([...transform]);
      continue;
    }
    if (fn === OPS.restore) {
      transform = stack.pop() || [1, 0, 0, 1, 0, 0];
      continue;
    }
    if (fn === OPS.transform) {
      transform = multiplyTransform(transform, args);
      continue;
    }
    if (fn === OPS.paintInlineImageXObject) {
      images.push({ imgData: args[0], x: transform[4], y: transform[5], width: Math.abs(transform[0]), height: Math.abs(transform[3]) });
      continue;
    }
    if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject) {
      // eslint-disable-next-line no-await-in-loop
      const imgData = await getImageDataByName(page, args[0]);
      if (imgData) {
        images.push({ imgData, x: transform[4], y: transform[5], width: Math.abs(transform[0]), height: Math.abs(transform[3]) });
      }
    }
  }

  return images;
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

function buildQuestionRecords(blocks, sourceFile, answerMap = new Map()) {
  const questions = [];
  const metadata = [];
  const references = [];
  const questionReferenceLinks = [];
  const referenceMap = new Map();

  for (const block of blocks) {
    const { metadataLines, referenceLines, statement, options } = parseQuestionContent(block.lines);
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

async function parsePdf(pdfPath, imageOutputDir) {
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const pdf = await pdfjs.getDocument({ data }).promise;
  const sourceFile = path.basename(pdfPath);

  const linesByPage = [];
  const imagesByPage = new Map();
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    // eslint-disable-next-line no-await-in-loop
    const page = await pdf.getPage(pageNumber);
    // eslint-disable-next-line no-await-in-loop
    const text = await page.getTextContent();
    linesByPage.push({ pageNumber, lines: groupItemsAsLines(text.items) });
    // eslint-disable-next-line no-await-in-loop
    imagesByPage.set(pageNumber, await extractImagesFromPage(page, pdfjs));
  }

  const blocks = splitQuestionBlocks(linesByPage);
  const answerMap = extractAnswerKey(linesByPage);
  const records = buildQuestionRecords(blocks, sourceFile, answerMap);

  const mediaReferences = [];
  const questionMediaLinks = [];
  const imageMap = new Map();
  let imageCounter = 1;

  blocks.forEach((block, index) => {
    const pageRanges = getQuestionPageRanges(block);
    for (const [pageNum, range] of pageRanges.entries()) {
      const pageImages = imagesByPage.get(pageNum) || [];
      pageImages.forEach((img) => {
        if (img.width < 40 || img.height < 40) return;
        if (img.y < range.minY - 80 || img.y > range.maxY + 220) return;
        const hash = `${img.imgData.width}x${img.imgData.height}-${img.imgData.data?.length || 0}-${img.x}-${img.y}`;
        let mediaId;
        let mediaPath;
        if (imageMap.has(hash)) {
          ({ mediaId, mediaPath } = imageMap.get(hash));
        } else {
          mediaId = uuid();
          mediaPath = `images/questions/img_${String(imageCounter).padStart(4, '0')}.png`;
          imageCounter += 1;
          const absPath = path.join(imageOutputDir, path.basename(mediaPath));
          if (!saveImageAsPng(img.imgData, absPath)) return;
          mediaReferences.push({ media_id: mediaId, type: 'image', path: mediaPath, source_file: sourceFile, page: pageNum });
          imageMap.set(hash, { mediaId, mediaPath });
        }

        if (!questionMediaLinks.some((link) => link.question_id === records.questions[index].question_id && link.media_id === mediaId)) {
          questionMediaLinks.push({ question_id: records.questions[index].question_id, media_id: mediaId, relation_type: 'question_image' });
        }
      });
    }
  });

  return { ...records, mediaReferences, questionMediaLinks };
}

function buildRunReport(result) {
  const processedFiles = result.processedFiles || [];
  const failedFiles = result.failedFiles || [];

  return {
    total_questions: result.questions.length,
    questions_with_options: result.questions.filter((q) => Object.keys(q.options).length > 0).length,
    questions_without_options: result.questions.filter((q) => Object.keys(q.options).length === 0).length,
    questions_with_reference: result.questionReferenceLinks.length,
    questions_with_images: new Set(result.questionMediaLinks.map((l) => l.question_id)).size,
    total_images_extracted: result.mediaReferences.length,
    processed_files: processedFiles.length,
    failed_files: failedFiles.length,
    file_failures: failedFiles,
    files: processedFiles,
    failed_questions: result.questions.filter((q) => !q.statement || Object.keys(q.options).length === 0).map((q) => q.question_number),
  };
}

module.exports = {
  parsePdf,
  buildRunReport,
  splitQuestionBlocks,
  parseQuestionContent,
  splitReferenceFromParts,
  extractAnswerKey,
  extractMetadataFromLines,
};
