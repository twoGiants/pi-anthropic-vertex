# pi-anthropic-vertex

Anthropic Claude models on Google Cloud Vertex AI for [pi](https://github.com/badlogic/pi-mono).

## Prerequisites

- Google Cloud project with Vertex AI API enabled
- Claude models enabled in [Model Garden](https://console.cloud.google.com/vertex-ai/model-garden)
- `gcloud` CLI installed and authenticated

## How it works

This extension injects an `AnthropicVertex` client into pi's built-in `anthropic-messages` streaming implementation. All message transformation, prompt caching, tool call normalization, thinking block replay, partial JSON streaming, and usage tracking are handled by pi's battle-tested internals, nothing is reimplemented.

Other Vertex AI extensions ([pi-vertex-claude](https://github.com/isaacraja/pi-vertex-claude), [pi-vertex](https://github.com/ssweens/pi-packages/tree/main/pi-vertex), [pi-anthropic-vertex](https://github.com/basnijholt/pi-anthropic-vertex)) reimplement the Anthropic streaming protocol from scratch at 500–1500 lines, losing features like prompt caching, tool call adjacency enforcement, aborted message filtering, and partial JSON parsing. This extension delegates to pi's built-in at ~160 lines and inherits everything for free.

Model definitions are pulled at runtime from pi's built-in Anthropic provider via `getModels("anthropic")`, so new Claude models are picked up automatically when pi updates.

## Install

```bash
pi install npm:@twogiants/pi-anthropic-vertex
```

Or install from git:

```bash
pi install git:github.com/twoGiants/pi-anthropic-vertex
```

## Setup

Authenticate with Google Cloud:

```bash
gcloud auth application-default login
```

Set your project and region:

```bash
export GOOGLE_CLOUD_PROJECT=your-project-id
export GOOGLE_CLOUD_LOCATION=us-east5  # optional, defaults to us-east5
```

## Usage

```bash
pi --provider anthropic-vertex --model claude-opus-4-6
pi --provider anthropic-vertex --model claude-sonnet-4-6
```

All Claude models available on Vertex AI are registered automatically.

## License

MIT
