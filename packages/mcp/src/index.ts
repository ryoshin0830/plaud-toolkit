#!/usr/bin/env npx tsx
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { PlaudConfig, PlaudAuth, PlaudClient } from '@plaud/core';

async function getClient(auth: PlaudAuth, config: PlaudConfig) {
  const creds = config.getCredentials();
  if (!creds) return null;
  return new PlaudClient(auth, creds.region);
}

async function main() {
  const config = new PlaudConfig();
  const auth = new PlaudAuth(config);

  const server = new McpServer({
    name: 'plaud-mcp',
    version: '0.1.0',
  });

  // ── login ──

  server.tool('plaud_login', 'Log into Plaud with email and password.', {
    email: z.string().email().describe('Plaud account email'),
    password: z.string().describe('Plaud account password'),
    region: z.string().optional().describe("Region hint: 'us' or 'eu' (default). If unsure, leave empty and the server will redirect as needed."),
  }, async (params) => {
    const creds = await auth.loginWithEmailPassword(params.email, params.password, params.region);
    const token = config.getToken()!;
    const days = Math.round((token.expiresAt - Date.now()) / 86400_000);
    return {
      content: [{
        type: 'text' as const,
        text: `Logged in as ${creds.email} (region: ${creds.region}, expires ${new Date(token.expiresAt).toISOString().slice(0, 10)}, ~${days} days left).`,
      }],
    };
  });

  server.tool('plaud_login_sso', 'Log into Plaud with a Google/Apple SSO token from the browser.', {
    token: z.string().describe('The full localStorage.pld_tokenstr value from web.plaud.ai, e.g. "Bearer eyJh..."'),
  }, async (params) => {
    const creds = await auth.loginWithSsoToken(params.token);
    const token = config.getToken()!;
    const days = Math.round((token.expiresAt - Date.now()) / 86400_000);
    return {
      content: [{
        type: 'text' as const,
        text: `Logged in as ${creds.userId} (region: ${creds.region}, expires ${new Date(token.expiresAt).toISOString().slice(0, 10)}, ~${days} days left).\nThe session will auto-refresh; re-login only when requested.`,
      }],
    };
  });

  // ── how to get SSO token ──

  server.tool('plaud_login_sso_guide', 'Print instructions for obtaining the SSO token from the browser.', async () => {
    return {
      content: [{
        type: 'text' as const,
        text: [
          'To get your Plaud SSO token:',
          '1. Open https://web.plaud.ai and sign in with Google or Apple.',
          "2. Open DevTools Console (Cmd+Option+J on Mac, F12 on Windows).",
          '3. Type: localStorage.pld_tokenstr',
          '4. Copy the full output, including the "Bearer " prefix and quotes.',
          '5. Pass it to the plaud_login_sso tool.',
        ].join('\n'),
      }],
    };
  });

  // ── list / fetch ──

  const recordingIdSchema = { recording_id: z.string().describe('The recording ID') };

  server.tool('plaud_list_recordings', 'List all Plaud recordings with ID, date, duration, and title.', async () => {
    const client = await getClient(auth, config);
    if (!client) return { content: [{ type: 'text' as const, text: 'Not logged in. Use plaud_login or plaud_login_sso first.' }] };
    const recs = await client.listRecordings();
    const result = recs.map(r => ({
      id: r.id,
      title: r.filename,
      date: new Date(r.start_time).toISOString().slice(0, 16),
      duration_minutes: Math.round(r.duration / 60000),
      has_transcript: r.is_trans,
    }));
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  });

  server.tool('plaud_get_transcript', 'Get the verbatim speech transcript of a Plaud recording, as speaker-labeled segments with millisecond timestamps.', recordingIdSchema, async (params) => {
    const client = await getClient(auth, config);
    if (!client) return { content: [{ type: 'text' as const, text: 'Not logged in. Use plaud_login or plaud_login_sso first.' }] };
    const segments = await client.getTranscript(params.recording_id);
    const result = { id: params.recording_id, segment_count: segments.length, segments };
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  });

  server.tool('plaud_get_recording_detail', 'Get metadata for a Plaud recording (title, duration, timestamps). Use `plaud_get_transcript` for the spoken content.', recordingIdSchema, async (params) => {
    const client = await getClient(auth, config);
    if (!client) return { content: [{ type: 'text' as const, text: 'Not logged in. Use plaud_login or plaud_login_sso first.' }] };
    const detail = await client.getRecording(params.recording_id);
    return { content: [{ type: 'text' as const, text: JSON.stringify(detail, null, 2) }] };
  });

  server.tool('plaud_user_info', 'Get current Plaud user information.', async () => {
    const client = await getClient(auth, config);
    if (!client) return { content: [{ type: 'text' as const, text: 'Not logged in. Use plaud_login or plaud_login_sso first.' }] };
    const user = await client.getUserInfo();
    return { content: [{ type: 'text' as const, text: JSON.stringify(user, null, 2) }] };
  });

  server.tool('plaud_get_mp3_url', 'Get a temporary download URL for the MP3 version of a recording.', recordingIdSchema, async (params) => {
    const client = await getClient(auth, config);
    if (!client) return { content: [{ type: 'text' as const, text: 'Not logged in. Use plaud_login or plaud_login_sso first.' }] };
    const url = await client.getMp3Url(params.recording_id);
    const result = { url: url || null, message: url ? 'Temporary URL valid for a short time.' : 'No MP3 available.' };
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error('Failed to start MCP server:', err);
  process.exit(1);
});
