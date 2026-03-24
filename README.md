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

- O parser agora separa a questão em zonas estruturais: metadados iniciais, corpo completo do enunciado antes das alternativas, prompt final da pergunta e alternativas.
- Todo o corpo textual antes das alternativas passa a ser preservado em `references.json`, enquanto `statement` prioriza o comando final/pergunta objetiva da questão.
- O parser também tenta extrair gabaritos explícitos nas páginas finais do PDF e preencher `answer` quando encontrar correspondência por número da questão.
- Imagens detectadas dentro do bloco visual da questão são extraídas para `images/questions/` e vinculadas por `question_media_links.json`.

O parser foi implementado para seguir esse padrão antes de gerar os JSONs no formato exigido.

## Uso do CLI

- `node src/cli.js` procura PDFs dentro de `input/` de forma recursiva.
- `node src/cli.js caminho/para/prova.pdf` processa um PDF específico.
- `node src/cli.js pasta-com-pdfs` processa todos os PDFs de uma pasta e subpastas.
- Se um arquivo falhar, o processo continua com os demais e registra o erro em `output/reports/run-report.json`.
