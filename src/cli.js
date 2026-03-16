#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { parsePdf, buildRunReport } = require('./extractor');
const { ensureDir, writeJson } = require('./utils');

async function run() {
  const root = process.cwd();
  const inputDir = path.join(root, 'input');
  const outputDir = path.join(root, 'output');
  const reportDir = path.join(outputDir, 'reports');
  const imageDir = path.join(root, 'images', 'questions');

  ensureDir(inputDir);
  ensureDir(outputDir);
  ensureDir(reportDir);
  ensureDir(imageDir);

  const pdfFiles = fs.readdirSync(inputDir).filter((f) => f.toLowerCase().endsWith('.pdf'));
  if (pdfFiles.length === 0) {
    console.log('Nenhum PDF encontrado em input/.');
    process.exit(0);
  }

  const aggregate = {
    questions: [],
    references: [],
    questionReferenceLinks: [],
    metadata: [],
    mediaReferences: [],
    questionMediaLinks: [],
  };

  for (const pdfFile of pdfFiles) {
    const fullPath = path.join(inputDir, pdfFile);
    // eslint-disable-next-line no-await-in-loop
    const result = await parsePdf(fullPath, imageDir);

    aggregate.questions.push(...result.questions);
    aggregate.references.push(...result.references);
    aggregate.questionReferenceLinks.push(...result.questionReferenceLinks);
    aggregate.metadata.push(...result.metadata);
    aggregate.mediaReferences.push(...result.mediaReferences);
    aggregate.questionMediaLinks.push(...result.questionMediaLinks);

    console.log(`Processado: ${pdfFile} | questões: ${result.questions.length}`);
  }

  writeJson(path.join(outputDir, 'questions.json'), aggregate.questions);
  writeJson(path.join(outputDir, 'references.json'), aggregate.references);
  writeJson(path.join(outputDir, 'question_reference_links.json'), aggregate.questionReferenceLinks);
  writeJson(path.join(outputDir, 'metadata.json'), aggregate.metadata);
  writeJson(path.join(outputDir, 'media_references.json'), aggregate.mediaReferences);
  writeJson(path.join(outputDir, 'question_media_links.json'), aggregate.questionMediaLinks);

  const report = buildRunReport(aggregate);
  writeJson(path.join(reportDir, 'run-report.json'), report);

  console.log('Extração finalizada com sucesso. Arquivos gerados em output/.');
}

run().catch((err) => {
  console.error('Falha ao executar extrator:', err);
  process.exit(1);
});
