const test = require('node:test');
const assert = require('node:assert/strict');
const {
  splitQuestionBlocks,
  parseQuestionContent,
  splitReferenceFromParts,
  buildRunReport,
  extractAnswerKey,
  extractMetadataFromLines,
} = require('../src/extractor');

test('questão com alternativas simples preserva metadata e prompt final', () => {
  const lines = [
    { text: 'Questão 14', y: 700, page: 1 },
    { text: '2026', y: 690, page: 1 },
    { text: 'FGV', y: 680, page: 1 },
    { text: 'Os escritores apontam a dificuldade de expressar o que desejam.', y: 670, page: 1 },
    { text: 'Nesse caso, o problema da linguagem é:', y: 660, page: 1 },
    { text: 'A) Opção A', y: 650, page: 1 },
    { text: 'B) Opção B', y: 640, page: 1 },
    { text: 'C) Opção C', y: 630, page: 1 },
    { text: 'D) Opção D', y: 620, page: 1 },
    { text: 'E) Opção E 4002461153', y: 610, page: 1 },
  ];

  const parsed = parseQuestionContent(lines);
  assert.equal(parsed.statement, 'Nesse caso, o problema da linguagem é:');
  assert.equal(parsed.options.E, 'Opção E');
  assert.deepEqual(parsed.metadataLines, ['2026', 'FGV']);
  assert.match(splitReferenceFromParts(parsed.referenceLines), /Os escritores apontam/);
});

test('alternativas multilinha são concatenadas corretamente', () => {
  const lines = [
    { text: 'Questão 15', y: 700, page: 1 },
    { text: 'Assinale a resposta certa.', y: 680, page: 1 },
    { text: 'A) Primeira parte', y: 660, page: 1 },
    { text: 'continuação da alternativa A', y: 640, page: 1 },
    { text: 'B) Outra alternativa', y: 620, page: 1 },
  ];
  const parsed = parseQuestionContent(lines);
  assert.match(parsed.options.A, /continuação da alternativa A/);
});

test('texto base completo é mantido em references e prompt fica no statement', () => {
  const lines = [
    { text: 'Questão 21', y: 700, page: 1 },
    { text: 'TEXTO I', y: 680, page: 1 },
    { text: 'Era uma vez um texto longo.', y: 660, page: 1 },
    { text: 'Nesse contexto, assinale a alternativa correta.', y: 640, page: 1 },
    { text: 'A) item A', y: 620, page: 1 },
  ];

  const parsed = parseQuestionContent(lines);
  const reference = splitReferenceFromParts(parsed.referenceLines);
  assert.match(reference, /TEXTO I/);
  assert.match(reference, /Era uma vez um texto longo/i);
  assert.equal(parsed.statement, 'Nesse contexto, assinale a alternativa correta.');
});

test('metadados são extraídos de linhas dedicadas sem concatenar blocos indevidos', () => {
  const metadata = extractMetadataFromLines([
    '2026',
    'Prefeitura Municipal de São José do Divino (PI)',
    'Professor - Ensino Fundamental Anos Finais - Ciências',
    'FUNATEC',
    'Ciências',
  ], 'ES.pdf', 1);

  assert.equal(metadata.year, 2026);
  assert.equal(metadata.exam_board, 'FUNATEC');
  assert.equal(metadata.institution, 'Prefeitura Municipal de São José do Divino (PI)');
  assert.equal(metadata.position, 'Professor - Ensino Fundamental Anos Finais - Ciências');
  assert.equal(metadata.discipline, 'Ciências');
});

test('questão sem gabarito permanece com answer null no relatório', () => {
  const report = buildRunReport({
    questions: [
      { question_number: 1, statement: 's', options: { A: 'a' }, answer: null },
    ],
    questionReferenceLinks: [],
    questionMediaLinks: [],
    mediaReferences: [],
  });

  assert.equal(report.total_questions, 1);
  assert.equal(report.questions_with_options, 1);
});

test('relatório inclui arquivos processados e falhas', () => {
  const report = buildRunReport({
    questions: [],
    questionReferenceLinks: [],
    questionMediaLinks: [],
    mediaReferences: [],
    processedFiles: [{ file: 'input/prova-ok.pdf', questions: 10 }],
    failedFiles: [{ file: 'input/prova-ruim.pdf', error: 'arquivo corrompido' }],
  });

  assert.equal(report.processed_files, 1);
  assert.equal(report.failed_files, 1);
  assert.deepEqual(report.file_failures, [{ file: 'input/prova-ruim.pdf', error: 'arquivo corrompido' }]);
});

test('questão atravessando página é mantida no mesmo bloco', () => {
  const blocks = splitQuestionBlocks([
    {
      pageNumber: 1,
      lines: [
        { text: 'Questão 21', y: 700 },
        { text: 'O texto seguinte servirá de base.', y: 680 },
      ],
    },
    {
      pageNumber: 2,
      lines: [
        { text: 'Continuação do texto-base', y: 750 },
        { text: 'A) alternativa', y: 500 },
      ],
    },
  ]);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].question_number, 21);
  assert.equal(blocks[0].lines.length, 4);
});

test('gabarito é extraído das páginas finais', () => {
  const answerMap = extractAnswerKey([
    { pageNumber: 1, lines: [{ text: 'Questão 1' }] },
    { pageNumber: 10, lines: [{ text: 'Gabarito' }, { text: '1 A 2 C 3 D' }, { text: '4-B 5:E' }] },
  ]);

  assert.equal(answerMap.get(1), 'A');
  assert.equal(answerMap.get(2), 'C');
  assert.equal(answerMap.get(4), 'B');
  assert.equal(answerMap.get(5), 'E');
});

test('questão com imagem é contabilizada no relatório', () => {
  const report = buildRunReport({
    questions: [{ question_number: 2, statement: 's', options: { A: 'a' }, answer: null }],
    questionReferenceLinks: [],
    questionMediaLinks: [{ question_id: 'q1', media_id: 'm1', relation_type: 'question_image' }],
    mediaReferences: [{ media_id: 'm1', type: 'image', path: 'images/questions/img_0001.png', source_file: 'x.pdf', page: 1 }],
  });

  assert.equal(report.questions_with_images, 1);
  assert.equal(report.total_images_extracted, 1);
});
