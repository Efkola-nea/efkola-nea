# Easy News Pipeline (TypeScript Prototype)

Production-oriented article-generation pipeline for easy-to-read Greek news/information content.

## Architecture

The pipeline is decomposed into strict stages:

1. `cleanSource`: removes boilerplate/noise from one raw source article.
2. `extractFacts` (`gpt-5.4-mini`): outputs strict extractor JSON only.
3. `topicGate`: deterministic filtering first, optional mini-model fallback only when ambiguous.
4. `writeArticle` (`gpt-5.4`): writes Greek article from extractor JSON only.
5. `validateArticle` (`gpt-5.4-mini`): strict JSON validation only (no full rewrite).
6. `repairArticle` (`gpt-5.4` or rule-based): targeted fixes only for flagged issues.
7. `runPipeline`: orchestration, retries, feature flags, logging, final packaging.

Key design principle: downstream stages do not receive the raw full source article unless truly necessary. Only the extractor sees full source text, which controls cost and reduces inconsistency drift.

## Why These Models

- Extractor: `gpt-5.4-mini`
  - Best cost/quality trade-off for structured fact extraction.
- Writer: `gpt-5.4`
  - Better writing quality, flow, and natural tone in Greek.
- Validator: `gpt-5.4-mini`
  - Efficient for policy/constraint checks and targeted diagnostics.

## Cost-Control Rationale

- Raw article passes only once to the extractor.
- Writer/validator operate on compact extractor JSON.
- Topic gate is deterministic-first to avoid unnecessary model calls.
- Validator and repair are feature-flagged.
- Structured JSON outputs reduce retries and post-processing overhead.

## Project Structure

```
src/
  config/
    editorialRules.ts
    models.ts
  pipeline/
    runPipeline.ts
  steps/
    cleanSource.ts
    extractFacts.ts
    topicGate.ts
    writeArticle.ts
    validateArticle.ts
    repairArticle.ts
  types/
    schemas.ts
  utils/
    json.ts
    logger.ts
  index.ts
tests/
examples/
```

## Setup

1. Install dependencies:

```bash
npm install
```

2. Set environment variables:

```bash
export OPENAI_API_KEY=\"your_key_here\"
export EXTRACTOR_MODEL=\"gpt-5.4-mini\"
export WRITER_MODEL=\"gpt-5.4\"
export VALIDATOR_MODEL=\"gpt-5.4-mini\"
```

Optional tuning:

```bash
export READING_SIMPLICITY_TARGET=\"simple\"   # very_simple | simple | plain
export MAX_SENTENCE_CHARS=\"150\"
export MAX_PARAGRAPH_CHARS=\"320\"
export ARTICLE_LENGTH_BAND=\"medium\"         # short | medium
export MAX_JSON_RETRIES=\"2\"
export MAX_REPAIR_RETRIES=\"1\"
```

## Run Locally

Example file:

```bash
npm run pipeline:example
```

Custom input:

```bash
npm run pipeline -- --input-file examples/source-article.txt --output-file out.json
```

Disable stages:

```bash
npm run pipeline -- --input-file examples/source-article.txt --disable-validator
npm run pipeline -- --input-file examples/source-article.txt --disable-repair
```

## Tests

Run all tests:

```bash
npm test
```

Included tests:

- extractor returns valid schema
- validator catches hallucinated fact
- repair step fixes simplicity violation

## Evaluate Output Quality

Use `validator_json` and `pipeline_metadata`:

- Check `validator_json.pass`, `scores`, and `violations`.
- Track retry behavior via `retry_count`.
- Inspect token usage by stage in `pipeline_metadata.stage_usage`.
- Review gate decisions in `pipeline_metadata` timings + logs.

## Example I/O

- Input source: `examples/source-article.txt`
- Example packaged output: `examples/sample-output.json`

## Extend Later

The pipeline is designed to add stages without major refactors:

- pre-publish classifier
- deduplication stage
- human review queue
- persistent audit logs

## Production Hardening TODOs

- Add content safety moderation stage before writer.
- Add persistent trace IDs and structured log transport.
- Add cache layer for extractor outputs.
- Add golden-set regression evals for style + fidelity drift.
