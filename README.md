# plaud

> **Alpha** — Early test version. Building in public, testing on my own recordings.

Unofficial TypeScript toolkit for the [Plaud](https://www.plaud.ai/) API — core library, CLI, and MCP server.

## Why

[Plaud](https://www.plaud.ai/) makes AI-powered wearable recorders (Plaud Note, Plaud NotePin) that capture meetings, conversations, and voice notes, then transcribe and summarize them in the cloud. Great hardware, but all your data lives behind their app with no official API or export tools.

This toolkit gives you programmatic access to your own recordings. Download audio files, pull transcripts, sync everything to local folders — your data, your workflow. Built as a monorepo with three packages:

- **`@plaud/core`** — Shared library: authentication, API client, config management. Handles token lifecycle automatically (tokens last ~300 days, auto-refresh when within 30 days of expiry).
- **`@plaud/cli`** — Command-line tool to list, download, transcribe, and sync recordings.
- **`@plaud/mcp`** — [MCP server](https://modelcontextprotocol.io/) that exposes your Plaud recordings to AI assistants like Claude, making your voice notes searchable and accessible from any MCP-compatible tool.

## Setup

```bash
git clone https://github.com/sergivalverde/plaud.git
cd plaud && npm install
```

### 1. Login

**Email + password accounts:**

```bash
npx tsx packages/cli/bin/plaud.ts login
```

Enter your email, password, and region. Credentials are stored locally in `~/.plaud/config.json` (mode 0600).

**Google / Apple SSO accounts:**

Plaud stores SSO identities separately from email+password accounts and offers no public way to add a password to an SSO-only account ("Forgot Password" returns `user not exist`; "Login with verification code" creates a brand-new, empty account). To work around this, paste the bearer token your browser already has:

```bash
npx tsx packages/cli/bin/plaud.ts login-sso
```

The command walks you through it:
1. Open [web.plaud.ai](https://web.plaud.ai), sign in with Google or Apple.
2. Open DevTools Console and run `localStorage.tokenstr`.
3. Paste the output (a `Bearer <jwt>` string) into the prompt.

Plaud tokens are valid ~300 days. Within 30 days of expiry the CLI errors out with `Re-run 'plaud login-sso'` — grab a fresh `tokenstr` from the browser and re-run.

**Capturing the SSO token automatically (chrome-devtools MCP):**

If you're driving this from an MCP-enabled agent (e.g. Claude Code with the `chrome-devtools` MCP), you don't need to copy-paste anything. The agent can grab the token, pipe it to `login-sso`, and verify in one shot:

```js
// 1. Open the Plaud web app (sign in once manually if not already signed in).
mcp__chrome-devtools__new_page({ url: 'https://web.plaud.ai' })

// 2. Read the token straight out of localStorage:
mcp__chrome-devtools__evaluate_script({
  function: `() => localStorage.getItem('tokenstr')`
})
// → returns e.g. "bearer eyJhbGci...sig"
```

Then pipe the returned string to `login-sso` via stdin (the CLI just reads one line from stdin):

```bash
echo 'bearer eyJhbGci...sig' \
  | npx tsx packages/cli/bin/plaud.ts login-sso
```

The CLI parses the JWT, writes `~/.plaud/config.json` (mode 0600), then calls `/user/me` to confirm. If that final check 403s with a Cloudflare HTML body, it's the UA issue below — not the token.

### Cloudflare User-Agent issue (403 Forbidden)

Plaud's API is fronted by Cloudflare, which rejects requests sent with Node's default `node` User-Agent and returns a 403 + the "Attention Required / Just a moment" HTML challenge page. The toolkit sends a desktop-Chrome UA on every request to avoid this.

If Cloudflare later starts rejecting the baked-in UA (the toolkit has not yet been updated to a newer string), override it without editing source:

```bash
export PLAUD_USER_AGENT='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/<new>.0.0.0 Safari/537.36'
```

The CLI and the MCP server both read this env var via `@plaud/core`. The error message on a CF block now explicitly tells you to set `PLAUD_USER_AGENT`, so you won't be stuck guessing whether the problem is the token or the UA.

### 2. CLI Usage

```bash
# List recordings
npx tsx packages/cli/bin/plaud.ts list

# Get transcript
npx tsx packages/cli/bin/plaud.ts transcript <recording-id>

# Download audio
npx tsx packages/cli/bin/plaud.ts download <recording-id> ./audio/

# Sync all recordings to a folder
npx tsx packages/cli/bin/plaud.ts sync ./plaud-notes/
```

### 3. MCP Server

Add to your Claude config (`~/.claude.json`):

```json
{
  "mcpServers": {
    "plaud": {
      "command": "npx",
      "args": ["tsx", "/path/to/plaud/packages/mcp/src/index.ts"]
    }
  }
}
```

Tools available:
- `plaud_list_recordings` — list all recordings
- `plaud_get_transcript` — get transcript by recording ID
- `plaud_get_recording_detail` — full recording metadata
- `plaud_user_info` — account info
- `plaud_get_mp3_url` — temporary MP3 download URL

## Token Management

Tokens are obtained automatically via email+password and last ~300 days. The library refreshes silently when a token is within 30 days of expiry. No manual intervention needed after initial `plaud login`.

## API

The API was reverse-engineered from the Plaud web app. This is an unofficial project — not affiliated with or endorsed by Plaud.

## License

MIT
