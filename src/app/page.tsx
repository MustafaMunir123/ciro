"use client";

import { useDisasterSimulation } from "@/hooks/useDisasterSimulation";
import { SignalFeed } from "@/components/SignalFeed";
import { ReasoningLog } from "@/components/ReasoningLog";

import { useSimulationStore } from "@/lib/store";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, Trash2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { MissionReportModal } from "@/components/MissionReportModal";
import { resolveIsUserSubmittedFromRow } from "@/lib/incident-source";

const TacticalMap = dynamic(() => import("@/components/TacticalMap").then(mod => mod.TacticalMap), { ssr: false });

// --- Components ---

function DashboardCard({ children, className, title, icon }: { children: React.ReactNode, className?: string, title?: string, icon?: React.ReactNode }) {
  return (
    <div className={`glass-panel rounded-xl flex flex-col overflow-hidden relative ${className}`}>
      {/* Card Header (Optional) */}
      {title && (
        <div className="h-10 border-b border-white/5 bg-white/5 px-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-zinc-400">
            {icon}
            <span className="text-[10px] font-mono tracking-widest uppercase font-bold">{title}</span>
          </div>
          {/* Decorative dots */}
          <div className="flex gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-red-500/50 animate-[pulse_2s_ease-in-out_infinite]"></div>
            <div className="w-1.5 h-1.5 rounded-full bg-yellow-500/50 animate-[pulse_2s_ease-in-out_infinite_0.5s]"></div>
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/50 animate-[pulse_2s_ease-in-out_infinite_1s]"></div>
          </div>
        </div>
      )}
      <div className="flex-1 min-h-0 relative">
        {children}
      </div>
    </div>
  );
}

function StatCard({ label, value, colorClass, iconColorClass }: { label: string, value: number, colorClass: string, iconColorClass: string }) {
  return (
    <div className="glass-panel px-4 py-3 rounded-lg flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className={`w-2 h-2 rounded-full ${iconColorClass} animate-pulse`} />
        <span className="text-[10px] font-mono text-zinc-400 tracking-wider">{label}</span>
      </div>
      <span className={`text-xl font-bold font-mono ${colorClass}`}>{value}</span>
    </div>
  );
}

