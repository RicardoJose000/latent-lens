# Latent Lens - MVP preview

Interactive preview of **Latent Lens**, a B2B AI evaluation and quality intelligence platform that tests LLM apps, RAG pipelines and AI agents for factual accuracy, hallucinations and instruction adherence.

This build runs fully in the browser so it can be hosted on GitHub Pages. The evaluation engine is real (not a mockup); auth and storage are browser-local stand-ins for the production Supabase layer.

## Pages

| Page | What it shows |
|---|---|
| `index.html` | Marketing site: 3D lens hero (Three.js), capability breakdown, pipeline film strip, live sample report, architecture, inquiry form |
| `checker.html` | Free AI Response Checker: prompt + response + optional ground truth -> scored report with failure taxonomy and remediation |
| `login.html` | Sign in / sign up, plus a one-click demo workspace |
| `dashboard.html` | Evaluation history, KPIs, quality trend, failure taxonomy, inquiry pipeline with status tracking |

## Evaluation engine (`js/engine.js`)

1. **Constraint extraction** - word/sentence limits, bullet counts, numbered lists, JSON output, language, single paragraph, no-markdown, citations, required and forbidden terms, "answer only from context".
2. **Claim decomposition** - the response is split into atomic factual claims; filler and questions are dropped.
3. **Grounding** - each claim is matched to the closest context sentence and labeled `supported`, `partial`, `contradicted` or `unsupported`, detecting numeric drift, fabricated entities and polarity flips. Without context, claims get a hallucination-risk label instead.
4. **Failure taxonomy** - Numeric drift, Contradiction, Fabricated entity, Unsupported claim, Ungrounded specifics, Length / Format / Language breach, Forbidden content, Missing required content, Unwarranted refusal, Overconfident language, Off-topic.
5. **Scoring** - computed in code from the labels (never asked from a model): `faithfulness = (supported + 0.5 * partial) / claims`, weighted overall score, verdict, confidence. Rubric and engine versions are stamped on every run.
6. **Optional LLM-as-a-judge** - OpenAI Structured Outputs (strict JSON schema, temperature 0) replaces the heuristic labeller; deterministic checks such as word counts and JSON validity still win.

## Production architecture (Phase 1)

- **Frontend:** Next.js + TypeScript + Tailwind
- **Evaluation API:** FastAPI with Pydantic schemas and an async job queue (Redis + arq workers)
- **Data & auth:** Supabase Postgres + Supabase Auth with row-level security
- **Judges:** OpenAI Structured Outputs behind a provider interface (swappable)

## Run locally

Any static server works:

```bash
python -m http.server 8080
# open http://localhost:8080
```

## Credits

Stock video from [Mixkit](https://mixkit.co) and photos from [Pexels](https://www.pexels.com), both used under their free licenses. Generative artwork (`assets/img/art-*`) was made for this project. Libraries: Three.js, GSAP + ScrollTrigger, Lenis.
