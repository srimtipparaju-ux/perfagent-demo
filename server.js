#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// perf-demo server  —  serves the demo UI + reads local files
// Run: node server.js
// Uses ES module syntax — works whether package.json has
// "type":"module" or not, and on all Node 18+ versions.
// ─────────────────────────────────────────────────────────────
import http  from 'http';
import https from 'https';
import fs    from 'fs';
import path  from 'path';
import os    from 'os';
import { fileURLToPath } from 'url';

// Replicate __dirname (not available in ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const PORT    = 3737;
const UI_FILE = path.join(__dirname, 'public', 'index.html');

// ── File type → skill mapping ─────────────────────────────────
const FILE_SIGNATURES = [
  { skill: 'jmeter-analysis',      exts: ['.csv','.jtl','.xml','.txt','.html'], keywords: ['elapsed','label','responsecode','throughput','90% line','95% line','99% line','average','error %','# samples','jmeter','aggregate report','summary report','tps','latency'] },
  { skill: 'awr-analysis',         exts: ['.html','.htm','.txt'],                keywords: ['snap id','db name','wait events','awr','elapsed time','db time','buffer gets','load profile','top 10 foreground'] },
  { skill: 'sql-monitor-analysis', exts: ['.html','.htm','.txt'],                keywords: ['sql monitoring','a-rows','e-rows','plan operation','sql_id','execution plan','buffer gets','physical read','starts'] },
  { skill: 'sql-tuning',           exts: ['.sql','.txt'],                         keywords: ['select','insert','update','delete','merge','from','where','join'] },
  { skill: 'jfr-analysis',         exts: ['.jfr','.txt','.html'],                keywords: ['jfr','java flight recorder','cpusample','gcphasepause','javamonitorblocked','jmc','flight recording','allocation rate','gc overhead'] },
  { skill: 'heap-dump-analysis',   exts: ['.hprof','.html','.txt'],              keywords: ['heap dump','dominator tree','retained heap','outofmemoryerror','shallow heap','leak suspect','mat','hprof','leak suspects'] },
  // ui-console BEFORE thread-dump — browser logs contain "blocked","waiting" too
  { skill: 'ui-console-analysis',  exts: ['.har','.json','.txt','.log'],         keywords: ['console.log','uncaught','typeerror','net::err','cors','lcp','cls','inp','lighthouse','xhr','fetch','400','401','403','404','500','504','core web vitals','content-type','get http','post http'] },
  { skill: 'thread-dump-analysis', exts: ['.txt','.log'],                        keywords: ['java.lang.thread.state','nid=','tid=','jstack','timed_waiting','monitor entry','locked <','waiting to lock'] },
  { skill: 'stack-trace-analysis', exts: ['.txt','.log'],                        keywords: ['caused by','traceback','at com.','at org.','at java.','nullpointerexception','runtimeexception','outofmemoryerror','stacktrace'] },
];

