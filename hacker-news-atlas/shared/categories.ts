export const BASE_CATEGORIES = [
  { id: 'insight', label: 'Insight', description: 'A novel observation, useful synthesis, or non-obvious lesson.' },
  { id: 'question', label: 'Question', description: 'Primarily asks for information, clarification, or other viewpoints.' },
  { id: 'prediction', label: 'Prediction', description: 'Makes a concrete claim about what is likely to happen in the future.' },
  { id: 'argument', label: 'Argument', description: 'Advances or disputes a position using reasons, evidence, or counterexamples.' },
  { id: 'joke', label: 'Joke', description: 'Primarily humorous, playful, sarcastic, or a punchline.' },
  { id: 'launch', label: 'Launch', description: 'Announces, demonstrates, or introduces a product, project, company, or release.' },
  { id: 'complaint', label: 'Complaint', description: 'Expresses dissatisfaction, frustration, criticism, or a negative experience.' },
  { id: 'explanation', label: 'Explanation', description: 'Clarifies how or why something works, often by supplying background or mechanism.' },
  { id: 'request', label: 'Request', description: 'Asks someone to do something, provide help, or take a concrete action.' },
  { id: 'anecdote', label: 'Anecdote', description: 'Centers on a personal experience, remembered event, or first-hand account.' },
  { id: 'correction', label: 'Correction', description: 'Corrects a factual claim, terminology, assumption, or misunderstanding.' },
  { id: 'other', label: 'Other', description: 'No other category clearly captures the item’s primary rhetorical role.' },
] as const

export type BaseCategoryId = (typeof BASE_CATEGORIES)[number]['id']

export const CATEGORY_BY_ID = new Map<string, (typeof BASE_CATEGORIES)[number]>(
  BASE_CATEGORIES.map((category) => [category.id, category]),
)
