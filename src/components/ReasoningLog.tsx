"use client";

import React, { useEffect, useState, useRef } from "react";
import { useSimulationStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { MODELS } from "@/lib/constants";
import { Mic, Target, Loader2, CheckCircle, XCircle } from "lucide-react";

// Custom Markdown-lite formatter
function FormattedReasoningDisplay({ text }: { text: string }) {
    if (!text) return null;

    // View Layer Clean: Remove unwanted artifacts
    const cleanText = text
        .replace(/Show Less/gi, "") // Cleaning user reported artifact
        .trim();

    return (
        <div className="space-y-2">
            {cleanText.split('\n').map((line, i) => {
                const trimmed = line.trim();
                if (!trimmed) return <div key={i} className="h-1" />; // Spacer

                // Separator
                if (trimmed === '---') {
                    return <hr key={i} className="border-zinc-800 my-2" />;
                }

                // Headers
                // Warnings
                if (trimmed.startsWith('⚠️') || trimmed.includes('[STREAM ERROR]')) {
                    return <div key={i} className="text-amber-400 bg-amber-950/30 p-2 rounded border border-amber-900/50 text-[10px] font-bold shadow-sm">{trimmed}</div>;
                }

                // Explicit Header (###) OR Implicit Header (Short first line)
                const isExplicitHeader = trimmed.startsWith('#');
                const isImplicitHeader = (i === 0 && trimmed.length < 50 && !trimmed.includes(':') && !trimmed.endsWith('.')) || (trimmed.includes('Analysis') && !trimmed.includes(':') && trimmed.length < 50);

                if (isExplicitHeader || isImplicitHeader) {
                    const cleanHeader = trimmed.replace(/^#+\s*/, '').replace(/\*\*/g, '');
                    return <h3 key={i} className="text-cyan-400 font-bold uppercase text-[10px] tracking-widest mt-3 mb-2 border-b border-cyan-500/20 pb-1">{cleanHeader}</h3>;
                }

                // List Items (Numeric or Bullet)
                const isList = /^\d+\./.test(trimmed) || trimmed.startsWith('- ') || trimmed.startsWith('* ');

                // Bold Parsing (Robust) - Handles **text**
                const parts = trimmed.split(/(\*\*.*?\*\*)/g);

                return (
                    <div key={i} className={cn("text-[10px] leading-relaxed text-zinc-300/90 py-0.5", isList && "pl-3 border-l-2 border-zinc-800 ml-1 mt-1 bg-zinc-900/20 rounded-r")}>
                        {parts.map((part, j) => {
                            if (part.startsWith('**') && part.endsWith('**')) {
                                const content = part.slice(2, -2);
                                return <span key={j} className="text-cyan-200 font-bold">{content}</span>;
                            }
                            return <span key={j}>{part}</span>;
                        })}
                    </div>
                );
            })}
        </div>
    );
}

function TypewriterText({ text, speed = 20 }: { text: string; speed?: number }) {
    const [displayText, setDisplayText] = useState("");
    const [isComplete, setIsComplete] = useState(false);
    const previousTextRef = useRef<string>("");
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        // Only reset if the text has actually changed
        if (previousTextRef.current === text) {
            return;
        }

        previousTextRef.current = text;

        // Clear any existing interval
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
        }

        // Reset state for new text
        setDisplayText("");
        setIsComplete(false);

        if (!text) {
            setIsComplete(true);
            return;
        }

        let index = 0;

        intervalRef.current = setInterval(() => {
            if (index < text.length) {
                setDisplayText(text.substring(0, index + 1));
                index++;
            } else {
                setIsComplete(true);
                if (intervalRef.current) {
                    clearInterval(intervalRef.current);
                    intervalRef.current = null;
                }
            }
        }, speed);

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, [text, speed]);

    return (
        <span className="whitespace-pre-wrap">
            {displayText}
            {!isComplete && <span className="animate-pulse">▌</span>}
        </span>
    );
}

