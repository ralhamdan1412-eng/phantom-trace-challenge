# PHANTOM TRACE

PHANTOM TRACE reviews AI-agent trace files in your browser. It combines deterministic checks for malformed events, missing references, and explicit date mismatches with an optional local language-model review of claims and cited evidence.

## Public links

- **Demo:** [ralhamdan1412-eng.github.io/phantom-trace-challenge](https://ralhamdan1412-eng.github.io/phantom-trace-challenge/)
- **Source:** [github.com/ralhamdan1412-eng/phantom-trace-challenge](https://github.com/ralhamdan1412-eng/phantom-trace-challenge)
- **DEV challenge write-up:** [PHANTOM TRACE: Finding the Ghost Between an Agent's Claim and Its Evidence](https://dev.to/raed_alhamdan_be31f9ae44c/phantom-trace-finding-the-ghost-between-an-agents-claim-and-its-evidence-118o)

## Privacy

Trace content is processed in the browser and is not sent to a project backend or an inference API. The optional model is downloaded by the browser from Hugging Face on first use; model requests disclose standard network metadata to that hosting service. Use synthetic data for the public demo. This project has not undergone a security audit.

## Run locally

Requires Node.js 22 or later.

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run dev
```

The production files are generated in `dist/`.

## AI and model attribution

Local review uses Transformers.js (`@huggingface/transformers`) and `HuggingFaceTB/SmolLM2-135M-Instruct`. The model card states Apache-2.0 and the same repository provides ONNX variants, including `model_q4.onnx`. Model files are fetched by the browser on first use and are not included here. The model is English-oriented and may be inaccurate; results are hypotheses requiring human review.

The model is a small English-oriented assistant. AI assessments are hypotheses; the application checks citation IDs deterministically and requires human review. Actual browser inference on this release candidate has not yet been verified.

## License

The project source in this repository is offered under the MIT License. Third-party packages and model files are separate works governed by their own terms; this license does not grant rights to them.
