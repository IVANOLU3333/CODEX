const test = require('node:test');
const assert = require('node:assert/strict');
const {
  splitQuestionBlocks,
  parseOptionsAndStatement,
  splitReferenceFromParts,
  buildRunReport,
  extractAnswerKey,
  extractMetadataFromLines,
} = require('../src/extractor');

test('questão com alternativas simples e enunciado limpo', () => {
  const lines = [
    { text: 'Questão 14', y: 700, page: 1 },
    { text: '2026', y: 690, page: 1 },
    { text: 'FGV', y: 680, page: 1 },
    { text: 'Assinale a alternativa correta.', y: 670, page: 1 },
    { text: 'A) Opção A', y: 660, page: 1 },
    { text: 'B) Opção B', y: 640, page: 1 },
    { text: 'C) Opção C', y: 620, page: 1 },
    { text: 'D) Opção D', y: 600, page: 1 },
    { text: 'E) Opção E 4002461153', y: 580, page: 1 },
  ];

  const parsed = parseOptionsAndStatement(lines);
  assert.equal(parsed.statement, 'Assinale a alternativa correta.');
  assert.equal(parsed.options.A, 'Opção A');
  assert.equal(parsed.options.E, 'Opção E');
  assert.deepEqual(parsed.metadataLines, ['2026', 'FGV']);
});

test('alternativas multilinha são concatenadas corretamente', () => {
  const lines = [
    { text: 'Questão 15', y: 700, page: 1 },
    { text: 'Assinale a resposta certa.', y: 680, page: 1 },
    { text: 'A) Primeira parte', y: 660, page: 1 },
    { text: 'continuação da alternativa A', y: 640, page: 1 },
    { text: 'B) Outra alternativa', y: 620, page: 1 },
  ];
  const parsed = parseOptionsAndStatement(lines);
  assert.match(parsed.options.A, /continuação da alternativa A/);
});

test('referência textual é separada do enunciado final', () => {
  const lines = [
    { text: 'Questão 21', y: 700, page: 1 },
    { text: 'TEXTO I', y: 680, page: 1 },
    { text: 'Era uma vez um texto longo.', y: 660, page: 1 },
    { text: 'Assinale a alternativa correta.', y: 640, page: 1 },
    { text: 'A) item A', y: 620, page: 1 },
  ];

  const parsed = parseOptionsAndStatement(lines);
  const reference = splitReferenceFromParts(parsed.referenceLines);
  assert.match(reference, /Era uma vez um texto longo/i);
  assert.match(parsed.statement, /Assinale/);
});

test('metadados são extraídos de linhas dedicadas', () => {
  const metadata = extractMetadataFromLines([
    '2026',
    'Prefeitura Municipal de São José do Divino (PI)',
    'Professor - Ensino Fundamental Anos Finais - Ciências',
    'FUNATEC',
    'Ciências',
  ], 'ES.pdf', 1);

  assert.equal(metadata.year, 2026);
  assert.equal(metadata.exam_board, 'FUNATEC');
  assert.match(metadata.institution, /São José do Divino/);
  assert.match(metadata.position, /Professor/);
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
