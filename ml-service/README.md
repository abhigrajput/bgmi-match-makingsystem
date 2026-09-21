# ml-service (superseded)

The Phase 1 plan put the model in a separate Python/FastAPI service. The final
build does not use one: the model is logistic regression trained and served in
TypeScript (`scripts/train.ts`, `lib/scoring/model.ts`), so training and
serving share the same feature code and there is no second runtime to deploy.

The reasoning is in [`docs/architecture.md`](../docs/architecture.md) section 5.
This directory is kept only so older links resolve.
