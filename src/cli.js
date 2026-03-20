#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { parsePdf, buildRunReport } = require('./extractor');
const { ensureDir, writeJson } = require('./utils');

function printUsage() {
  console.log([
    'Uso:',
    '  node src/cli.js                    # procura PDFs em input/ (recursivamente)',
    '  node src/cli.js arquivo.pdf        # processa um PDF específico',
    '  node src/cli.js pasta-com-pdfs     # processa PDFs de uma pasta (recursivamente)',
  ].join('\n'));
}

function collectPdfFiles(entryPath, seen = new Set()) {
  if (!fs.existsSync(entryPath)) return [];

  const resolved = path.resolve(entryPath);
  if (seen.has(resolved)) return [];
  seen.add(resolved);

  const stats = fs.statSync(resolved);
  if (stats.isFile()) {
    return resolved.toLowerCase().endsWith('.pdf') ? [resolved] : [];
  }

  if (!stats.isDirectory()) return [];

  const pdfFiles = [];
  const entries = fs.readdirSync(resolved, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  for (const entry of entries) {
    const childPath = path.join(resolved, entry.name);
    if (entry.isDirectory()) {
      pdfFiles.push(...collectPdfFiles(childPath, seen));
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
      pdfFiles.push(childPath);
    }
  }

  return pdfFiles;
}

function resolvePdfFiles(args, root) {
  if (args.length === 0) {
    return collectPdfFiles(path.join(root, 'input'));
  }

  const pdfFiles = [];
  const invalidEntries = [];

  for (const rawArg of args) {
    const target = path.resolve(root, rawArg);
    if (!fs.existsSync(target)) {
      invalidEntries.push({ target: rawArg, reason: 'caminho não encontrado' });
      continue;
    }

    const stats = fs.statSync(target);
    if (stats.isFile()) {
      if (target.toLowerCase().endsWith('.pdf')) {
        pdfFiles.push(target);
      } else {
        invalidEntries.push({ target: rawArg, reason: 'arquivo não é PDF' });
      }
      continue;
    }

    if (stats.isDirectory()) {
      pdfFiles.push(...collectPdfFiles(target));
      continue;
    }

    invalidEntries.push({ target: rawArg, reason: 'tipo de caminho não suportado' });
  }

  return {
    pdfFiles: Array.from(new Set(pdfFiles)),
    invalidEntries,
  };
}

async function run() {
  const root = process.cwd();
  const args = process.argv.slice(2);
  const outputDir = path.join(root, 'output');
  const reportDir = path.join(outputDir, 'reports');
  const imageDir = path.join(root, 'images', 'questions');

  ensureDir(outputDir);
  ensureDir(reportDir);
  ensureDir(imageDir);

  const resolved = args.length === 0
    ? { pdfFiles: resolvePdfFiles([], root), invalidEntries: [] }
    : resolvePdfFiles(args, root);

  const { pdfFiles, invalidEntries } = resolved;

  if (invalidEntries.length > 0) {
    invalidEntries.forEach(({ target, reason }) => {
      console.warn(`Ignorando '${target}': ${reason}.`);
    });
  }

  if (pdfFiles.length === 0) {
    if (args.length === 0) {
      const inputDir = path.join(root, 'input');
      ensureDir(inputDir);
      console.log(`Nenhum PDF encontrado em ${path.relative(root, inputDir) || 'input'}/.`);
      printUsage();
      return;
    }

    console.log('Nenhum PDF válido foi informado para processamento.');
    printUsage();
    return;
  }

  console.log(`Iniciando extração de ${pdfFiles.length} PDF(s)...`);

  const aggregate = {
    questions: [],
    references: [],
    questionReferenceLinks: [],
    metadata: [],
    mediaReferences: [],
    questionMediaLinks: [],
    processedFiles: [],
    failedFiles: [],
  };

  for (const fullPath of pdfFiles) {
    const label = path.relative(root, fullPath) || path.basename(fullPath);
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await parsePdf(fullPath, imageDir);

      aggregate.questions.push(...result.questions);
      aggregate.references.push(...result.references);
      aggregate.questionReferenceLinks.push(...result.questionReferenceLinks);
      aggregate.metadata.push(...result.metadata);
      aggregate.mediaReferences.push(...result.mediaReferences);
      aggregate.questionMediaLinks.push(...result.questionMediaLinks);
      aggregate.processedFiles.push({ file: label, questions: result.questions.length });

      console.log(`Processado: ${label} | questões: ${result.questions.length}`);
    } catch (error) {
      aggregate.failedFiles.push({
        file: label,
        error: error && error.message ? error.message : String(error),
      });
      console.error(`Falha ao processar ${label}:`, error.message || error);
    }
  }

  writeJson(path.join(outputDir, 'questions.json'), aggregate.questions);
  writeJson(path.join(outputDir, 'references.json'), aggregate.references);
  writeJson(path.join(outputDir, 'question_reference_links.json'), aggregate.questionReferenceLinks);
  writeJson(path.join(outputDir, 'metadata.json'), aggregate.metadata);
  writeJson(path.join(outputDir, 'media_references.json'), aggregate.mediaReferences);
  writeJson(path.join(outputDir, 'question_media_links.json'), aggregate.questionMediaLinks);

  const report = buildRunReport(aggregate);
  writeJson(path.join(reportDir, 'run-report.json'), report);

  if (aggregate.failedFiles.length > 0) {
    console.warn(`Extração concluída com falhas em ${aggregate.failedFiles.length} arquivo(s). Consulte output/reports/run-report.json.`);
    process.exitCode = aggregate.questions.length > 0 ? 0 : 1;
    return;
  }

  console.log('Extração finalizada com sucesso. Arquivos gerados em output/.');
}

run().catch((err) => {
  console.error('Falha ao executar extrator:', err);
  process.exit(1);
});
