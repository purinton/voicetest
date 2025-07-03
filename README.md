# [![Purinton Dev](https://purinton.us/logos/brand.png)](https://discord.gg/QSBxQnX7PF)

## @purinton/voicetest [![npm version](https://img.shields.io/npm/v/@purinton/voicetest.svg)](https://www.npmjs.com/package/@purinton/voicetest) [![license](https://img.shields.io/github/license/purinton/voicetest.svg)](LICENSE) [![build status](https://github.com/purinton/voicetest/actions/workflows/nodejs.yml/badge.svg)](https://github.com/purinton/voicetest/actions)

VoiceTest is a voice-enabled Discord bot built with Node.js and Discord.js. It captures live speech from users in a voice channel, streams it to OpenAI's GPT-4o-mini realtime API for transcription and AI response, then plays back synthesized voice responses—all in real time.

---

## Table of Contents

- [Features](#features)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Usage](#usage)
- [Customization](#customization)
  - [Commands](#commands)
  - [Events](#events)
  - [Locales](#locales)
- [Deployment](#deployment)
  - [Docker](#docker)
  - [Systemd](#systemd)
- [Testing](#testing)
- [Support](#support)
- [License](#license)
- [Links](#links)

## Features

- Real-time voice-to-text transcription using OpenAI GPT-4o-mini realtime
- AI-generated voice responses streamed back into Discord
- High-quality audio encoding/decoding with `@purinton/resampler` and Prism-media
- Modular command and event handler architecture via `@purinton/discord`
- Multi-language/localized responses with built-in locale files
- Graceful startup, shutdown, and error handling via `@purinton/common`
- Ready for Docker and systemd deployment
- Comprehensive Jest test suite covering locales, commands, and events

## Getting Started

1. Clone this repository and install dependencies:

   ```powershell
   git clone https://github.com/purinton/voicetest.git
   cd voicetest
   npm install
   ```

2. Copy and configure your environment variables and instructions:

   ```powershell
   copy .env.example .env
   copy instructions.txt.example instructions.txt
   ```

   - Fill in `DISCORD_TOKEN`, `GUILD_ID`, `VOICE_CHANNEL_ID`, and `OPENAI_API_KEY` in `.env`.
   - Edit instructions.txt to include any custom instructions for the voice agent.

3. Start the bot locally:

   ```powershell
   npm start
   # or
   node voicetest.mjs
   ```

## Configuration

All settings are managed via environment variables in `.env`.
See `.env.example` for required and optional keys.

## Usage

1. Invite your bot to a Discord server with the correct permissions.
2. Join the configured voice channel.
3. Speak into the channel—VoiceTest will transcribe your speech, send it to the AI, and play back the AI’s response automatically.

## Customization

### Commands

- Add new commands by placing a `.json` definition and `.mjs` handler in the `commands/` directory.

### Events

- Add or modify event handlers in the `events/` directory. Handlers follow the Discord Gateway event names.

### Locales

- Update or add locale files in the `locales/` directory. All responses and command metadata can be localized.

## Deployment

### Docker

Build and run with Docker:

```powershell
docker build -t voicetest .
docker run --env-file .env voicetest
```

### Systemd

1. Copy `voicetest.service` to `/etc/systemd/system/voicetest.service`.
2. Edit paths and user/group settings in the service file.
3. Reload and start:

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable voicetest
   sudo systemctl start voicetest
   ```

## Testing

Run the full test suite:

```powershell
npm test
```

## Support

For questions or feedback, join the [Purinton Dev Discord](https://discord.gg/QSBxQnX7PF).

## License

MIT © 2025 Russell Purinton

## Links

- [GitHub](https://github.com/purinton/voicetest)
- [NPM](https://www.npmjs.com/package/@purinton/voicetest)
- [Discord](https://discord.gg/QSBxQnX7PF)
