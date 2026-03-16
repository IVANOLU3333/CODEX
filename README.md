# Extrator de questões de PDF

Fluxo de execução local:

1. Abra a pasta do projeto no terminal.
2. Instale dependências:
   ```bash
   npm install
   ```
3. Coloque PDFs em `input/`.
4. Execute:
   ```bash
   node src/cli.js
   ```

Saídas:

- `output/questions.json`
- `output/references.json`
- `output/question_reference_links.json`
- `output/metadata.json`
- `output/media_references.json`
- `output/question_media_links.json`
- `output/reports/run-report.json`

Imagens extraídas:

- `images/questions/`

## Estratégia adotada para o padrão observado

Com base no layout dos exemplos fornecidos:

- Cada bloco de questão inicia em `Questão N`.
- O cabeçalho de metadados (ano, banca, instituição/cargo) aparece logo após o título da questão.
- Alternativas são marcadas por letras `A` a `E` com variações (`A`, `A)`, `A.`, `A:`, `A -`) e podem quebrar em múltiplas linhas.
- Existem questões com texto-base longo em página seguinte e enunciado final com comando `Assinale...`.
- Há questões com figura dentro do bloco da questão.

O parser foi implementado para seguir esse padrão antes de gerar os JSONs no formato exigido.
