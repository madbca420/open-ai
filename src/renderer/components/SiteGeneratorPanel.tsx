import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Globe,
  Download,
  AlertTriangle,
  Loader2,
  Cpu,
  Monitor,
  Wand2,
  Eye,
  Play,
  RotateCw,
  Square,
  ExternalLink,
  Copy,
  Terminal,
  Activity,
  Server,
  Database,
} from 'lucide-react';
import { BuildLoopStatus, DiffResult } from '../../main/preload';
import DiffModal from './DiffModal';
import { callBrowserSiteGenAI } from '../browserApiConfig';

const starterPrompts = [
  'Create a premium 3D travel agency website for Karnataka with frontend, backend, destination pages, tour packages, enquiry form, booking system, responsive design, animations and live preview.',
  'Launch a full-stack e-commerce store with product catalog, cart management, checkout REST API, and dark theme.',
  'Build an interactive restaurant site with digital menu, online table reservation form, and order backend.',
  'Design an AI SaaS studio dashboard with real-time charts, prompt shell, and subscription pricing.',
];

export default function SiteGeneratorPanel() {
  const [prompt, setPrompt] = useState('');
  const [provider, setProvider] = useState<string>('google');
  const [modelName, setModelName] = useState<string>('gemini-1.5-flash');
  const [isGenerating, setIsGenerating] = useState(false);

  const [status, setStatus] = useState<BuildLoopStatus | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [backendUrl, setBackendUrl] = useState<string | null>(null);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [zipMessage, setZipMessage] = useState<string | null>(null);

  const [logs, setLogs] = useState<string[]>([]);
  const [iframeKey, setIframeKey] = useState<number>(0);
  const [browserPreviewHtml, setBrowserPreviewHtml] = useState<string | null>(null);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);

  useEffect(() => {
    if (!window.electronAPI) return;
    const unsub = window.electronAPI.onSiteStatusUpdate((newStatus) => {
      setStatus(newStatus);
      if (newStatus.previewUrl) setPreviewUrl(newStatus.previewUrl);
      if (newStatus.backendUrl) setBackendUrl(newStatus.backendUrl);
      if (newStatus.logs) setLogs(newStatus.logs);
      if (newStatus.projectSlug) setSiteId(newStatus.projectSlug);
    });
    return unsub;
  }, []);

  // Browser-mode fallback
  const handleGenerateBrowserMode = async () => {
    if (!prompt.trim() || isGenerating) return;
    setIsGenerating(true);
    setBrowserError(null);
    setBrowserPreviewHtml(null);
    setLogs([`[${new Date().toLocaleTimeString()}] Starting browser-mode single-file HTML generator...`]);
    setStatus({ step: 'planning', attempt: 1, maxAttempts: 1 });

    try {
      setStatus({ step: 'writing', attempt: 1, maxAttempts: 1 });
      const html = await callBrowserSiteGenAI(prompt.trim());
      setBrowserPreviewHtml(html);
      setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] Generation complete — rendering live srcdoc frame.`]);
      setStatus({
        step: 'success',
        attempt: 1,
        maxAttempts: 1,
        previewUrl: 'browser-srcdoc',
        health: { frontend: 'RUNNING', backend: 'UNAVAILABLE', api: 'UNAVAILABLE', database: 'UNAVAILABLE' },
      });
    } catch (err: any) {
      setBrowserError(err?.message || String(err));
      setStatus({ step: 'failed', attempt: 1, maxAttempts: 1, errorLog: err?.message });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim() || isGenerating) return;

    if (window.electronAPI) {
      setIsGenerating(true);
      setZipMessage(null);
      setBrowserPreviewHtml(null);
      setLogs([`[${new Date().toLocaleTimeString()}] Initializing full-stack builder pipeline...`]);
      setStatus({ step: 'planning', attempt: 1, maxAttempts: 5 });

      const result = await window.electronAPI.generateSite({
        prompt: prompt.trim(),
        provider,
        modelName,
      });

      setIsGenerating(false);

      if (result.success && result.siteId && result.previewUrl) {
        setSiteId(result.siteId);
        setPreviewUrl(result.previewUrl);
        if (result.backendUrl) setBackendUrl(result.backendUrl);
      }
    } else {
      await handleGenerateBrowserMode();
    }
  };

  const handleOpenChrome = async () => {
    const targetUrl = previewUrl || 'http://localhost:5173';
    if (window.electronAPI) {
      await window.electronAPI.launchChrome(targetUrl);
    } else {
      window.open(targetUrl, '_blank');
    }
  };

  const handleRefreshPreview = () => {
    setIframeKey((k) => k + 1);
  };

  const handleRestartServers = async () => {
    if (!siteId || !window.electronAPI) return;
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] Restarting project servers for ${siteId}...`]);
    const res = await window.electronAPI.restartProject(siteId);
    if (res.success && res.previewUrl) {
      setPreviewUrl(res.previewUrl);
      setIframeKey((k) => k + 1);
      setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] Servers restarted cleanly at ${res.previewUrl}`]);
    }
  };

  const handleStopProject = async () => {
    if (!siteId || !window.electronAPI) return;
    await window.electronAPI.stopProject(siteId);
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] Project processes stopped.`]);
    setStatus((s) => s ? { ...s, health: { frontend: 'STOPPED', backend: 'STOPPED', api: 'DISCONNECTED', database: 'UNAVAILABLE' } } : null);
  };

  const handleExportZip = async () => {
    if (!siteId || !window.electronAPI) return;
    const res = await window.electronAPI.exportSiteZip(siteId);
    if (res.success && res.zipPath) {
      setZipMessage(`Exported ZIP: ${res.zipPath}`);
    } else {
      setZipMessage(`Export Error: ${res.error || 'Failed'}`);
    }
    setTimeout(() => setZipMessage(null), 4000);
  };

  const handleCopyUrl = () => {
    if (previewUrl) {
      navigator.clipboard.writeText(previewUrl);
      setZipMessage(`Copied: ${previewUrl}`);
      setTimeout(() => setZipMessage(null), 3000);
    }
  };

  const health = status?.health;

  return (
    <div className="flex flex-col h-full overflow-hidden p-4 space-y-4 font-mono relative">
      <DiffModal
        diffResult={diffResult}
        onConfirm={() => setDiffResult(null)}
        onCancel={() => setDiffResult(null)}
      />

      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b border-theme-border pb-3 shrink-0">
        <div className="space-y-1">
          <div className="flex items-center space-x-2.5">
            <div className="rounded-lg border border-theme-primary/40 bg-theme-primary/10 p-2">
              <Globe className="w-5 h-5 text-theme-primary animate-pulse" />
            </div>
            <div>
              <h2 className="text-xs font-bold tracking-[0.3em] text-theme-primary uppercase">
                UNIVERSAL FULL-STACK STUDIO // LIVE PREVIEW ENGINE
              </h2>
              <p className="text-[11px] text-theme-muted">
                Generates React, Vite, Tailwind, 3D & Node/Express backends stored directly in <code className="text-cyan-400">generated_sites/</code>.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-theme-border bg-black/50 px-2.5 py-1.5 text-[10px] text-theme-accent">
          <Cpu className="w-3.5 h-3.5" />
          <select
            value={`${provider}:${modelName}`}
            onChange={(e) => {
              const [p, m] = e.target.value.split(':');
              setProvider(p);
              setModelName(m);
            }}
            className="bg-transparent text-theme-text focus:outline-none font-bold"
          >
            <option value="google:gemini-1.5-flash">Google Gemini 1.5 Flash</option>
            <option value="google:gemini-1.5-pro">Google Gemini 1.5 Pro</option>
            <option value="openai:gpt-4o">OpenAI GPT-4o</option>
            <option value="anthropic:claude-3-5-sonnet-20241022">Anthropic Claude 3.5 Sonnet</option>
            <option value="omniroute:auto">OmniRoute Gateway Auto</option>
          </select>
        </div>
      </div>

      <div className="grid flex-1 min-h-0 gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        {/* Left Column — Prompt & Logs */}
        <div className="flex min-h-0 flex-col gap-4">
          <div className="rounded-xl border border-theme-border bg-black/40 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-theme-muted">Project Prompt</p>
                <p className="text-[11px] text-theme-accent">Request any frontend, backend, or 3D web experience</p>
              </div>
              <div className="rounded-full border border-theme-primary/30 bg-theme-primary/10 px-2 py-1 text-[10px] font-bold text-theme-primary">
                {isGenerating ? 'GENERATING…' : 'READY'}
              </div>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder='e.g. "Create a 3D travel website for Karnataka with packages, booking system & backend"'
                className="flex-1 rounded-lg border border-theme-border bg-black/60 px-3 py-2 text-xs text-theme-text placeholder-theme-muted/50 focus:border-theme-primary focus:outline-none"
                onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
              />
              <button
                onClick={handleGenerate}
                disabled={!prompt.trim() || isGenerating}
                className="flex shrink-0 items-center space-x-1.5 rounded-lg border border-theme-primary bg-theme-primary/20 px-4 py-2 text-xs font-bold text-theme-accent transition hover:bg-theme-primary/30 disabled:opacity-40"
              >
                {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                <span>GENERATE</span>
              </button>
            </div>

            <div className="space-y-1.5">
              <p className="text-[9px] uppercase tracking-widest text-theme-muted">Starter presets</p>
              <div className="flex flex-col gap-1.5">
                {starterPrompts.map((entry) => (
                  <button
                    key={entry}
                    onClick={() => setPrompt(entry)}
                    className="text-left rounded-lg border border-theme-border bg-black/40 px-2.5 py-1.5 text-[10px] text-theme-text transition hover:border-theme-primary hover:text-theme-accent line-clamp-1"
                  >
                    {entry}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Live Health Status Bar */}
          <div className="rounded-xl border border-theme-border bg-black/40 p-3 space-y-2.5">
            <div className="flex items-center justify-between border-b border-theme-border pb-2">
              <div className="flex items-center space-x-2">
                <Activity className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-[10px] uppercase tracking-[0.3em] text-theme-muted">Live Services Health</span>
              </div>
              {siteId && (
                <span className="text-[10px] text-cyan-400 font-bold">
                  Folder: generated_sites/{siteId}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div className="flex items-center justify-between rounded-lg border border-theme-border bg-black/50 p-2">
                <span className="flex items-center space-x-1.5">
                  <Monitor className="w-3 h-3 text-theme-muted" />
                  <span>Frontend</span>
                </span>
                <span className={`font-bold ${health?.frontend === 'RUNNING' ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {health?.frontend || 'READY'}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-theme-border bg-black/50 p-2">
                <span className="flex items-center space-x-1.5">
                  <Server className="w-3 h-3 text-theme-muted" />
                  <span>Backend</span>
                </span>
                <span className={`font-bold ${health?.backend === 'RUNNING' ? 'text-emerald-400' : health?.backend === 'UNAVAILABLE' ? 'text-theme-muted' : 'text-amber-400'}`}>
                  {health?.backend || 'UNAVAILABLE'}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-theme-border bg-black/50 p-2">
                <span className="flex items-center space-x-1.5">
                  <Wand2 className="w-3 h-3 text-theme-muted" />
                  <span>API Connection</span>
                </span>
                <span className={`font-bold ${health?.api === 'CONNECTED' ? 'text-emerald-400' : 'text-theme-muted'}`}>
                  {health?.api || 'READY'}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-theme-border bg-black/50 p-2">
                <span className="flex items-center space-x-1.5">
                  <Database className="w-3 h-3 text-theme-muted" />
                  <span>Database</span>
                </span>
                <span className={`font-bold ${health?.database === 'CONNECTED' ? 'text-emerald-400' : 'text-theme-muted'}`}>
                  {health?.database || 'READY'}
                </span>
              </div>
            </div>
          </div>

          {/* Live Log Console */}
          <div className="flex-1 min-h-0 rounded-xl border border-theme-border bg-black/60 p-3 flex flex-col font-mono text-[10px]">
            <div className="flex items-center space-x-2 border-b border-theme-border pb-1.5 text-theme-muted mb-2 shrink-0">
              <Terminal className="w-3.5 h-3.5 text-cyan-400" />
              <span className="uppercase tracking-[0.2em]">Build & Runtime Logs</span>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1 text-gray-300 pr-1">
              {logs.length === 0 ? (
                <p className="text-theme-muted/60 italic">Logs will stream live here during site generation and server execution.</p>
              ) : (
                logs.map((line, idx) => (
                  <div key={idx} className="whitespace-pre-wrap break-all border-b border-gray-900/50 pb-0.5">
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column — Live Preview & Controls */}
        <div className="flex min-h-0 flex-col gap-4">
          <div className="rounded-xl border border-theme-border bg-black/40 p-3 flex-1 flex flex-col">
            <div className="flex items-center justify-between border-b border-theme-border pb-2 shrink-0">
              <div className="flex items-center space-x-2">
                <Monitor className="w-3.5 h-3.5 text-theme-primary" />
                <span className="text-[10px] uppercase tracking-[0.3em] text-theme-muted">Real-Time Live Preview</span>
              </div>

              {/* Functional Preview Action Buttons */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleRefreshPreview}
                  className="rounded border border-theme-border bg-black/40 p-1 text-[10px] text-theme-text transition hover:border-theme-primary hover:text-cyan-400"
                  title="Refresh Preview Frame"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={handleRestartServers}
                  disabled={!siteId}
                  className="rounded border border-theme-border bg-black/40 p-1 text-[10px] text-theme-text transition hover:border-theme-primary hover:text-amber-400 disabled:opacity-30"
                  title="Restart Project Servers"
                >
                  <Play className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={handleStopProject}
                  disabled={!siteId}
                  className="rounded border border-theme-border bg-black/40 p-1 text-[10px] text-rose-400 transition hover:border-rose-500 hover:bg-rose-950/40 disabled:opacity-30"
                  title="Stop Servers"
                >
                  <Square className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={handleCopyUrl}
                  disabled={!previewUrl}
                  className="rounded border border-theme-border bg-black/40 p-1 text-[10px] text-theme-text transition hover:border-theme-primary hover:text-cyan-400 disabled:opacity-30"
                  title="Copy Preview URL"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={handleOpenChrome}
                  className="flex items-center space-x-1 rounded border border-theme-primary/50 bg-theme-primary/20 px-2.5 py-1 text-[10px] font-bold text-cyan-300 transition hover:bg-theme-primary/30"
                  title="Open in Google Chrome"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>Open Chrome</span>
                </button>
                {siteId && (
                  <button
                    onClick={handleExportZip}
                    className="flex items-center space-x-1 rounded border border-emerald-500/40 bg-emerald-950/40 px-2.5 py-1 text-[10px] font-bold text-emerald-300 transition hover:bg-emerald-900/50"
                  >
                    <Download className="w-3 h-3" />
                    <span>Export</span>
                  </button>
                )}
              </div>
            </div>

            {/* Preview Frame Container */}
            <div className="mt-3 flex-1 overflow-hidden rounded-lg border border-theme-border bg-black/60 relative">
              {browserError && (
                <div className="flex h-full flex-col items-center justify-center space-y-2 p-4 text-center">
                  <AlertTriangle className="w-8 h-8 text-rose-400" />
                  <p className="text-xs text-rose-300 font-bold">Generation Error</p>
                  <p className="text-[11px] text-rose-400/80 max-w-xs">{browserError}</p>
                </div>
              )}
              {!browserError && browserPreviewHtml ? (
                <iframe
                  key={iframeKey}
                  srcDoc={browserPreviewHtml}
                  className="h-full w-full border-0 bg-white"
                  title="Generated Web Application Preview"
                  sandbox="allow-scripts allow-same-origin"
                />
              ) : !browserError && previewUrl ? (
                <iframe
                  key={iframeKey}
                  src={previewUrl}
                  className="h-full w-full border-0 bg-white"
                  title="Generated Web Application Preview"
                />
              ) : !browserError && (
                <div className="flex h-full flex-col items-center justify-center space-y-3 text-center text-theme-muted p-6">
                  <Eye className="w-12 h-12 text-theme-primary opacity-50 animate-pulse" />
                  <p className="text-xs font-bold text-theme-text">Your Generated Full-Stack Site Will Preview Live Here</p>
                  <p className="text-[11px] text-theme-muted max-w-sm">
                    Enter a prompt on the left and click <span className="text-cyan-400 font-bold">GENERATE</span>. The app builds frontend & backend servers and renders the live preview in real-time.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {zipMessage && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/80 p-2 text-center text-xs font-bold text-emerald-300 animate-pulse">
          {zipMessage}
        </div>
      )}
    </div>
  );
}
