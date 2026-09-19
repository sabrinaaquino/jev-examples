# Jev Examples

Interactive examples for [`jev-latest`](https://venice.ai/lp/jev), a typed decision model available through the [Venice Decisions API](https://docs.venice.ai/api-reference/endpoint/decisions/create).

## Examples

### [`hacker-news-atlas/`](./hacker-news-atlas)

Classifies 24,000 Hacker News posts into 12 rhetorical categories while streaming decisions, probabilities, confidence, elapsed time, and cost.

- Dataset: time-stratified Hacker News sample, 2006–2026
- Live route: 48 items/request
- Expected full run: approximately 2 minutes on a 300 RPM / 10M TPM partner key
- Detailed implementation note: [`JEV_HACKER_NEWS.md`](./hacker-news-atlas/JEV_HACKER_NEWS.md)

```bash
cd hacker-news-atlas
npm install
VENICE_API_KEY="your-key" npm start
# http://localhost:8787
```

### [`contradiction-atlas/`](./contradiction-atlas)

Compares Jev with a cosine-similarity baseline on 19,666 human-labeled SNLI sentence pairs. It visualizes entailment, neutral, and contradiction decisions, live accuracy, confidence, and disagreements with human consensus.

- Embedding-similarity baseline: 56.3%
- Jev 500-pair held-out benchmark: 87.0%
- Dataset: SNLI validation + test splits, CC BY-SA 4.0

```bash
cd contradiction-atlas
npm install
VENICE_API_KEY="your-key" npm start
# http://localhost:8788
```

## API key safety

The API key is read only by the Node servers. It is never sent to browser code.

- Copy `.env.example` to `.env`, or set `VENICE_API_KEY` in your shell.
- Never place the key in a `VITE_` environment variable.
- `.env` files, dependencies, and production builds are gitignored.

## What these examples demonstrate

- Use embeddings when the task is semantic retrieval or nearest-neighbor search.
- Use Jev when software needs a bounded Choice, Noul, or Score judgment with probabilities and confidence.
- Keep decision criteria explicit and test batch sizes: larger Jev batches can improve throughput while changing model behavior.

## Requirements

- Node.js 22+
- A Venice API key with access to `jev-latest`

See [Typed Decisions with Jev](https://docs.venice.ai/guides/features/decisions) for the request model and question types.

## Data attribution

- Hacker News data is sourced from the public Algolia HN Search API.
- SNLI is distributed under CC BY-SA 4.0; see the attribution inside `contradiction-atlas/README.md`.
- The repository's application code is MIT licensed.
