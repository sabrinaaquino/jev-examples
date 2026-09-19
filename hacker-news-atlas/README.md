# HN Jev Atlas

A living semantic map of Hacker News. Jev classifies every item live into a rhetorical role—Insight, Question, Prediction, Argument, Joke, Launch, Complaint, and others—then lets a visitor type another category and watch matching items move into a new cluster.

## Scope

The complete HN archive contains more than 48 million items. Reclassifying all of it interactively would not be live, so this project creates a time-stratified corpus spanning October 2006 to the present.

By default, ingestion samples one deterministic day every two months, requests stories and comments separately, and evenly downsamples to 24,000 items. Comments carry their parent story title. Data comes from the public [Algolia Hacker News Search API](https://hn.algolia.com/api); [open-index/hacker-news](https://huggingface.co/datasets/open-index/hacker-news) is the full archival source.

## Run

```bash
npm install
npm run ingest
VENICE_API_KEY="your-key" npm run dev
```

Open `http://localhost:5173`. The key remains on the Node server and is never sent to the browser.

For a fast development sample:

```bash
npm run ingest -- --target=1000 --per-kind=20
```

## Pipeline

- `npm run ingest` writes `data/corpus.jsonl` and provenance to `data/corpus-meta.json`.
- `/api/classify-live` sends batched shared state to Jev with one independent Choice question per HN item and streams the answers.
- `npm run classify` remains available for offline benchmarking and resumable precomputation, but the main visualization does not use saved answers.
- Baseline categories are Insight, Question, Prediction, Argument, Joke, Launch, Complaint, Explanation, Request, Anecdote, Correction, and Other.
- `/api/reclassify` asks one Jev Noul question per item for a visitor's category and streams NDJSON batches.
- The canvas animates matching points toward the new category as batches finish.

## Literal live classification

The atlas opens with every point in one unjudged cloud. Press **Classify live** to send all 24,000 items through fresh Jev inference. Each completed batch streams to the browser immediately: points acquire their returned category color, move into position, and update the live request, token, elapsed-time, and cost counters. **Stop** or **Reset** aborts the active request and returns the points to the center.

A full run now targets roughly **1 minute 50 seconds**, makes about 501 requests, and costs approximately **$0.57–$0.59** at current pricing. The live cost counter uses actual input-token counts returned by each completed Jev request. Output tokens are free.

The classifier intentionally keeps 48 items per request. Live comparisons found that increasing the batch to 52 or more changed substantially more answers than Jev's normal repeat variance. With the partner tier now live at 300 RPM / 10M TPM, eight workers start a request every 210ms—about 286 RPM—without changing that quality-preserving batch size.

Useful options:

```bash
npm run ingest -- --target=24000 --step-months=2 --per-kind=140
```

## Commands

```bash
npm run dev
npm run build
npm run start
npm run lint
npm test
```

Jev currently supports 32K tokens for state plus the longest question and 64K tokens across a request. Venice currently prices Jev at $0.0525 per million input tokens with free output. Check `GET /api/v1/models?type=decision` before a large run.
