# Jev Contradiction Atlas

A live natural-language-inference experiment that demonstrates where semantic similarity is not enough.

The corpus contains 19,666 validated sentence pairs from the SNLI validation and test splits. Every pair has a human label: entailment, contradiction, or neutral. The opening example intentionally shows two highly similar sentences whose logical relationship is contradiction.

## Why this demonstrates Jev

Embedding similarity can tell whether two sentences discuss similar things, but not reliably whether one supports, contradicts, or leaves the other unresolved. The project provides both baselines:

- A 256-dimensional Qwen embedding similarity baseline scores **56.3%** on the held-out SNLI test split.
- Jev scores **87.0%** on a deterministic 500-example test sample at 16 pairs per request.

The visualization sends all 19,666 pairs to Jev live. Each response moves into one of three decision lanes. Vertical position represents embedding similarity; solid points agree with the human label and outlined points disagree.

## Run

```bash
npm install
npm run ingest
VENICE_API_KEY="your-key" npm run embed
VENICE_API_KEY="your-key" npm run dev
```

Open `http://localhost:5174`. The production server runs on `http://localhost:8788`.

The API key remains on the Node server and is never exposed to the browser.

## Data and evaluation

- Dataset: Stanford Natural Language Inference corpus
- Included splits: validation + test
- Included labeled pairs: 19,666
- License: CC BY-SA 4.0
- Labels: entailment, contradiction, neutral
- Embedding model: `text-embedding-qwen3-0-6b`, 256 dimensions
- Embedding setup: cosine similarity with thresholds fit on validation and evaluated on test
- Jev benchmark: deterministic 500-pair test subset

Benchmark Jev again:

```bash
VENICE_API_KEY="your-key" npm run benchmark -- --limit=500 --batch=16
```

Batch-size evaluation:

- 16 pairs/request: 87.0%
- 32 pairs/request: 80.6%
- 48 pairs/request: 64.6%
- 96 pairs/request: 47.4%

The live route uses 16 pairs per request to preserve the measured accuracy.

## Commands

```bash
npm run dev
npm run build
npm run start
npm run lint
npm test
```