export function ReasoningLog({ className }: { className?: string }) {
    const {
        logs,
        incidents,
        isGeneratingReport,
        isMissionComplete,
        rawThinkingProcess,
        activeAgent,
        activeModel,
        isVoiceProcessing,
        spotlightId,
        processingBatch,
        updateIncident,
        time
    } = useSimulationStore();
    const scrollRef = useRef<HTMLDivElement>(null);
    const thoughtsRef = useRef<HTMLDivElement>(null);
    const [displayLogs, setDisplayLogs] = useState<string[]>([]);

    useEffect(() => {
        setDisplayLogs(logs.slice(-15));
        // Auto-scroll to bottom
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs]);

    const parseLogLine = (log: string) => {
        const cleaned = log.replace(/EVT-/gi, "");
        const match = cleaned.match(/^\[([^\]]+)\]\s+\[([^\]]+)\]\s+([\s\S]*)$/);
        if (!match) {
            return {
                timeLabel: "",
                agentLabel: "",
                message: cleaned,
                isStructured: false,
            };
        }
        return {
            timeLabel: match[1],
            agentLabel: match[2],
            message: match[3],
            isStructured: true,
        };
    };



    // Check if there's an incident currently being analyzed (prioritize spotlight), or fallback to first pending
    const pendingIncident = (spotlightId ? incidents.find(i => i.id === spotlightId) : null) ||
        incidents.find(i => i.status === "ANALYZING") ||
        incidents.find(i => i.status === "PENDING");

    // Get spotlight incident and background incidents from batch
    const heroIncident = spotlightId ? incidents.find(i => i.id === spotlightId) : null;

    // PROTOCOL ZERO: Check for blocking authorization events
    const activeAuthIncident = incidents.find(i => i.auth_status === "PENDING");

    // Find the latest active incident with a reasoning trace
    // PRIORITY: Active Auth Incident -> Latest processed incident
    const latestTriaged = activeAuthIncident || incidents
        .slice()
        .reverse()
        .find(i => i.reasoning_trace && (i.status === "TRIAGED" || i.status === "RESOLVED" || i.status === "ANALYZING"));

    // Show only background incidents (exclude Hero since it's shown in AI Reasoning)
    const backgroundIncidents = processingBatch
        .filter(id => id !== spotlightId)
        .map(id => incidents.find(i => i.id === id))
        .filter(Boolean);
    const isParallelProcessing = processingBatch.length > 1;

    // Auto-scroll thoughts
    useEffect(() => {
        if (thoughtsRef.current) {
            thoughtsRef.current.scrollTop = thoughtsRef.current.scrollHeight;
        }
    }, [rawThinkingProcess, latestTriaged, pendingIncident, displayLogs]);

    return (
        <div className={cn("flex flex-col gap-2 p-4 bg-[#040814] border border-blue-500/25 rounded-lg h-full font-mono text-xs shadow-[0_0_24px_rgba(59,130,246,0.12)]", className)}>
            {/* ... header and logs ... */}
            <div className="flex items-center gap-2 border-b border-blue-500/20 pb-3 mb-2">
                <div className="relative">
                    <div className="w-2 h-2 rounded-full bg-blue-400" />
                    <div className="absolute inset-0 w-2 h-2 rounded-full bg-blue-400 animate-ping" />
                </div>
                <h3 className="text-blue-100 font-bold uppercase tracking-wider text-[11px]">System Activity</h3>
                <span className="ml-auto text-[9px] text-blue-200/80 bg-blue-500/15 border border-blue-500/30 px-2 py-0.5 rounded">
                    {logs.length} entries
                </span>
            </div>

            {/* Activity Log */}
            <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto space-y-1">
                {displayLogs.length === 0 ? (
                    <div className="text-blue-300/50 text-center py-4 animate-pulse">
                        Initializing system...
                    </div>
                ) : (
                    displayLogs.map((log, i) => {
                        const parsed = parseLogLine(log);
                        return (
                            <div
                                key={i}
                                className="text-blue-100/80 py-1.5 hover:bg-blue-500/10 px-2 rounded transition-colors border border-transparent hover:border-blue-500/20"
                            >
                                {parsed.isStructured ? (
                                    <div className="flex flex-wrap items-start gap-2">
                                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-100 border border-blue-500/30 shrink-0">
                                            {parsed.timeLabel}
                                        </span>
                                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-200 border border-cyan-500/25 font-bold uppercase tracking-wide shrink-0">
                                            {parsed.agentLabel}
                                        </span>
                                        <span className="text-[10px] text-blue-100/80 leading-relaxed break-all">
                                            {parsed.message}
                                        </span>
                                    </div>
                                ) : (
                                    <div className="flex items-start gap-2">
                                        <span className="text-cyan-300/80 shrink-0">›</span>
                                        <span className="break-all">{parsed.message}</span>
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>

            {/* ============================================================ */}
            {/* PARALLEL PROCESSING: Background Tasks (shown above AI Reasoning) */}
            {/* ============================================================ */}
            {isParallelProcessing && backgroundIncidents.length > 0 && (
                <div className="border-t border-blue-500/20 pt-3 mt-2">
                    <div className="flex items-center gap-2 mb-2">
                        <Target className="w-3 h-3 text-cyan-400 animate-pulse" />
                        <span className="text-[9px] text-cyan-400 font-bold uppercase tracking-widest">
                            Parallel Analysis
                        </span>
                        <span className="ml-auto text-[9px] text-blue-200/70 bg-blue-500/10 border border-blue-500/25 px-2 py-0.5 rounded">
                            {processingBatch.length} signals
                        </span>
                    </div>
                    <div className="space-y-1 max-h-[80px] overflow-y-auto custom-scrollbar pr-1">
                        {backgroundIncidents.map((incident) => incident && (
                            <div key={incident.id} className="flex items-center gap-2 bg-blue-950/30 rounded px-2 py-1.5 border border-blue-500/20">
                                {incident.status === "ANALYZING" ? (
                                    <Loader2 className="w-3 h-3 text-yellow-500 animate-spin" />
                                ) : (
                                    <CheckCircle className="w-3 h-3 text-emerald-500" />
                                )}
                                <span className="text-[9px] text-blue-100/75 font-mono flex-1">
                                    {incident.id}
                                </span>
                                <span className={cn(
                                    "text-[8px] px-1 py-0.5 rounded",
                                    incident.status === "ANALYZING" && "bg-yellow-500/20 text-yellow-400",
                                    incident.status === "TRIAGED" && "bg-emerald-500/20 text-emerald-400"
                                )}>
                                    {incident.status}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* AI Reasoning Trace section removed per UI request */}
        </div >
    );
}