function detectSkill(filename, content) {
  const ext = path.extname(filename).toLowerCase();
  const low = content.slice(0, 4000).toLowerCase();

  // Hard overrides by extension
  if (ext === '.sql')   return 'sql-tuning';
  if (ext === '.jfr')   return 'jfr-analysis';
  if (ext === '.hprof') return 'heap-dump-analysis';
  if (ext === '.har')   return 'ui-console-analysis';
  if (ext === '.csv')   return 'jmeter-analysis';
  if (ext === '.jtl')   return 'jmeter-analysis';
  if (ext === '.xml' && low.includes('httpsample')) return 'jmeter-analysis';

  // Keyword scoring
  let best = null, bestScore = 0;
  for (const sig of FILE_SIGNATURES) {
    if (!sig.exts.includes(ext) && ext !== '') continue;
    const score = sig.keywords.reduce((n, kw) => n + (low.includes(kw) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; best = sig.skill; }
  }
  return best || 'stack-trace-analysis';
}

function expandPath(p) {
  if (!p) return '';
  // Handle both Unix ~ and Windows-style paths
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return path.resolve(p);
}

function scanFolder(folderPath) {
  const abs = expandPath(folderPath);
  if (!abs) return { error: 'No path provided' };
  if (!fs.existsSync(abs)) return { error: `Path not found: ${abs}` };

  const stat = fs.statSync(abs);

  // Single file — wrap in array
  if (!stat.isDirectory()) {
    const content = readFileSafe(abs);
    return {
      folder: path.dirname(abs),
      files: [{
        name:    path.basename(abs),
        path:    abs,
        size:    stat.size,
        ext:     path.extname(abs).toLowerCase(),
        skill:   detectSkill(path.basename(abs), content),
        preview: content.slice(0, 300),
      }],
    };
  }

  const allowed = ['.html','.htm','.txt','.log','.sql','.jfr','.hprof','.har','.json','.csv','.jtl','.xml'];
  const entries = fs.readdirSync(abs)
    .filter(f => {
      try { return fs.statSync(path.join(abs, f)).isFile(); } catch { return false; }
    })
    .filter(f => allowed.includes(path.extname(f).toLowerCase()))
    .slice(0, 30);

  const files = entries.map(name => {
    const fp      = path.join(abs, name);
    const content = readFileSafe(fp);
    const st      = fs.statSync(fp);
    return {
      name,
      path:    fp,
      size:    st.size,
      ext:     path.extname(name).toLowerCase(),
      skill:   detectSkill(name, content),
      preview: content.slice(0, 300),
    };
  });

  return { folder: abs, files };
}

function readFileSafe(fp) {
  try {
    const ext = path.extname(fp).toLowerCase();

    // Binary files — return descriptive placeholder
    if (ext === '.jfr' || ext === '.hprof') {
      const kb = Math.round(fs.statSync(fp).size / 1024);
      return `[Binary ${ext.toUpperCase()} file — ${kb}KB]\n` +
             `Export a text/HTML report from JMC (for .jfr) or Eclipse MAT (for .hprof) first.`;
    }

    const buf = fs.readFileSync(fp);

    // HAR / JSON — parse and summarise
    if (ext === '.har' || ext === '.json') {
      try {
        const har     = JSON.parse(buf.toString('utf8'));
        const entries = har?.log?.entries || [];
        const lines   = [`HAR: ${entries.length} requests`];
        const sorted  = [...entries].sort((a, b) => (b.time || 0) - (a.time || 0));
        for (const e of sorted.slice(0, 60)) {
          lines.push(
            `${Math.round(e.time || 0)}ms | ${e.request?.method || 'GET'} ` +
            `${e.response?.status || '?'} | ${(e.request?.url || '').slice(0, 100)}`
          );
        }
        return lines.join('\n');
      } catch { /* fall through to plain text */ }
    }

    return buf.toString('utf8').slice(0, 120_000);
  } catch (e) {
    return `[Could not read file: ${e.message}]`;
  }
}

// ── Anthropic API proxy ───────────────────────────────────────
function proxyAnthropic(reqBody, apiKey, res) {
  const body = JSON.stringify(reqBody);
  const opts = {
    hostname: 'api.anthropic.com',
    path:     '/v1/messages',
    method:   'POST',
    headers:  {
      'Content-Type':      'application/json',
      'Content-Length':    Buffer.byteLength(body),
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
  };

  const proxy = https.request(opts, ar => {
    res.writeHead(ar.statusCode, {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    ar.pipe(res);
  });
  proxy.on('error', e => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  });
  proxy.write(body);
  proxy.end();
}

// ── Minimal URL query parser (no dependencies) ────────────────
function parseQuery(rawUrl) {
  const idx = (rawUrl || '/').indexOf('?');
  if (idx === -1) return { pathname: rawUrl || '/', query: {} };
  const pathname = rawUrl.slice(0, idx);
  const query    = {};
  for (const part of rawUrl.slice(idx + 1).split('&')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = decodeURIComponent(part.slice(0, eq));
    const v = decodeURIComponent(part.slice(eq + 1));
    if (k) query[k] = v;
  }
  return { pathname, query };
}

// ── HTTP server ───────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const { pathname, query } = parseQuery(req.url);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET,POST',
      'Access-Control-Allow-Headers': 'Content-Type,x-api-key',
    });
    return res.end();
  }

  // GET /scan?path=...
  if (req.method === 'GET' && pathname === '/scan') {
    const result = scanFolder(query.path || '');
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify(result));
  }

  // GET /file?path=...
  if (req.method === 'GET' && pathname === '/file') {
    const content = readFileSafe(expandPath(query.path || ''));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ content }));
  }

  // POST /analyze  →  streaming proxy to Anthropic
  // Uses stream=true so the UI can show tokens as they arrive
  if (req.method === 'POST' && pathname === '/analyze') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { apiKey, messages, system, model, stream } = JSON.parse(body);
        if (stream) {
          // Streaming mode — pipe SSE directly to client
          const reqBody = JSON.stringify({
            model: model || 'claude-sonnet-4-5',
            max_tokens: 8192, system, messages, stream: true,
          });
          const opts = {
            hostname: 'api.anthropic.com', path: '/v1/messages',
            method: 'POST',
            headers: {
              'Content-Type':      'application/json',
              'Content-Length':    Buffer.byteLength(reqBody),
              'x-api-key':         apiKey,
              'anthropic-version': '2023-06-01',
            },
          };
          res.writeHead(200, {
            'Content-Type':                'text/event-stream',
            'Cache-Control':               'no-cache',
            'Access-Control-Allow-Origin': '*',
          });
          const proxy = https.request(opts, ar => { ar.pipe(res); });
          proxy.on('error', e => res.end(`data: ${JSON.stringify({error:e.message})}

`));
          proxy.write(reqBody);
          proxy.end();
        } else {
          // Non-streaming fallback
          proxyAnthropic(
            { model: model || 'claude-sonnet-4-5', max_tokens: 8192, system, messages },
            apiKey, res
          );
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // POST /correlate  →  run correlation agent via Anthropic
  if (req.method === 'POST' && pathname === '/correlate') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { apiKey, analyses } = JSON.parse(body);

        // Build a compact summary of all findings for the correlator
        const summaries = analyses.map(a => ({
          file: a.fileName,
          skill: a.skill,
          health: a.result.overallHealth,
          summary: a.result.summary,
          keyMetrics: a.result.keyMetrics,
          findings: (a.result.findings || []).slice(0, 8).map(f => ({
            severity: f.severity,
            category: f.category,
            title: f.title,
            evidence: f.evidence,
            rootCause: f.rootCause,
          })),
          // Include first 3KB of raw content for entity extraction
          contentPreview: (a.content || '').slice(0, 3000),
        }));

        const CORRELATOR_SYSTEM = `You are an expert performance incident analyst performing cross-artifact correlation.

IMPORTANT — KEEP OUTPUT CONCISE TO FIT IN TOKEN BUDGET:
- rootCause: maximum 25 words, one sentence
- incidentSummary: maximum 50 words
- Each timeline event: maximum 3 timeline events, evidence under 15 words
- Each causal step: cause/effect under 12 words each
- Each cross-artifact link: significance under 12 words
- Maximum 5 immediate actions, each under 12 words
You MUST close the JSON properly with all closing braces. If running long, truncate descriptions but always finish the JSON structure.

You receive findings from multiple diagnostic tools (AWR, thread dumps, heap dumps, JFR, app logs, SQL, JMeter, browser console, stack traces).
Your job is to:
1. Find connections between findings across different artifacts (e.g. slow SQL in app log matches AWR top SQL; OOM in heap dump explains connection pool exhaustion in thread dump)
2. Build a unified causal chain showing how one problem leads to another
3. Create a timeline of events in chronological order where possible
4. Identify the TRUE root cause — the earliest event in the chain that caused everything else
5. Extract specific entities that link artifacts: request IDs, SQL text fragments, error messages, class names, timestamps

CRITICAL INSTRUCTION: Return ONLY a raw JSON object. Do NOT use markdown code fences. Do NOT include any text before or after the JSON. Your entire response must start with { and end with }.

{
  "rootCause": "One sentence: the single deepest root cause across all artifacts",
  "incidentSummary": "2-3 sentences describing the full incident as a causal chain",
  "overallSeverity": "Critical|High|Medium|Low",
  "timelineEvents": [
    {
      "timestamp": "HH:MM:SS or relative like T+0s",
      "layer": "Frontend|API|Application|Database|JVM|Infrastructure",
      "artifact": "filename that evidences this event",
      "event": "what happened",
      "evidence": "specific quote or number from the artifact",
      "linkedTo": ["other artifact filenames this connects to"],
      "severity": "Critical|High|Medium|Low|Info"
    }
  ],
  "causalChain": [
    {
      "step": 1,
      "cause": "what happened first",
      "effect": "what it caused",
      "sourceArtifact": "filename",
      "targetArtifact": "filename",
      "linkType": "caused|amplified|masked|triggered|exposed"
    }
  ],
  "crossArtifactLinks": [
    {
      "entityType": "SQL|RequestID|ErrorClass|ThreadName|Metric|Timestamp",
      "entityValue": "the shared value linking the artifacts",
      "appearsIn": ["file1", "file2"],
      "significance": "why this link matters"
    }
  ],
  "immediateActions": ["action 1", "action 2", "action 3"]
}`;

        proxyAnthropic(
          {
            model: 'claude-sonnet-4-5',
            max_tokens: 8192,
            system: CORRELATOR_SYSTEM,
            messages: [{
              role: 'user',
              content: `Correlate these ${analyses.length} diagnostic artifacts and build a unified incident timeline:

${JSON.stringify(summaries, null, 2)}`
            }]
          },
          apiKey,
          res
        );
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // POST /chat  →  conversational follow-up over the incident
  if (req.method === 'POST' && pathname === '/chat') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { apiKey, system, messages } = JSON.parse(body);
        proxyAnthropic(
          { model: 'claude-sonnet-4-5', max_tokens: 2048, system, messages },
          apiKey, res
        );
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // GET / or /index.html  →  serve UI
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    try {
      const html = fs.readFileSync(UI_FILE);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(html);
    } catch {
      res.writeHead(404);
      return res.end('UI not found — make sure you are running node server.js from the perf-demo folder.');
    }
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  ╔════════════════════════════════════════╗');
  console.log('  ║       PerfAgent Demo Server            ║');
  console.log('  ╠════════════════════════════════════════╣');
  console.log(`  ║  Open: http://localhost:${PORT}         ║`);
  console.log('  ║                                        ║');
  console.log('  ║  Sample files: .\\sample-files\\         ║');
  console.log('  ║  Press Ctrl+C to stop                  ║');
  console.log('  ╚════════════════════════════════════════╝');
  console.log('');
});
