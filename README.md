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

Local review uses Transformers.js (`@huggingface/transformers`) with `Xenova/nli-deberta-v3-base`. This is an ONNX (q8, about 244 MB) conversion of the natural-language-inference cross-encoder `cross-encoder/nli-deberta-v3-base`, whose model card states Apache-2.0. Each claim is scored against each existing evidence event it cites. Entailment, contradiction and neutral map to supported, contradicted and insufficient. A verdict below p=0.80 is reported as insufficient. Model files are fetched by the browser from Hugging Face on first use, and the ONNX Runtime WebAssembly files from cdn.jsdelivr.net. Trace text is not sent to either. Model files are not included here.

An earlier generative model (`SmolLM2-135M-Instruct`) was replaced. In real runs it never returned the required JSON, and when limited to the three labels it chose "supported" even for contradictions. Every result still passes the strict citation validator, and a failure on one claim is marked unassessed without affecting the others. On the synthetic demo, browser inference returned EV-002 contradicted (EV-001), EV-003 insufficient (EV-404 missing) and EV-005 supported (EV-004). The model is English-oriented and can be wrong: in an 11-pair synthetic check it matched the expected label 8 times. Results are hypotheses that require human review.

## License

The project source in this repository is offered under the MIT License. Third-party packages and model files are separate works governed by their own terms; this license does not grant rights to them.
