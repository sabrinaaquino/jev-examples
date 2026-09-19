# How I used Jev to classify Hacker News

I used Venice's `jev-latest` decision model to classify 24,000 Hacker News stories and comments into 12 rhetorical categories:

`insight`, `question`, `prediction`, `argument`, `joke`, `launch`, `complaint`, `explanation`, `request`, `anecdote`, `correction`, and `other`.

The corpus is a time-stratified sample from the public Algolia HN API covering 2006–2026.

## Request shape

Jev evaluates every question independently against shared state. I send 48 HN items as one state and create one Choice question per item:

```ts
const categories = {
  insight: "A novel observation, useful synthesis, or non-obvious lesson.",
  question: "Primarily asks for information or clarification.",
  prediction: "A concrete claim about the future.",
  argument: "Advances or disputes a position using reasons or evidence.",
  joke: "Primarily humorous, playful, or sarcastic.",
  launch: "Announces a product, project, company, or release.",
  complaint: "Expresses dissatisfaction or a negative experience.",
  explanation: "Clarifies how or why something works.",
  request: "Asks for help or a concrete action.",
  anecdote: "Centers on a personal or first-hand experience.",
  correction: "Corrects a claim or misunderstanding.",
  other: "No other category clearly fits."
};

const state = {
  items: batch.map(item => ({
    type: item.kind,
    title: item.title,
    ...(item.text === item.title ? {} : { text: item.text.slice(0, 1200) }),
    year: item.year
  }))
};

const questions = Object.fromEntries(
  batch.map((_, index) => [
    `item_${index}`,
    {
      type: "choice",
      instructions: `Choose the primary rhetorical role of items[${index}].`,
      criteria: categories
    }
  ])
);

const response = await fetch("https://api.venice.ai/api/v1/decisions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.VENICE_API_KEY}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ model: "jev-latest", state, questions })
});
```

Each answer returns the selected category, every category's probability, and confidence. An abridged answer looks like:

```json
{
  "type": "choice",
  "choice": "argument",
  "probabilities": {
    "argument": 0.91,
    "explanation": 0.06,
    "other": 0.03
  },
  "confidence": 0.86
}
```

## What mattered

- **Batch size affected quality.** At 48 items, repeated runs were 94–96% consistent. Increasing beyond 48 materially changed more answers, so I kept 48 even though larger batches were faster.
- **Keep the API key server-side.** The browser calls my Node endpoint; the server calls Venice.
- **Stream completed batches.** The server returns NDJSON so points move into categories as Jev responses arrive.
- **Retry capacity errors.** I retry `429` and `503` with `retry-after` or exponential backoff.
- **Respect both token limits.** Jev allows 32K tokens for state plus the longest question and 64K for the full request.
- **Use embeddings for retrieval, Jev for judgment.** Embeddings are better when the goal is semantic search. Jev is useful when categories have explicit meanings and the application needs a typed decision with probabilities.

## Throughput

With the partner tier at 300 RPM / 10M TPM, the full 24,000-item run uses about 501 requests and targets roughly two minutes. Measured cost is approximately $0.57–$0.59 at $0.0525 per million input tokens; output is free.

The important lesson was not to maximize batch size blindly. The fastest configuration was not the best configuration—the quality-preserving batch size was the real constraint.

## References

- [Typed Decisions with Jev](https://docs.venice.ai/guides/features/decisions)
- [Decisions API reference](https://docs.venice.ai/api-reference/endpoint/decisions/create)
