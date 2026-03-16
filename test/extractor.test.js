const test = require('node:test');
const assert = require('node:assert/strict');
const {
  splitQuestionBlocks,
  parseOptionsAndStatement,
  splitReferenceFromStatement,
  buildRunReport,
} = require('../src/extractor');

test('questão com alternativas simples', () => {
  const lines = [
    { text: 'Questão 14', y: 700, page: 1 },
    { text: 'Enunciado da questão.', y: 680, page: 1 },
    { text: 'A) Opção A', y: 660, page: 1 },
    { text: 'B) Opção B', y: 640, page: 1 },
    { text: 'C) Opção C', y: 620, page: 1 },
    { text: 'D) Opção D', y: 600, page: 1 },
    { text: 'E) Opção E', y: 580, page: 1 },
  ];

  const parsed = parseOptionsAndStatement(lines);
  assert.equal(parsed.statement, 'Enunciado da questão.');
  assert.equal(parsed.options.A, 'Opção A');
  assert.equal(parsed.options.E, 'Opção E');
});

test('alternativas multilinha são concatenadas corretamente', () => {
  const lines = [
    { text: 'Questão 15', y: 700, page: 1 },
    { text: 'Texto base?', y: 680, page: 1 },
    { text: 'A) Primeira parte', y: 660, page: 1 },
    { text: 'continuação da alternativa A', y: 640, page: 1 },
    { text: 'B) Outra alternativa', y: 620, page: 1 },
  ];
  const parsed = parseOptionsAndStatement(lines);
  assert.match(parsed.options.A, /continuação da alternativa A/);
});

test('detecção de referência textual separa texto-base do comando', () => {
  const statement = [
    'TEXTO I',
    'Era uma vez um texto longo.',
    'Assinale a alternativa correta.',
  ].join('\n');

  const split = splitReferenceFromStatement(statement);
  assert.match(split.referenceText, /texto longo/i);
  assert.match(split.cleanedStatement, /Assinale/);
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
