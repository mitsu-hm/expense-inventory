# Self-hosted AI for LedgerSprout

## Model and scope

Use Ollama with the explicit model tag `qwen3-vl:4b-instruct`. This is a vision-and-text model for transcribing screenshots into editable document drafts. Use the Instruct tag rather than the generic `4b` alias, whose selected variant can differ. The website does not depend on a cloud API account for this setup.

The current integration handles bill, payment-receipt and ordered-product screenshots. It is not a general autonomous bookkeeper or a chat assistant. Deterministic backend code remains responsible for totals, validation, user isolation, duplicate detection and stock changes. Scans do not post payments or receive stock; the user must review and confirm.

## Local development

Ollama must be running. Install the model once:

    ollama pull qwen3-vl:4b-instruct

Local `.env` configuration (already created for this workstation; do not overwrite an existing credential file when repeating setup):

    AI_PROVIDER=ollama
    AI_MODEL=qwen3-vl:4b-instruct
    AI_BASE_URL=http://127.0.0.1:11434
    AI_LOCAL_ONLY=1
    AI_TIMEOUT_MS=300000

No API key is needed for a standard local Ollama service. The configuration is server-only and `.env` is ignored by Git. Do not put these settings or provider credentials in VITE_ variables.

From a terminal on the same machine as Ollama:

    npm run dev

Then open the website, choose Documents or Add expense -> Upload, and upload a screenshot. Verify every extracted field, especially totals, references and whether an actual payment occurred. Manual entry remains available when the model is unavailable.

If the backend runs in Docker while Ollama runs on the host, override only the container process address:

    AI_BASE_URL=http://host.docker.internal:11434 npm run dev

This shell syntax is for the Linux/container terminal, not Windows PowerShell. Keep the workstation `.env` address on loopback for a native Windows backend. A container's localhost is not the Windows host. Do not expose Ollama directly to browsers or publish its port to the internet.

The backend uses a context size of 8192 tokens, a maximum generation length of 4096 tokens, deterministic temperature and disabled thinking. The timeout accepts 1000-600000 milliseconds and defaults to 180000 if unset or invalid. Large bills, cold starts and simultaneous requests can take longer or fail; this is not a latency guarantee.

## Privacy boundary

`AI_LOCAL_ONLY=1` rejects extraction through Gemini, OpenAI, OCR.space/free OCR, including a forced free-provider scan request. Ollama failures do not cause fallback to an external OCR provider. Upload images, drafts and reviewed corrections remain stored by the application. Up to three recent correction examples scoped to the same user, workspace and document type are included in subsequent model requests; this is prompt context, not model retraining.

The configured Ollama URL is trusted administrator configuration. The local-only flag restricts provider selection, not the physical location or security of that URL. A remote Ollama-compatible endpoint can still receive documents if an administrator configures it. Use loopback or a private server network.

## Repeatable real-model verification

Run this separately from the normal test suite:

    npx tsx scripts/verify-local-ai.ts

For the Docker-to-host setup:

    AI_BASE_URL=http://host.docker.internal:11434 npx tsx scripts/verify-local-ai.ts

This creates synthetic images and an isolated in-memory database, calls the real authenticated document upload/scan routes and installed model, reads the saved drafts back, and asserts that no payments or stock were created. It never uses the business database. Outputs:

- `artifacts/local-ai/paid-receipt.png`
- `artifacts/local-ai/unpaid-bill.png`
- `artifacts/local-ai/verification.json`

Read `passed`, any `error`, individual drafts and actual timings in the JSON. Do not equate a protocol mock or configured=true with successful real-model inference. A small smoke check is not evidence of general financial-document accuracy.

## Client deployment: remove dependency on the developer PC

Install Ollama and the same model on the client's backend machine or a private inference server reachable only by that backend. Configure the deployed backend's AI_BASE_URL for that private service. The client and other browser devices do not install a model. Once deployed there, your developer PC is not part of the request path.

The model can avoid an AI subscription and per-request cloud API charges, but the client still needs adequate server RAM/processing capacity, disk space, electricity or paid hosting, uptime and backups. A static-only hosting plan cannot run this model/backend. HTTPS, authentication, restricted network access, resource/concurrency limits and production backup/restore need deployment-specific work. No client hosting or public deployment was performed by this local setup.
