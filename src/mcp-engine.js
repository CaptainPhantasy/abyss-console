
    /* ================================================================
       Desktop Commander MCP engine — permission gates + MCP client.
       Executes before the app bundle; the app reads globalThis.DCEngine.
       Single source of truth for gating; E2E-tested in
       tests/dc-gate.e2e.mjs against a mock Streamable-HTTP MCP server.
       ================================================================ */
    (() => {
      "use strict";

      /* ---- Risk taxonomy --------------------------------------------
         Fail-safe rule: a tool must be PROVABLY read-only to auto-run.
         Unknown names are always treated as risky.                    */
      const SAFE = new Set(["read_file","read_text_file","read_multiple_text_files","list_directory","directory_tree","search_files","search_code","list_processes","get_command_status","read_output","get_config","get_interaction_settings","list_allowed_directories","info","file_info","list_sessions","list_code_definition_names","search_config"]);
      const RISKY = new Set(["write_file","write_text_file","edit_block","edit_file","create_directory","move_file","delete_file","delete_directory","start_process","execute_command","run_command","force_terminate","kill_process","send_keystrokes","open_native_app","set_config_value","set_interaction_settings","download_file","create_session","reset_session","close_session"]);
      const RISKY_VERB = /^(write|edit|create|delete|remove|move|copy|rename|kill|terminate|execute|run|start|send|set|put|post|patch|install|uninstall|download|open|reset|clear|flush|drop|truncate)/i;

      function classifyRisk(name) {
        const n = String(name || "");
        if (SAFE.has(n) && !RISKY.has(n)) return "safe";
        if (RISKY.has(n) || RISKY_VERB.test(n)) return "risky";
        return "unknown"; /* == risky wherever it matters */
      }

      const GATES = ["PLAN", "ASK ALWAYS", "ASK WHEN NEEDED", "YOLO"];

      function decide(mode, toolName) {
        const risk = classifyRisk(toolName);
        switch (mode) {
          case "PLAN":            return { exec: "block", risk, reason: "PLAN mode: tool execution disabled (planning only)" };
          case "ASK ALWAYS":      return { exec: "ask",   risk, reason: "ASK ALWAYS: every tool call needs explicit approval" };
          case "ASK WHEN NEEDED": return risk === "safe"
                                    ? { exec: "auto", risk, reason: "read-only tool" }
                                    : { exec: "ask",  risk, reason: "risky/damaging or unknown tool" };
          case "YOLO":            return { exec: "auto",  risk, reason: "YOLO: no approval prompts" };
          default:                return { exec: "block", risk, reason: "unknown gate (fail-safe)" };
        }
      }

      /* ---- MCP client: Streamable HTTP primary, legacy SSE fallback -- */
      const PROTO = "2025-06-18";
      let seq = 0;

      function tsignal(ms, external) {
        const ac = new AbortController();
        const t = setTimeout(() => { try { ac.abort(new Error("MCP timeout after " + ms + "ms")); } catch {} }, ms);
        const onAbort = () => { clearTimeout(t); try { ac.abort(external && external.reason); } catch {} };
        if (external) { if (external.aborted) onAbort(); else external.addEventListener("abort", onAbort, { once: true }); }
        return { signal: ac.signal, done: () => { clearTimeout(t); if (external) external.removeEventListener("abort", onAbort); } };
      }

      async function readBody(res) {
        const ct = (res.headers.get("content-type") || "").toLowerCase();
        if (ct.includes("text/event-stream")) {
          const reader = res.body.getReader(), dec = new TextDecoder();
          let buf = "", hit = null;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const parts = buf.split(/\r?\n/); buf = parts.pop();
            for (const line of parts) {
              if (!line.startsWith("data:")) continue;
              const p = line.slice(5).trim();
              if (!p || p === "[DONE]") continue;
              try { const j = JSON.parse(p); if (j && typeof j.id === "number") hit = j; } catch {}
            }
          }
          return hit;
        }
        const text = await res.text(); /* text first — error bodies are not always JSON */
        try { return JSON.parse(text); } catch { throw new Error("MCP bad response (HTTP " + res.status + "): " + text.slice(0, 200)); }
      }

      class McpSession {
        constructor(url) { this.url = String(url || "").replace(/\/+$/, ""); this.sessionId = null; this.tools = []; this.status = "idle"; this.lastError = null; this.transport = null; this._sse = null; }
        async rpc(method, params, ms = 30000, ext) {
          const body = { jsonrpc: "2.0", id: ++seq, method, ...(params ? { params } : {}) };
          const { signal, done } = tsignal(ms, ext);
          try {
            const headers = { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" };
            if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
            const res = await fetch(this.url + "/mcp", { method: "POST", headers, body: JSON.stringify(body), signal });
            const sid = res.headers.get("mcp-session-id"); if (sid) this.sessionId = sid;
            if (!res.ok) { const t = await res.text().catch(() => ""); throw new Error("MCP HTTP " + res.status + (t ? " — " + t.slice(0, 200) : "")); }
            return await readBody(res);
          } finally { done(); }
        }
        async notify(method) {
          const headers = { "Content-Type": "application/json" };
          if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
          const res = await fetch(this.url + "/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", method }) });
          if (!res.ok) throw new Error("MCP notify HTTP " + res.status);
        }
        async _sseConnect() {
          const base = this.url;
          const res = await fetch(base + "/sse", { headers: { Accept: "text/event-stream" } });
          if (!res.ok) throw new Error("legacy SSE connect failed: HTTP " + res.status);
          const reader = res.body.getReader(), dec = new TextDecoder();
          this._sse = { reader, endpoint: null, pending: new Map(), onEndpoint: null };
          (async () => {
            let buf = "";
            try {
              for (;;) {
                const { done, value } = await reader.read(); if (done) break;
                buf += dec.decode(value, { stream: true });
                const lines = buf.split(/\r?\n/); buf = lines.pop();
                let ev = "";
                for (const line of lines) {
                  if (line.startsWith("event:")) ev = line.slice(6).trim();
                  else if (line.startsWith("data:")) {
                    const d = line.slice(5).trim(); 
                    if (ev === "endpoint" || (ev === "" && d.startsWith("/"))) { this._sse.endpoint = new URL(d, base).toString(); if (this._sse.onEndpoint) this._sse.onEndpoint(); }
                    else { try { const j = JSON.parse(d); if (j && typeof j.id === "number" && this._sse.pending.has(j.id)) { this._sse.pending.get(j.id)(j); this._sse.pending.delete(j.id); } } catch {} }
                    ev = "";
                  }
                }
              }
            } catch {}
          })();
          await new Promise((ok, bad) => { this._sse.onEndpoint = ok; setTimeout(() => bad(new Error("SSE endpoint event timeout")), 10000); });
          this.transport = "sse";
        }
        async _sseRpc(method, params, ms = 30000) {
          const id = ++seq;
          const body = { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) };
          const p = new Promise((ok, bad) => { this._sse.pending.set(id, ok); setTimeout(() => { if (this._sse.pending.delete(id)) bad(new Error("SSE rpc timeout")); }, ms); });
          const res = await fetch(this._sse.endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
          if (!res.ok) throw new Error("SSE POST failed: HTTP " + res.status);
          return await p;
        }
        async call(method, params, ms, ext) { return this.transport === "sse" ? this._sseRpc(method, params, ms) : this.rpc(method, params, ms, ext); }
        async connect() {
          this.status = "connecting"; this.lastError = null; emit();
          try {
            try {
              await this.rpc("initialize", { protocolVersion: PROTO, capabilities: {}, clientInfo: { name: "deepseek-api-console", version: "1.1" } });
              this.transport = "streamable-http";
              await this.notify("notifications/initialized").catch(() => {});
            } catch (e) {
              if (!/HTTP 4\d\d|Failed to fetch|fetch failed|Load failed|NetworkError/i.test(String(e.message))) throw e;
              await this._sseConnect();
              await this._sseRpc("initialize", { protocolVersion: PROTO, capabilities: {}, clientInfo: { name: "deepseek-api-console", version: "1.1" } });
              await this._sseRpc("notifications/initialized").catch(() => {});
            }
            const listed = await this.call("tools/list", {});
            this.tools = (listed && listed.result && listed.result.tools) || [];
            if (!this.tools.length) throw new Error("server listed zero tools");
            this.status = "ready"; emit(); return this.snapshot();
          } catch (e) { this.status = "error"; this.lastError = String(e.message || e); this.lastReason = reasonFor(this.lastError, await quickReachable(this.url), this.url, false); emit(); throw e; }
        }
        toolNames() { return new Set(this.tools.map(t => t.name)); }
        openAiTools() { return this.tools.map(t => ({ type: "function", function: { name: t.name, description: t.description || "", parameters: t.inputSchema || t.parameters || { type: "object", properties: {} } } })); }
        async callTool(name, args, ext) {
          if (this.status !== "ready") throw new Error("MCP not connected (status " + this.status + ")");
          if (!this.toolNames().has(name)) throw new Error('tool "' + name + '" was not in tools/list — refusing');
          const r = await this.call("tools/call", { name, arguments: args ?? {} }, 180000, ext);
          const out = r && r.result;
          if (!out) throw new Error((r && r.error && r.error.message) || "empty tools/call response");
          if (out.isError) throw new Error("tool error: " + textOf(out));
          return textOf(out);
        }
        snapshot() { return { status: this.status, url: this.url, transport: this.transport, sessionId: this.sessionId, tools: this.tools.map(t => ({ name: t.name, risk: classifyRisk(t.name) })), lastError: this.lastError, lastReason: this.lastReason || null }; }
      }

      /* ---- WebSocket MCP transport (GEMINI bridge, port 13001) ------ */
      class WsSession {
        constructor(url, token) {
          this.httpUrl = String(url || "").replace(/\/+$/, "");
          this.token = token ? String(token).trim() : "";
          this.wsUrl = this.httpUrl.replace(/^http/i, "ws") + "/mcp" + (this.token ? "?token=" + encodeURIComponent(this.token) : "");
          this.sessionId = null; this.tools = []; this.status = "idle"; this.lastError = null; this.lastReason = null;
          this.transport = null; this.ws = null; this._seq = 0; this._pending = new Map();
        }
        _open(ms = 8000) {
          return new Promise((ok, bad) => {
            const WS = globalThis.WebSocket;
            if (!WS) return bad(new Error("no WebSocket in this runtime"));
            let settled = false;
            const timer = setTimeout(() => { if (!settled) { settled = true; try { this.ws && this.ws.close(); } catch {} bad(new Error("WS open timeout after " + ms + "ms")); } }, ms);
            let ws;
            try { ws = new WS(this.wsUrl); } catch (e) { clearTimeout(timer); settled = true; return bad(new Error("WS URL rejected: " + String(e && e.message || e))); }
            this.ws = ws;
            ws.onopen = () => { if (!settled) { settled = true; clearTimeout(timer); ok(); } };
            ws.onerror = () => { if (!settled) { settled = true; clearTimeout(timer); bad(new Error("WS connect failed — upgrade refused (wrong URL/port)")); } };
            ws.onclose = () => { if (!settled) { settled = true; clearTimeout(timer); bad(new Error("WS closed during handshake — token rejected (verifyWsClient)")); } };
            ws.onmessage = ev => {
              let j = null; try { j = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data)); } catch { return; }
              if (j && typeof j.id === "number" && this._pending.has(j.id)) {
                const h = this._pending.get(j.id); this._pending.delete(j.id);
                j.error ? h.bad(new Error("MCP ws error " + (j.error.code || "") + ": " + (j.error.message || ""))) : h.ok(j);
              }
            };
          });
        }
        async rpc(method, params, ms = 30000) {
          const id = ++this._seq;
          const body = { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) };
          const p = new Promise((ok, bad) => {
            const timer = setTimeout(() => { if (this._pending.delete(id)) bad(new Error("MCP ws timeout (" + method + ")")); }, ms);
            this._pending.set(id, { ok: v => { clearTimeout(timer); ok(v); }, bad: e => { clearTimeout(timer); bad(e); } });
          });
          if (!this.ws || this.ws.readyState !== 1) throw new Error("WS not open (state " + (this.ws ? this.ws.readyState : "none") + ")");
          this.ws.send(JSON.stringify(body));
          return await p;
        }
        notify(method) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ jsonrpc: "2.0", method })); }
        async connect() {
          this.status = "connecting"; this.lastError = null; emit();
          try {
            await this._open();
            this.transport = "websocket";
            /* Standard MCP servers want initialize; the GEMINI bridge dispatcher
               accepts only tools/list | tools/call | mcp/configure_servers — so a
               rejected initialize is not fatal, we just skip the handshake. */
            try {
              await this.rpc("initialize", { protocolVersion: PROTO, capabilities: {}, clientInfo: { name: "deepseek-api-console", version: "1.2" } });
              this.notify("notifications/initialized");
            } catch (eInit) {
              if (!/unknown method|initialize|-3260[13]/i.test(String(eInit && eInit.message || eInit))) throw eInit;
            }
            let listed = await this.rpc("tools/list", {});
            this.tools = (listed && (Array.isArray(listed.result) ? listed.result : listed.result && listed.result.tools)) || [];
            if (!this.tools.length) {
              /* DC child may still be spawning — one bounded warm-up retry */
              await new Promise(r => setTimeout(r, 2500));
              listed = await this.rpc("tools/list", {});
              this.tools = (listed && (Array.isArray(listed.result) ? listed.result : listed.result && listed.result.tools)) || [];
            }
            if (!this.tools.length) throw new Error("server listed zero tools");
            this.status = "ready"; emit(); return this.snapshot();
          } catch (e) {
            this.status = "error"; this.lastError = String(e.message || e);
            this.lastReason = reasonFor(this.lastError, await quickReachable(this.httpUrl), this.httpUrl, !!this.token);
            emit(); throw e;
          }
        }
        toolNames() { return new Set(this.tools.map(t => t.name)); }
        openAiTools() { return this.tools.map(t => ({ type: "function", function: { name: t.name, description: t.description || "", parameters: t.inputSchema || t.parameters || { type: "object", properties: {} } } })); }
        async callTool(name, args) {
          if (this.status !== "ready") throw new Error("MCP not connected (status " + this.status + ")");
          if (!this.toolNames().has(name)) throw new Error('tool "' + name + '" was not in tools/list — refusing');
          const r = await this.rpc("tools/call", { name, arguments: args ?? {} }, 180000);
          const out = r && r.result;
          if (!out) throw new Error((r && r.error && r.error.message) || "empty tools/call response");
          if (out.isError) throw new Error("tool error: " + textOf(out));
          return textOf(out);
        }
        snapshot() { return { status: this.status, url: this.httpUrl, transport: this.transport, sessionId: null, tools: this.tools.map(t => ({ name: t.name, risk: classifyRisk(t.name) })), lastError: this.lastError, lastReason: this.lastReason || null }; }
      }

      /* ---- Phased diagnostics (never fail silently again) ----------- */
      async function probe(url, token) {
        const u = String(url || "").replace(/\/+$/, "");
        const out = { url: u, ok: false, code: null, headline: "", detail: "", advice: "", reachable: null, transport: null, tools: 0, tokenPresent: !!token, origin: (typeof location !== "undefined" && location && location.origin) || null, phases: [] };
        const ph = (name, note) => out.phases.push(name + ": " + note);
        if (!/^https?:\/\/.+/.test(u)) { out.code = "bad-url"; out.headline = "Not a valid http(s) URL"; out.advice = "Example: http://127.0.0.1:13001"; ph("parse", "invalid URL"); return out; }
        try { await fetch(u + "/health", { mode: "no-cors", signal: AbortSignal.timeout(4000) }); out.reachable = true; ph("reachability GET /health (no-cors)", "answered — something IS listening"); }
        catch (e) { out.reachable = false; ph("reachability GET /health (no-cors)", "no answer — connection refused / unreachable"); }
        if (token) {
          const s = new WsSession(u, token);
          try { const snap = await s.connect(); out.ok = true; out.code = "ok"; out.transport = "websocket"; out.tools = snap.tools.length; out.headline = "GEMINI bridge reachable — WebSocket MCP OK, " + snap.tools.length + " tools"; ph("ws-mcp handshake", "initialize + tools/list OK"); try { s.ws && s.ws.close(); } catch {} return out; }
          catch (e) { const r = reasonFor(String(e.message || e), out.reachable, u, true); out.code = r.code; out.headline = r.headline; out.advice = r.advice; out.detail = String(e.message || e); ph("ws-mcp handshake", r.code + " — " + out.detail); }
        } else ph("ws-mcp handshake", "skipped — no session token pasted");
        try {
          const r = await fetch(u + "/mcp", { signal: AbortSignal.timeout(4000) });
          const t = await r.text().catch(() => "");
          ph("GET /mcp (cors)", "HTTP " + r.status + (t ? " — \"" + t.slice(0, 60) + "\"" : ""));
          if (/use websocket/i.test(t)) { out.code = out.code || "needs-token"; out.headline = out.headline || "GEMINI bridge detected — it speaks WebSocket MCP, not HTTP"; out.advice = out.advice || "Paste the session token (" + BRIDGE_TOKEN + ") so the console opens ws://…/mcp."; return out; }
        } catch (e) { ph("GET /mcp (cors)", out.reachable ? "response blocked by CORS (server up, page origin not allowed)" : "network failure"); }
        const s = new McpSession(u);
        try { const snap = await s.connect(); out.ok = true; out.code = "ok"; out.transport = snap.transport; out.tools = snap.tools.length; out.headline = "MCP server reachable — " + snap.transport + ", " + snap.tools.length + " tools"; ph("http-mcp ladder", "OK"); return out; }
        catch (e) { const r = reasonFor(String(e.message || e), out.reachable, u, !!token); out.code = r.code; out.headline = r.headline; out.advice = r.advice; out.detail = String(e.message || e); ph("http-mcp ladder", r.code + " — " + out.detail); }
        return out;
      }

      function textOf(out) {
        if (typeof out.content === "string") return out.content;
        if (Array.isArray(out.content)) return out.content.map(c => typeof c === "string" ? c : c && c.type === "text" ? c.text : JSON.stringify(c)).join("\n");
        if (typeof out.text === "string") return out.text;
        return JSON.stringify(out);
      }

      /* ---- Failure classification (shared by connect + probe) ------ */
      const BRIDGE_START = "launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.floydslabs.gemini.desktop-commander-mcp.plist && launchctl kickstart -k gui/$UID/com.floydslabs.gemini.desktop-commander-mcp";
      const BRIDGE_TOKEN = "cat ~/.gemini-for-macos/session-token";
      function reasonFor(msg, reachable, url, hasToken) {
        const m = String(msg || "");
        const pageOrigin = (typeof location !== "undefined" && location && location.origin) || null;
        if (/WS closed during handshake|upgrade refused/i.test(m))
          return hasToken
            ? { code: "bad-token", headline: "Bridge rejected the token (WebSocket closed during handshake)", advice: "Re-copy it: " + BRIDGE_TOKEN + " — it rotates if the server restarts without its stored file." }
            : { code: "needs-token", headline: "GEMINI bridge requires a session token before it accepts a WebSocket", advice: "Paste the token from: " + BRIDGE_TOKEN };
        if (/Failed to fetch|fetch failed|Load failed|NetworkError|ECONNREFUSED/i.test(m))
          return reachable === false
            ? { code: "server-down", headline: "Nothing is listening at " + (url || "?"), advice: "Start the GEMINI Desktop Commander bridge: " + BRIDGE_START }
            : { code: "cors", headline: "Server is running but blocks this page's origin (CORS)", advice: "Serve the console from a loopback origin or allow " + (pageOrigin || "this origin") + " in the bridge's CORS middleware." };
        const st = m.match(/HTTP (\d{3})/);
        if (st) {
          const code = +st[1];
          if (code === 404 || code === 400 || /Use WebSocket/i.test(m))
            return { code: "needs-token", headline: "Port answers but serves no HTTP MCP endpoint (the GEMINI bridge speaks WebSocket)", advice: "Paste the session token (" + BRIDGE_TOKEN + ") so the console opens ws://…/mcp, or point the URL at a Streamable-HTTP MCP server." };
          if (code === 401)
            return { code: "bad-token", headline: "Server answered 401 Unauthorized", advice: "Token mismatch — re-copy it: " + BRIDGE_TOKEN };
          return { code: "http-error", headline: "MCP endpoint returned HTTP " + code, advice: "Check URL/port — " + code + " from the bridge usually means a wrong path or auth failure." };
        }
        if (/zero tools/i.test(m))
          return { code: "no-tools", headline: "Connected, but the server listed zero tools", advice: "The bridge failed to launch its Desktop Commander child — check /tmp/gemini-desktop-commander-mcp.err.log." };
        return { code: "protocol", headline: m.slice(0, 160) || "unknown failure", advice: "Run diagnose in Settings for the phased report." };
      }

      /* one-shot liveness: no-cors fetch resolves (opaquely) for ANY http answer */
      async function quickReachable(u) {
        try { await fetch(String(u || "").replace(/\/+$/, "") + "/health", { mode: "no-cors", signal: AbortSignal.timeout(2500) }); return true; }
        catch { return false; }
      }

      const CAP = 12000;
      function sanitizeToolResult(t) {
        const s = String(t ?? "");
        return s.length > CAP ? s.slice(0, CAP) + "\n…[truncated " + (s.length - CAP).toLocaleString() + " chars]" : s;
      }

      /* ---- Approval queue (fail-safe: auto-deny after 10 minutes) --- */
      const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;
      const pending = new Map();
      let aid = 0;
      function requestApproval(info) {
        const id = "apr_" + (++aid);
        return new Promise(resolve => {
          const timer = setTimeout(() => finish(id, false), APPROVAL_TIMEOUT_MS);
          pending.set(id, { id, ...info, resolve: v => { clearTimeout(timer); resolve(v); } });
          emit();
        });
      }
      function finish(id, ok) { const p = pending.get(id); if (!p) return false; pending.delete(id); p.resolve(!!ok); emit(); return true; }
      function resolveApproval(id, ok) { return finish(id, !!ok); }
      function denyAll() { for (const id of [...pending.keys()]) finish(id, false); }
      function pendingList() { return [...pending.values()].map(({ id, name, args, risk, mode, reason }) => ({ id, name, args, risk, mode, reason })); }

      /* ---- Guarded pipeline: decide → (approve) → execute → sanitize -- */
      async function runGuarded(mode, name, args, opts = {}) {
        const decision = decide(mode, name);
        if (decision.exec === "block") return { status: "blocked", name, ...decision };
        if (decision.exec === "ask") {
          const ok = await requestApproval({ name, args, risk: decision.risk, mode, reason: decision.reason });
          if (!ok) return { status: "denied", name, ...decision };
        }
        try {
          const raw = await session.callTool(name, args, opts.signal);
          return { status: "executed", name, risk: decision.risk, result: sanitizeToolResult(raw) };
        } catch (e) {
          return { status: "error", name, risk: decision.risk, error: String(e.message || e) };
        }
      }

      /* ---- System-prompt contract per gate --------------------------- */
      function contract(gate) {
        if (gate === "PLAN") return "\n\nTOOLS: Desktop Commander MCP (local file & command tools) is CONNECTED but the gate is PLAN — tool calls will NOT be executed. Emit tool calls only to outline a step-by-step plan, then summarize the plan in prose for the human to approve.";
        if (gate === "ASK ALWAYS") return "\n\nTOOLS: Desktop Commander MCP (local file & command tools) is CONNECTED under gate ASK ALWAYS — the human must approve EVERY tool call before it runs. Prefer few, purposeful calls; batch independent reads into one turn where possible.";
        if (gate === "ASK WHEN NEEDED") return "\n\nTOOLS: Desktop Commander MCP (local file & command tools) is CONNECTED under gate ASK WHEN NEEDED — read-only tools run automatically; writes/edits/deletes/commands require human approval. Prefer read-first workflows (read_file, list_directory, search_code) before proposing writes.";
        return "\n\nTOOLS: Desktop Commander MCP (local file & command tools) is CONNECTED under gate YOLO — every tool call executes immediately with no approval. Act autonomously; keep changes scoped to the working directory; never run commands that alter system state beyond the project.";
      }

      /* ---- Wiring ----------------------------------------------------- */
      let session = null;
      const subs = new Set();
      function emit() { for (const cb of subs) { try { cb(); } catch {} } }
      async function connect(url, token) {
        if (token) { session = new WsSession(url, token); return session.connect(); } /* GEMINI bridge: token ⇒ WebSocket transport */
        session = new McpSession(url); return session.connect();
      }
      function state() { return session ? session.snapshot() : { status: "idle", url: null, transport: null, sessionId: null, tools: [], lastError: null }; }
      function openAiTools() { return session && session.status === "ready" ? session.openAiTools() : []; }

      globalThis.DCEngine = { classifyRisk, decide, GATES, connect, probe, reasonFor, state, openAiTools, runGuarded, resolveApproval, denyAll, pendingList, requestApproval, contract, sanitizeToolResult, onChange(cb) { subs.add(cb); return () => subs.delete(cb); } };
    })();
    