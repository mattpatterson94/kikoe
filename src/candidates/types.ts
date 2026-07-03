// A transformed guess at what the user meant, tagged with the transformer
// that produced it (the tag shows up in debug logs).
export interface Candidate {
  type: string;
  data: string;
}

// Candidate transformers run in order groups (see generateCandidates in
// src/flashcards.ts): order-0 transformers see the raw transcript, order-1
// transformers additionally see the order-0 output.
export interface CandidateGenerator {
  order: number;
  getCandidates(raw: string): Candidate[];
}