export default function ResponderView() {
  const { time, isPlaying } = useDisasterSimulation();
  const {
    setIsPlaying,
    incidents,
    notification,
    showNotification,
    isMissionComplete,
    logs,
    addLog,
    setReport,
    report,
    setIsReportOpen,
    isGeneratingReport,
    setIsGeneratingReport,
    setIsMissionComplete,
    hydrateIncidents
  } = useSimulationStore();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isMockUploadRunning, setIsMockUploadRunning] = useState(false);

  const runMockUploadFlow = (fileName: string) => {
    if (isMockUploadRunning) return;
    setIsMockUploadRunning(true);
    showNotification("Raw File data intake started", "info");

    const queueLog = (delayMs: number, message: string) => {
      window.setTimeout(() => {
        const runtime = useSimulationStore.getState().time;
        addLog(`[${runtime}s] ${message}`);
      }, delayMs);
    };

    queueLog(0, `[Raw File data] FILE_INGEST_INIT | file=${fileName}`);
    queueLog(700, "[Raw File data] AGENTS_BOOTSTRAP | coordinator=ready triage=ready logistics=ready reporter=ready");
    queueLog(1400, "[Raw File data] SOCIAL_SIGNAL_READY | records=5 sentiment_clusters=3");
    queueLog(2100, "[Raw File data] WEATHER_SIGNAL_READY | current=ingested forecast=ingested");
    queueLog(2800, "[Raw File data] BULK_PARSE_COMPLETE | extracted_topics=4 geo_candidates=6");
    queueLog(3500, "[Raw File data] CROSS_SOURCE_FUSION_COMPLETE | sources=news,social,weather,file");
    queueLog(4300, "[Raw File data] DEMO_ONLY_NO_FILE_PROCESSING | raw_file_bypass=true");
    queueLog(5000, "[Raw File data] PIPELINE_COMPLETE | status=ok");

    window.setTimeout(() => {
      setIsMockUploadRunning(false);
      showNotification("Raw File data processing completed", "success");
    }, 5200);
  };

  const handleMockFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;
    runMockUploadFlow(selectedFile.name);
    event.target.value = "";
  };

  const handleGenerateReport = async () => {
    if (isGeneratingReport) return;
    setIsGeneratingReport(true);
    showNotification("Initializing Gemini 3 Auditor...", "info");

    try {
      // Dynamic import of server action if needed, or direct call
      const { generateMissionReport } = await import("@/agents/reporter");
      const generatedReport = await generateMissionReport(incidents, logs);
      setReport(generatedReport);
      setIsReportOpen(true);
      showNotification("Report Generated Successfully", "success");
    } catch (e) {
      console.error("[PAGE] Report Generation Error:", e);
      showNotification("Failed to generate report. Check console.", "error");
    } finally {
      setIsGeneratingReport(false);
    }
  };

  // Initial system checks and warm-up
  useEffect(() => {
    const warmUpGemini = async () => {
      const warmupEnabled = process.env.NEXT_PUBLIC_GEMINI_WARMUP_ENABLED === "true";
      if (!warmupEnabled) {
        console.log("[SYSTEM] Gemini warmup skipped (NEXT_PUBLIC_GEMINI_WARMUP_ENABLED=false).");
        return;
      }
      console.log("[SYSTEM] Warming up AI Core...");
      try {
        // We call our new GET handler to initialize the AI client and warm up model cache
        const res = await fetch("/api/coordinate/stream");
        const data = await res.json();
        console.log(`[SYSTEM] AI Core Status: ${data.status}`);
      } catch (e) {
        console.warn("[SYSTEM] AI Warmup skipped or failed.");
      }
    };

    warmUpGemini();
  }, [showNotification]);

  // Load persisted events from internal API (Supabase-backed) on startup.
  useEffect(() => {
    const loadPersistedEvents = async () => {
      try {
        const response = await fetch("/api/events?limit=500&view=full");
        if (!response.ok) return;
        const json = await response.json();
        const rows = Array.isArray(json?.events) ? json.events : [];
        const mapped = rows
          .map((row: any) => {
            const id = row?.event_id;
            if (!id) return null;
            return {
              id,
              raw_input: row?.raw_input ?? "",
              timestamp: row?.scan_datetime ?? row?.updated_at ?? new Date().toISOString(),
              status: row?.status ?? "PENDING",
              type: row?.type ?? undefined,
              priority: row?.priority ?? undefined,
              category: row?.category ?? undefined,
              city: row?.city ?? undefined,
              area: row?.area ?? undefined,
              mission_context: row?.mission_context ?? undefined,
              ai_summary: row?.ai_summary ?? undefined,
              precautions: row?.precautions ?? undefined,
              event_tags: row?.event_tags ?? undefined,
              source_trail: row?.source_trail ?? undefined,
              road_coords: row?.road_coords ?? undefined,
              thumbnail: row?.thumbnail ?? undefined,
              news_date: row?.news_date ?? undefined,
              scan_datetime: row?.scan_datetime ?? undefined,
              location: {
                lat: row?.lat ?? 0,
                lng: row?.lng ?? 0,
                address: row?.address ?? undefined,
              },
              area_location: (
                typeof row?.area_lat === "number" && typeof row?.area_lng === "number"
                  ? { lat: row.area_lat, lng: row.area_lng, address: undefined }
                  : undefined
              ),
              is_user_submitted: resolveIsUserSubmittedFromRow({
                is_user_submitted: row?.is_user_submitted,
                event_id: row?.event_id,
                source_trail: row?.source_trail,
                raw_input: row?.raw_input,
              }),
            };
          })
          .filter(Boolean);

        if (mapped.length > 0) {
          hydrateIncidents(mapped as any);
        }
      } catch {
        // Silent fail: local simulation remains usable even if loading persisted events fails.
      }
    };

    loadPersistedEvents();
  }, [hydrateIncidents]);

  // Calculate stats
  const criticalCount = incidents.filter(i => i.priority === "CRITICAL").length;
  const highCount = incidents.filter(i => i.priority === "HIGH").length;
  const latestPipelineLog = [...logs].reverse().find((log) => {
    if (!log.includes("[AGENTIC-PIPELINE]")) return false;
    return !/TASK=(AREA_SLEEP_\d+MS|[A-Z_]*RATE_LIMIT_DELAY_\d+MS)/.test(log);
  });
  const parsedPipeline = (() => {
    if (!latestPipelineLog) {
      return { city: "KARACHI", area: "WAITING", task: "IDLE" };
    }
    const cityMatch = latestPipelineLog.match(/CITY=([^|]+)/);
    const areaMatch = latestPipelineLog.match(/AREA=([^|]+)/);
    const taskMatch = latestPipelineLog.match(/TASK=([^|]+)/);
    return {
      city: cityMatch?.[1]?.trim() || "KARACHI",
      area: areaMatch?.[1]?.trim() || "WAITING",
      task: taskMatch?.[1]?.trim() || "IDLE",
    };
  })();
  const isTaskRunning = !/READY|COMPLETE|FAILED|SKIPPED|IDLE/i.test(parsedPipeline.task);

  return (
    <>
      <main className="dashboard-content h-screen w-screen bg-[#040814] text-zinc-100 flex flex-col overflow-hidden font-sans selection:bg-blue-500/30">
        {/* ... background and header ... */}
        <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-900/20 blur-[120px] rounded-full pointer-events-none z-0" />
        <div className="fixed bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-indigo-900/20 blur-[120px] rounded-full pointer-events-none z-0" />

        <header className="h-16 shrink-0 border-b border-blue-500/20 bg-[#040814]/85 backdrop-blur-md z-50 flex items-center justify-between px-6">
          {/* Left-aligned agentic status signs */}
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-blue-400/50 bg-blue-950/35 px-4 py-2.5 shadow-[0_0_28px_rgba(59,130,246,0.24)] min-w-[320px]">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[10px] uppercase tracking-[0.18em] text-blue-200 font-bold">City / Area</span>
                <span className="text-[10px] px-2 py-0.5 rounded border border-blue-400/50 bg-blue-500/20 text-blue-100 font-bold">
                  OPEN
                </span>
              </div>
              <div className="text-[14px] text-blue-50 font-mono font-bold leading-tight">
                {`${parsedPipeline.city} -> ${parsedPipeline.area}`}
              </div>
            </div>
            <div className="rounded-lg border border-blue-400/50 bg-blue-950/35 px-4 py-2.5 shadow-[0_0_28px_rgba(59,130,246,0.24)] min-w-[260px]">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[10px] uppercase tracking-[0.18em] text-blue-200 font-bold">Task Status</span>
                <span className={cn(
                  "text-[10px] px-2 py-0.5 rounded border font-bold",
                  isTaskRunning
                    ? "border-blue-400/50 bg-blue-500/20 text-blue-100"
                    : "border-zinc-600/60 bg-zinc-700/20 text-zinc-300"
                )}>
                  {isTaskRunning ? "OPEN" : "CLOSED"}
                </span>
              </div>
              <div className="text-[13px] text-blue-50 font-mono font-bold break-all leading-tight">
                {parsedPipeline.task}
              </div>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-6">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleMockFileUpload}
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isMockUploadRunning}
              className={cn(
                "group relative px-3 py-2 rounded-lg font-mono text-xs font-bold tracking-widest transition-all duration-500 overflow-hidden border flex items-center gap-2",
                isMockUploadRunning
                  ? "border-cyan-500/40 text-cyan-300 bg-cyan-500/10 cursor-wait"
                  : "border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10 hover:border-cyan-400/60"
              )}
              title="SIMULATE BULK FILE INTEL"
            >
              <Upload className="w-3.5 h-3.5" />
              <span className="hidden lg:inline text-[9px]">
                {isMockUploadRunning ? "PROCESSING..." : "UPLOAD"}
              </span>
            </button>

            <button
              onClick={() => {
                if (!isPlaying) {
                  // Starting new simulation - reset state
                  setReport(null);
                  setIsMissionComplete(false);
                } else {
                  // STOPPING: Reset any ANALYZING incidents back to PENDING so they can resume later
                  const analyzingIncidents = incidents.filter(i => i.status === "ANALYZING");
                  analyzingIncidents.forEach(inc => {
                    useSimulationStore.getState().updateIncident(inc.id, { status: "PENDING" });
                  });
                }
                setIsPlaying(!isPlaying);
              }}
              className={cn(
                "group relative px-6 py-2 rounded-full font-mono text-xs font-bold tracking-widest transition-all duration-500 overflow-hidden border",
                isPlaying ? "border-red-500/30 text-red-400 hover:bg-red-500/10" : "border-blue-500/35 text-blue-300 hover:bg-blue-500/10 shadow-[0_0_18px_rgba(59,130,246,0.2)]"
              )}
            >
              <span className="relative z-10 flex items-center gap-2">
                {isPlaying ? (
                  <>
                    <span className="w-2 h-2 rounded-[1px] bg-red-500 animate-[pulse_0.5s_infinite]" />
                    SYSTEM ACTIVE
                  </>
                ) : (
                  <>
                    <span className="w-0 h-0 border-t-[4px] border-t-transparent border-l-[6px] border-l-blue-400 border-b-[4px] border-b-transparent ml-1" />
                    SCAN
                  </>
                )}
              </span>
            </button>

            <button
              onClick={async () => {
                try {
                  await fetch("/api/events?all=true", { method: "DELETE" });
                } catch {
                  // Keep wipe responsive even if remote delete fails.
                } finally {
                  localStorage.removeItem("simulation-store");
                  window.location.reload();
                }
              }}
              className="group relative px-3 py-2 rounded-lg font-mono text-xs font-bold tracking-widest transition-all duration-500 overflow-hidden border border-zinc-700/50 hover:border-zinc-300/70 text-zinc-300/80 hover:text-white hover:bg-white/5 flex items-center gap-2"
              title="WIPE DATABASE"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden lg:inline text-[9px]">PURGE</span>
            </button>

          </div>
        </header>

        {/* Main Layout - FIXED height grid, no page scroll */}
        <div className="flex-1 p-4 md:p-6 min-h-0 overflow-hidden relative z-10">
          <div className="h-full w-full max-w-[1920px] mx-auto grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6">
            <section className="md:col-span-3 flex flex-col gap-4 order-2 md:order-1 min-h-0 overflow-hidden">
              <SignalFeed className="h-full" />
            </section>
            <section className="md:col-span-6 flex flex-col order-1 md:order-2 min-h-0 overflow-hidden">
              <DashboardCard className="flex-1 rounded-none border-blue-500/25 min-h-0"><TacticalMap className="h-full" /></DashboardCard>
            </section>
            <section className="md:col-span-3 flex flex-col order-3 md:order-3 min-h-0 overflow-hidden">
              <DashboardCard className="flex-1 min-h-0 overflow-hidden"><ReasoningLog className="h-full" /></DashboardCard>
            </section>
          </div>
        </div>

      </main >

      <MissionReportModal />

      {/* Global Toast with AnimatePresence */}
      <AnimatePresence mode="wait">
        {notification && (
          <motion.div
            key={notification.message}
            initial={{ opacity: 0, x: "-50%" }}
            animate={{ opacity: 1, x: "-50%" }}
            exit={{ opacity: 0, x: "-50%" }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className={cn(
              "fixed top-20 left-1/2 z-[10000] px-6 py-3 rounded-lg shadow-2xl border flex items-center gap-3 backdrop-blur-xl bg-zinc-900/90",
              notification.type === "error" ? "border-red-500/50 text-red-200" :
                notification.type === "success" ? "border-blue-500/50 text-blue-200" :
                  "border-zinc-700 text-zinc-200"
            )}
          >
            <div className={cn(
              "w-1 h-1 rounded-full",
              notification.type === "error" ? "bg-red-500" : "bg-blue-500"
            )} />
            {notification.type === "error" && <AlertCircle className="w-4 h-4 text-red-500" />}
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.1em]">
              {notification.message}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
