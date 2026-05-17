"use client";

import { useState } from "react";
import { useSimulationStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { type Incident } from "@/lib/types";
import { motion, AnimatePresence } from "framer-motion";
import {
    Mic, Video, FileText, Radio,
    MapPin, Play,
    ChevronDown, ChevronUp, AlertCircle,
    Activity, Shield,
    Clock,
    AlertTriangle,
    CheckCircle2,
    Users,
    Cpu,
    Target
} from "lucide-react";
import { CommanderControls } from "./CommanderControls";
import { isUserSubmittedIncident } from "@/lib/incident-source";

const getPriorityStyles = (p?: string) => {
    switch (p) {
        case "CRITICAL": return {
            border: "border-red-500/50",
            bg: "bg-red-950/20",
            text: "text-red-400",
            indicator: "bg-red-500",
            shadow: "shadow-red-900/20"
        };
        case "HIGH": return {
            border: "border-orange-500/50",
            bg: "bg-orange-950/20",
            text: "text-orange-400",
            indicator: "bg-orange-500",
            shadow: "shadow-orange-900/20"
        };
        case "MEDIUM": return {
            border: "border-yellow-500/50",
            bg: "bg-yellow-950/20",
            text: "text-yellow-400",
            indicator: "bg-yellow-500",
            shadow: "shadow-yellow-900/20"
        };
        case "LOW": return {
            border: "border-emerald-500/50",
            bg: "bg-emerald-950/20",
            text: "text-emerald-400",
            indicator: "bg-emerald-500",
            shadow: "shadow-emerald-900/20"
        };
        default: return {
            border: "border-zinc-800",
            bg: "bg-zinc-900/50",
            text: "text-zinc-400",
            indicator: "bg-zinc-500",
            shadow: "shadow-zinc-900/10"
        };
    }
};

const USER_SUBMITTED_STYLES = {
    border: "border-violet-500/50",
    bg: "bg-violet-950/25",
    text: "text-violet-300",
    indicator: "bg-violet-500",
    shadow: "shadow-violet-900/25",
};

const getTypeIcon = (type: string | undefined) => {
    switch (type) {
        case "AUDIO": return <Mic className="w-3.5 h-3.5" />;
        case "VIDEO": return <Video className="w-3.5 h-3.5" />;
        case "TEXT": return <FileText className="w-3.5 h-3.5" />;
        default: return <Radio className="w-3.5 h-3.5" />;
    }
};

function getUserSubmissionPreview(incident: Incident): string | null {
    const rawInput = incident.raw_input || "";
    if (!rawInput.startsWith("{")) return null;
    try {
        const parsed = JSON.parse(rawInput);
        const summary =
            parsed?.user_submission?.summary_en ||
            parsed?.user_submission?.summary_original ||
            parsed?.user_submission?.original_text;
        if (typeof summary === "string" && summary.trim()) {
            return summary.trim();
        }
    } catch {
        return null;
    }
    return null;
}

// Helper to format data packet display based on incident type
const getDataPacketDisplay = (incident: Incident): { label: string; content: string; isFile: boolean } => {
    const userPreview = getUserSubmissionPreview(incident);
    if (userPreview) {
        const truncated = userPreview.length > 80 ? `${userPreview.slice(0, 80).trim()}...` : userPreview;
        return { label: "CITIZEN REPORT", content: truncated, isFile: false };
    }

    const rawInput = incident.raw_input || "";

    // Check if it's a file path (contains common file extensions or starts with /)
    const isFilePath = rawInput.startsWith('/') ||
        /\.(mp3|mp4|mov|wav|avi|mkv|webm|ogg|m4a|flac)$/i.test(rawInput);

    if (isFilePath) {
        const filename = rawInput.split('/').pop() || rawInput;
        const extension = filename.split('.').pop()?.toLowerCase() || "";

        // Determine type based on extension if incident.type isn't set
        const isAudio = ["mp3", "wav", "ogg", "m4a", "flac"].includes(extension);
        const isVideo = ["mp4", "mov", "avi", "mkv", "webm"].includes(extension);

        if (isAudio || incident.type === "AUDIO") {
            return { label: "AUDIO FILE", content: filename, isFile: true };
        } else if (isVideo || incident.type === "VIDEO") {
            return { label: "VIDEO FILE", content: filename, isFile: true };
        }
        return { label: "MEDIA FILE", content: filename, isFile: true };
    }

    // It's a text transcript - truncate for display
    const maxLength = 10;
    const truncated = rawInput.length > maxLength
        ? rawInput.substring(0, maxLength).trim() + "..."
        : rawInput;

    return { label: "TRANSCRIPT", content: `"${truncated}"`, isFile: false };
};

function summarizeIncidentTranscript(incident: Incident): string {
    const rawInput = incident.raw_input || "";
    if (!rawInput || rawInput[0] !== "{") return rawInput;

    try {
        const parsed = JSON.parse(rawInput);
        const city = parsed?.city || "Unknown City";
        const area = parsed?.area || "Unknown Area";
        const topics = Array.isArray(parsed?.intel_by_topic) ? parsed.intel_by_topic : [];
        const current = parsed?.weather?.current || {};
        const forecast = parsed?.weather?.forecast_day1 || {};

        const lines: string[] = [];
        lines.push(`INTELLIGENCE BRIEF: ${area}, ${city}`);
        lines.push("");

        if (topics.length === 0) {
            lines.push("No topic intel payload found.");
        } else {
            for (const topicEntry of topics) {
                const topic = topicEntry?.topic || "Untitled Topic";
                const records = Array.isArray(topicEntry?.records) ? topicEntry.records : [];

                lines.push(`TOPIC: ${topic}`);
                if (records.length === 0) {
                    lines.push("- No live intel records found.");
                } else {
                    records.forEach((record: any, idx: number) => {
                        const source = record?.source || "UNKNOWN_SOURCE";
                        const headline = record?.headline || "Untitled";
                        const url = record?.url ? ` | URL: ${record.url}` : "";
                        lines.push(`- [REF ${idx + 1}] SOURCE: ${source} | HEADLINE: ${headline}${url}`);
                    });
                }
                lines.push("");
            }
        }

        lines.push("WEATHER SNAPSHOT:");
        lines.push(
            `- Current: ${current?.condition || "Unknown"}, ${current?.temp_c ?? "N/A"}C, humidity ${current?.humidity ?? "N/A"}%, wind ${current?.wind_kph ?? "N/A"} kph`
        );
        lines.push(
            `- Forecast D1: ${forecast?.day1_condition || "Unknown"}, rain chance ${forecast?.day1_rain_chance ?? "N/A"}%, precipitation ${forecast?.day1_precip_mm ?? "N/A"} mm`
        );

        return lines.join("\n");
    } catch {
        return rawInput;
    }
}

function humanizeSlug(value: string): string {
    return value
        .toLowerCase()
        .split("-")
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function extractCityArea(incident: Incident): { city: string; area: string } {
    const rawInput = incident.raw_input || "";
    if (rawInput.startsWith("{")) {
        try {
            const parsed = JSON.parse(rawInput);
            const rawCity = typeof parsed?.city === "string" ? parsed.city.trim() : "";
            const rawArea = typeof parsed?.area === "string" ? parsed.area.trim() : "";
            if (rawCity) {
                return {
                    city: rawCity,
                    area: rawArea || "Unknown Area",
                };
            }
        } catch {
            // Ignore parse errors and continue with address-based extraction.
        }
    }

    const address = incident.location?.address?.trim();
    if (address && address.includes(",")) {
        const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
        if (parts.length >= 2) {
            const countryLike = new Set(["pakistan", "pk"]);
            const last = parts[parts.length - 1];
            const isCountrySuffix = countryLike.has(last.toLowerCase());
            const city = isCountrySuffix ? parts[parts.length - 2] : last;
            const area = parts.length >= 3 ? parts[0] : (isCountrySuffix ? "Unknown Area" : parts[0]);
            return { city, area };
        }
    }

    const idMatch = incident.id.match(/EVT-[A-Z-]+-([A-Z0-9-]+)-([A-Z0-9-]+)$/i);
    if (idMatch) {
        return {
            city: humanizeSlug(idMatch[1]),
            area: humanizeSlug(idMatch[2]),
        };
    }

    return { city: "Unknown City", area: "Unknown Area" };
}

function displayEventId(id: string): string {
    return id.replace(/^EVT-+/i, "");
}

function extractTopicTitleFromRawInput(rawInput?: string): string | null {
    if (!rawInput || rawInput[0] !== "{") return null;
    try {
        const parsed = JSON.parse(rawInput);
        const topics = Array.isArray(parsed?.intel_by_topic) ? parsed.intel_by_topic : [];
        const firstTopic = topics[0]?.topic;
        if (typeof firstTopic === "string" && firstTopic.trim().length > 0) {
            const extraCount = Math.max(0, topics.length - 1);
            return extraCount > 0 ? `${firstTopic} (+${extraCount} more)` : firstTopic;
        }
    } catch {
        // Ignore parse errors and fallback to id.
    }
    return null;
}

function getIncidentDisplayTitle(incident: Incident): string {
    if (incident.category && incident.category.trim().length > 0) {
        return incident.category;
    }
    const parsedTopicTitle = extractTopicTitleFromRawInput(incident.raw_input);
    if (parsedTopicTitle) return parsedTopicTitle;
    return displayEventId(incident.id);
}

export function SignalFeed({ className }: { className?: string }) {
    const incidents = useSimulationStore(state => state.incidents);
    const time = useSimulationStore(state => state.time);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [mediaUrl, setMediaUrl] = useState<string | null>(null);
    const [mediaType, setMediaType] = useState<"video" | "audio" | "image" | null>(null);
    const [transcriptText, setTranscriptText] = useState<string | null>(null);

    const [analysisExpandedMap, setAnalysisExpandedMap] = useState<Record<string, boolean>>({});
    const [sectionExpanded, setSectionExpanded] = useState({
        processed: true,
        analyzing: false,
        queued: false,
    });
    const [cityExpandedMap, setCityExpandedMap] = useState<Record<string, boolean>>({});

    // Live injection state
    const [liveInput, setLiveInput] = useState("");
    const [isInjecting, setIsInjecting] = useState(false);

    const toggleExpand = (id: string) => {
        setExpandedId(expandedId === id ? null : id);
    };

    const toggleAnalysis = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setAnalysisExpandedMap(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const handleNavigate = (e: React.MouseEvent, incident: Incident) => {
        e.stopPropagation();
        if ((incident.location && typeof incident.location.lat === 'number') || incident.manual_trace_required) {
            if (useSimulationStore.getState().setFocusedIncidentId) {
                useSimulationStore.getState().setFocusedIncidentId(incident.id);
            }
        }
    };

    const handleOpenMedia = (e: React.MouseEvent, incident: Incident) => {
        e.stopPropagation();
        const url = incident.raw_input;
        if (incident.type === "VIDEO") setMediaType("video");
        else if (incident.type === "AUDIO") setMediaType("audio");
        else setMediaType("image");
        setMediaUrl(url);
    };

    const toggleSection = (section: "processed" | "analyzing" | "queued") => {
        setSectionExpanded((prev) => ({ ...prev, [section]: !prev[section] }));
    };

    const toggleCity = (cityKey: string) => {
        setCityExpandedMap((prev) => ({
            ...prev,
            [cityKey]: !(prev[cityKey] ?? true),
        }));
    };

    return (
        <div className={cn("flex flex-col h-full min-h-0", className)}>
            {/* Header */}
            <div className="shrink-0 p-4 border border-zinc-800 rounded-lg bg-gradient-to-r from-zinc-900 to-black flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <span className="font-bold text-sm tracking-widest text-zinc-100 uppercase">CIRO Reported Events</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-zinc-500">LIVE FEED</span>
                    <span className="inline-flex items-center gap-1 text-[9px] font-mono text-cyan-400/90">
                        <span className="w-2 h-2 rounded-full bg-cyan-500" />
                        Intel
                    </span>
                    <span className="inline-flex items-center gap-1 text-[9px] font-mono text-violet-300/90">
                        <span className="w-2 h-2 rounded-full bg-violet-500" />
                        Citizen
                    </span>
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                </div>
            </div>

            {/* Feed List */}
            <div className="flex-1 min-h-0 pt-3 flex flex-col gap-3">
                {incidents.length === 0 && (
                    <div className="flex-1 flex flex-col items-center justify-center h-full text-center py-20 opacity-40 border border-zinc-800 rounded-lg bg-zinc-950/50">
                        <Radio className="w-12 h-12 text-zinc-600 mb-4 animate-pulse" />
                        <span className="text-zinc-500 text-xs font-mono tracking-widest uppercase">Scanning Frequencies...</span>
                    </div>
                )}

                {/* Group incidents by status */}
                {incidents.length > 0 && (() => {
                    // Group incidents by status
                    // Auth Pending incidents are technically "Analysis Paused" but should be shown as active/attention needed
                    const analyzing = incidents.filter(i => i.status === "ANALYZING" || i.auth_status === "PENDING");
                    const pending = incidents.filter(i => i.status === "PENDING" && i.auth_status !== "PENDING");
                    const processed = incidents.filter(i => i.status !== "ANALYZING" && i.status !== "PENDING" && i.auth_status !== "PENDING");

                    // Render a single incident card
                    const renderCard = (incident: Incident) => {
                        const isExpanded = expandedId === incident.id;
                        const isCitizenReport = isUserSubmittedIncident(incident);
                        const styles = isCitizenReport ? USER_SUBMITTED_STYLES : getPriorityStyles(incident.priority);
                        const hasLocation = !!(incident.location && typeof incident.location.lat === 'number' && incident.location.lat !== 0);
                        const dataPacket = getDataPacketDisplay(incident);

                        return (
                            <div
                                key={incident.id}
                                onClick={() => incident.status !== "PENDING" && toggleExpand(incident.id)}
                                className={cn(
                                    "group relative rounded-lg border transition-all duration-300 overflow-hidden",
                                    isExpanded ? "border-white/10 bg-zinc-900/90 shadow-2xl my-2 scale-[1.01]" : `hover:border-white/10 hover:bg-white/[0.02] cursor-pointer ${styles.border} bg-zinc-900/30`,
                                    incident.status === "PENDING" && "opacity-70 cursor-wait",
                                    incident.status === "ANALYZING" && "ring-1 ring-cyan-500/30",
                                    isCitizenReport && !isExpanded && "ring-1 ring-violet-500/25"
                                )}
                            >
                                {/* Source / priority indicator line */}
                                <div className={cn("absolute left-0 top-0 bottom-0 w-1", styles.indicator)} />

                                {/* Card Content */}
                                <div className={cn("pl-4 pr-3 transition-all", isExpanded ? "py-4" : "py-3")}>
                                    {/* CARD HEADER: COMPACT OVERVIEW */}
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-start gap-3 min-w-0 flex-1">
                                            {/* Icon Box */}
                                            <div className={cn(
                                                "w-8 h-8 rounded-md flex shrink-0 items-center justify-center border bg-gradient-to-br from-zinc-800 to-black",
                                                isExpanded ? "border-white/20 text-white" : "border-white/5 text-zinc-500",
                                                isCitizenReport && "border-violet-500/40 text-violet-300 bg-violet-950/40"
                                            )}>
                                                {isCitizenReport ? <Users className="w-3.5 h-3.5" /> : getTypeIcon(incident.type)}
                                            </div>

                                            {/* Main Info */}
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2 mb-0.5">
                                                    <span className={cn(
                                                        "font-mono text-xs font-bold leading-none truncate",
                                                        isExpanded ? "text-white" : "text-zinc-300"
                                                    )}>
                                                        {getIncidentDisplayTitle(incident)}
                                                    </span>
                                                    {isCitizenReport && (
                                                        <span className="text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider font-bold border border-violet-500/40 bg-violet-950/40 text-violet-300">
                                                            Citizen
                                                        </span>
                                                    )}
                                                    {incident.priority && (
                                                        <span className={cn(
                                                            "text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider font-bold border",
                                                            styles.bg, styles.text, styles.border
                                                        )}>
                                                            {incident.priority}
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Preview Text (Closed) or Full ID (Open) */}
                                                {!isExpanded ? (
                                                    <div className="flex items-center gap-1.5 opacity-60">
                                                        <div className="w-1 h-1 rounded-full bg-zinc-500" />
                                                        <p className="text-[10px] text-zinc-400 truncate font-mono max-w-[200px]">
                                                            {dataPacket.content}
                                                        </p>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <div className={cn(
                                                            "border rounded px-2 py-0.5 flex items-center gap-1.5 text-[9px] font-mono",
                                                            dataPacket.isFile
                                                                ? "bg-cyan-950/30 border-cyan-500/20 text-cyan-400/80"
                                                                : "bg-zinc-800/50 border-white/5 text-zinc-400"
                                                        )}>
                                                            {dataPacket.isFile ? (
                                                                incident.type === "AUDIO" ? <Mic className="w-2.5 h-2.5" /> : <Video className="w-2.5 h-2.5" />
                                                            ) : (
                                                                <FileText className="w-2.5 h-2.5 opacity-50" />
                                                            )}
                                                            <span className="opacity-70">{dataPacket.label}:</span>
                                                            <span className={dataPacket.isFile ? "text-cyan-300" : "text-zinc-300 italic"}>
                                                                {dataPacket.content}
                                                            </span>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Right Side Meta */}
                                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                                            <span className="text-[10px] font-mono text-zinc-500 flex items-center gap-1">
                                                <Clock className="w-3 h-3" />
                                                {new Date(incident.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                            {incident.status === "ANALYZING" ? (
                                                <div className="flex items-center gap-1.5">
                                                    <span className="relative flex h-2 w-2">
                                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                                                    </span>
                                                    <span className="text-[9px] font-bold text-cyan-500 tracking-wider">ANALYZING</span>
                                                </div>
                                            ) : incident.status === "PENDING" ? (
                                                <span className="text-[9px] font-bold text-zinc-600 tracking-wider">QUEUED</span>
                                            ) : (
                                                <ChevronDown className={cn("w-4 h-4 text-zinc-600 transition-transform duration-200", isExpanded && "rotate-180")} />
                                            )}
                                        </div>
                                    </div>

                                    {/* CARD BODY: EXPANDED DOSSIER */}
                                    <AnimatePresence>
                                        {isExpanded && (
                                            <motion.div
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: "auto", opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                transition={{ duration: 0.2 }}
                                                className="overflow-hidden"
                                            >
                                                <div className="pt-4 space-y-4">
                                                    {/* 2. PRIMARY ACTIONS GRID */}
                                                    <div className="grid grid-cols-2 gap-2">
                                                        {hasLocation && !incident.manual_trace_required && (
                                                            <button
                                                                onClick={(e) => handleNavigate(e, incident)}
                                                                className="flex items-center justify-center gap-2 bg-zinc-800/50 hover:bg-emerald-900/20 text-zinc-300 hover:text-emerald-400 border border-white/5 hover:border-emerald-500/30 py-2.5 rounded text-[10px] font-bold uppercase tracking-wider transition-all"
                                                            >
                                                                <MapPin className="w-3.5 h-3.5" />
                                                                Locate
                                                            </button>
                                                        )}
                                                        {(dataPacket.isFile || incident.type === "AUDIO" || incident.type === "VIDEO") && (
                                                            <button
                                                                onClick={(e) => handleOpenMedia(e, incident)}
                                                                className="flex items-center justify-center gap-2 bg-zinc-800/50 hover:bg-cyan-900/20 text-zinc-300 hover:text-cyan-400 border border-white/5 hover:border-cyan-500/30 py-2.5 rounded text-[10px] font-bold uppercase tracking-wider transition-all"
                                                            >
                                                                <Play className="w-3.5 h-3.5" />
                                                                Play Media
                                                            </button>
                                                        )}
                                                        {!dataPacket.isFile && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setTranscriptText(summarizeIncidentTranscript(incident));
                                                                }}
                                                                className="flex items-center justify-center gap-2 bg-zinc-800/50 hover:bg-amber-900/20 text-zinc-300 hover:text-amber-400 border border-white/5 hover:border-amber-500/30 py-2.5 rounded text-[10px] font-bold uppercase tracking-wider transition-all"
                                                            >
                                                                <FileText className="w-3.5 h-3.5" />
                                                                View Transcript
                                                            </button>
                                                        )}
                                                    </div>

                                                    {/* 3. LOCATION INTELLIGENCE */}
                                                    {incident.location && (
                                                        <div className="bg-black/40 border border-white/5 rounded p-3 relative overflow-hidden">
                                                            <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                                                                <Target className="w-3 h-3" />
                                                                Target Profile
                                                            </h4>
                                                            <div className="space-y-1">
                                                                <div className="text-xs text-zinc-200 font-medium">
                                                                    {incident.location_ambiguity ? (
                                                                        <span className="text-orange-400 flex items-center gap-1">
                                                                            <AlertTriangle className="w-3 h-3" />
                                                                            Ambiguous Location Data
                                                                        </span>
                                                                    ) : incident.location.address || "Unknown Address"}
                                                                </div>
                                                                <div className="text-[10px] font-mono text-zinc-500">
                                                                    GRID: {incident.location.lat.toFixed(5)}, {incident.location.lng.toFixed(5)}
                                                                </div>
                                                            </div>
                                                            {incident.manual_trace_required && (
                                                                <div className="mt-2 text-[10px] bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-1.5 rounded flex items-center gap-2 w-fit">
                                                                    <AlertCircle className="w-3 h-3" />
                                                                    MANUAL TRACE REQUIRED
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}

                                                    {/* TACTICAL ANALYSIS: Prioritize clean display_reasoning bullets */}
                                                    {(incident.display_reasoning && incident.display_reasoning.length > 0) ? (
                                                        <div className="bg-gradient-to-b from-zinc-900 to-black border border-white/5 rounded p-3">
                                                            <h4 className="text-[10px] font-bold text-cyan-600/80 uppercase tracking-widest mb-2 flex items-center gap-2">
                                                                <Cpu className="w-3 h-3" />
                                                                Tactical Analysis
                                                            </h4>
                                                            <ul className="space-y-1.5 pl-1 border-l-2 border-cyan-900/30">
                                                                {incident.display_reasoning.map((bullet, idx) => (
                                                                    <li key={idx} className="text-[11px] text-zinc-300 font-mono flex items-start gap-2">
                                                                        <span className="text-cyan-500 mt-0.5">•</span>
                                                                        <span>{bullet}</span>
                                                                    </li>
                                                                ))}
                                                            </ul>

                                                            {/* Collapsible Full Analysis (the verbose reasoning_trace) */}
                                                            {incident.reasoning_trace && incident.reasoning_trace.length > 50 && (
                                                                <div className="mt-3 pt-2 border-t border-white/5">
                                                                    <button
                                                                        onClick={(e) => toggleAnalysis(incident.id, e)}
                                                                        className="w-full py-1 flex items-center justify-center gap-2 text-[9px] font-bold text-zinc-500 hover:text-cyan-400 transition-colors uppercase tracking-wider bg-black/20 hover:bg-black/40 rounded"
                                                                    >
                                                                        {analysisExpandedMap[incident.id] ? (
                                                                            <>Hide Full Analysis <ChevronUp className="w-3 h-3" /></>
                                                                        ) : (
                                                                            <>View Full Analysis <ChevronDown className="w-3 h-3" /></>
                                                                        )}
                                                                    </button>
                                                                    <AnimatePresence>
                                                                        {analysisExpandedMap[incident.id] && (
                                                                            <motion.div
                                                                                initial={{ height: 0, opacity: 0 }}
                                                                                animate={{ height: "auto", opacity: 1 }}
                                                                                exit={{ height: 0, opacity: 0 }}
                                                                                transition={{ duration: 0.3 }}
                                                                                className="overflow-hidden"
                                                                            >
                                                                                <div className="mt-2 text-[10px] leading-relaxed text-zinc-500 font-mono whitespace-pre-wrap bg-black/30 rounded p-2 max-h-40 overflow-y-auto">
                                                                                    {incident.reasoning_trace.split('[COMMAND OVERRIDE]:')[0].trim()}
                                                                                </div>
                                                                            </motion.div>
                                                                        )}
                                                                    </AnimatePresence>
                                                                </div>
                                                            )}
                                                        </div>
                                                    ) : incident.reasoning_trace && (() => {
                                                        // Fallback: If no display_reasoning, use the old verbose trace
                                                        const technicalTrace = (incident.reasoning_trace || "").split('[COMMAND OVERRIDE]:')[0].trim();
                                                        const hasTechnicalContent = technicalTrace.length > 0;

                                                        return hasTechnicalContent ? (
                                                            <div className="bg-gradient-to-b from-zinc-900 to-black border border-white/5 rounded p-3">
                                                                <h4 className="text-[10px] font-bold text-cyan-600/80 uppercase tracking-widest mb-2 flex items-center gap-2">
                                                                    <Cpu className="w-3 h-3" />
                                                                    Tactical Analysis
                                                                </h4>
                                                                <div className="relative">
                                                                    <motion.div
                                                                        initial={false}
                                                                        animate={{
                                                                            height: analysisExpandedMap[incident.id] ? "auto" : "4.5rem",
                                                                            maskImage: analysisExpandedMap[incident.id]
                                                                                ? "linear-gradient(to bottom, black 100%, black 100%)"
                                                                                : "linear-gradient(to bottom, black 60%, transparent 100%)",
                                                                        }}
                                                                        transition={{ duration: 0.4, ease: "easeInOut" }}
                                                                        className="text-[11px] leading-relaxed text-zinc-400 font-mono whitespace-pre-wrap pl-1 border-l-2 border-cyan-900/30 overflow-hidden relative"
                                                                    >
                                                                        {technicalTrace}
                                                                    </motion.div>

                                                                    {technicalTrace.length > 200 && (
                                                                        <button
                                                                            onClick={(e) => toggleAnalysis(incident.id, e)}
                                                                            className="w-full mt-2 py-1 flex items-center justify-center gap-2 text-[10px] font-bold text-cyan-500/70 hover:text-cyan-400 transition-colors uppercase tracking-wider bg-black/20 hover:bg-black/40 rounded"
                                                                        >
                                                                            {analysisExpandedMap[incident.id] ? (
                                                                                <>Show Less <ChevronUp className="w-3 h-3" /></>
                                                                            ) : (
                                                                                <>Read Analysis <ChevronDown className="w-3 h-3" /></>
                                                                            )}
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ) : null;
                                                    })()}

                                                    {/* Voice Override Section - separate from main analysis */}
                                                    {incident.reasoning_trace?.includes('[COMMAND OVERRIDE]:') && (
                                                        <div className="bg-gradient-to-r from-amber-950/20 to-black border border-amber-500/30 rounded p-3 relative overflow-hidden animate-in fade-in slide-in-from-top-2 duration-500">
                                                            <div className="absolute top-0 right-0 p-1 opacity-10">
                                                                <Activity className="w-8 h-8 text-amber-500" />
                                                            </div>
                                                            <h4 className="text-[10px] font-bold text-amber-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                                                                <Mic className="w-3 h-3" />
                                                                Override Analysis
                                                            </h4>
                                                            <div className="text-[11px] leading-relaxed text-zinc-300 font-mono pl-1 border-l-2 border-amber-500/50">
                                                                {incident.reasoning_trace.split('[COMMAND OVERRIDE]:')[1].trim()}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* 5. ASSET ALLOCATION */}
                                                    {incident.assigned_assets && incident.assigned_assets.length > 0 && (
                                                        <div className="space-y-2">
                                                            <h4 className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">Deployed Assets</h4>
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {incident.assigned_assets.map(asset => (
                                                                    <span key={asset} className="bg-emerald-950/30 border border-emerald-500/20 text-emerald-400/90 text-[9px] px-2 py-1 rounded font-mono uppercase">
                                                                        {asset}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* 6. PROTOCOL ZERO (Auth) */}
                                                    {incident.requires_human_auth && incident.auth_status === "PENDING" && (
                                                        <div className="mt-2 bg-amber-950/10 border border-amber-500/30 rounded p-3 animate-pulse-slow">
                                                            <div className="flex items-center gap-2 text-amber-500 mb-2">
                                                                <Shield className="w-3.5 h-3.5" />
                                                                <span className="text-[10px] font-bold uppercase tracking-widest">Authorization Required</span>
                                                            </div>
                                                            <div className="flex gap-2">
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        useSimulationStore.getState().updateIncident(incident.id, {
                                                                            auth_status: "DENIED",
                                                                            status: "RESOLVED",
                                                                            reasoning_trace: (incident.reasoning_trace || "") + " [DENIED BY HUMAN OPERATOR]"
                                                                        });
                                                                    }}
                                                                    className="flex-1 bg-black hover:bg-red-950/30 border border-amber-500/20 hover:border-red-500/50 text-amber-500 hover:text-red-400 py-1.5 rounded text-[10px] uppercase font-bold transition-colors"
                                                                >
                                                                    Deny
                                                                </button>
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        useSimulationStore.getState().updateIncident(incident.id, {
                                                                            auth_status: "APPROVED",
                                                                            reasoning_trace: (incident.reasoning_trace || "") + " [AUTHORIZED BY HUMAN OPERATOR]"
                                                                        });
                                                                    }}
                                                                    className="flex-1 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 hover:border-amber-500/50 text-amber-500 py-1.5 rounded text-[10px] uppercase font-bold transition-colors"
                                                                >
                                                                    Authorize
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </div>
                        );
                    };

                    const renderGroupedCards = (items: Incident[], reverse = false, groupKey = "default") => {
                        const orderedItems = reverse ? [...items].reverse() : items;
                        const cityAreaMap = new Map<string, Map<string, Incident[]>>();

                        for (const incident of orderedItems) {
                            const { city, area } = extractCityArea(incident);
                            if (!cityAreaMap.has(city)) {
                                cityAreaMap.set(city, new Map<string, Incident[]>());
                            }
                            const areaMap = cityAreaMap.get(city)!;
                            if (!areaMap.has(area)) {
                                areaMap.set(area, []);
                            }
                            areaMap.get(area)!.push(incident);
                        }

                        return Array.from(cityAreaMap.entries()).map(([city, areaMap]) => {
                            const cityKey = `${groupKey}:${city}`;
                            const isCityExpanded = cityExpandedMap[cityKey] ?? true;
                            return (
                            <div key={city} className="space-y-2">
                                <button
                                    onClick={() => toggleCity(cityKey)}
                                    className="w-full px-2 py-1 rounded border border-blue-500/20 bg-blue-950/15 hover:bg-blue-950/25 transition-colors flex items-center justify-between"
                                >
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-blue-300">
                                        {city}
                                    </span>
                                    {isCityExpanded ? (
                                        <ChevronUp className="w-3 h-3 text-blue-300/80" />
                                    ) : (
                                        <ChevronDown className="w-3 h-3 text-blue-300/80" />
                                    )}
                                </button>
                                {isCityExpanded && Array.from(areaMap.entries()).map(([area, groupedIncidents]) => (
                                    <div key={`${city}-${area}`} className="space-y-2 pl-2 border-l border-white/10">
                                        <div className="px-2 py-1 rounded border border-zinc-700/60 bg-zinc-900/50">
                                            <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-300">
                                                {area}
                                            </span>
                                        </div>
                                        <div className="space-y-2">
                                            {groupedIncidents.map(renderCard)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )});
                    };

                    return (
                        <>
                            {/* Processed Frame */}
                            <div className={cn(
                                "min-h-0 flex flex-col border border-emerald-500/20 rounded-lg bg-emerald-950/10 p-2",
                                sectionExpanded.processed ? "flex-1" : "shrink-0"
                            )}>
                                <button
                                    onClick={() => toggleSection("processed")}
                                    className="shrink-0 w-full flex items-center justify-between px-2.5 py-2 rounded bg-emerald-500/20 hover:bg-emerald-500/25 transition-colors"
                                >
                                    <div className="flex items-center gap-2">
                                        <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                                        <span className="text-[10px] font-bold text-emerald-200 uppercase tracking-widest">Processed</span>
                                        <span className="text-[9px] font-mono text-emerald-100 bg-emerald-600/50 px-1.5 py-0.5 rounded">({processed.length})</span>
                                    </div>
                                    {sectionExpanded.processed ? (
                                        <ChevronUp className="w-3 h-3 text-emerald-200/80" />
                                    ) : (
                                        <ChevronDown className="w-3 h-3 text-emerald-200/80" />
                                    )}
                                </button>
                                {sectionExpanded.processed && (
                                    <div className="flex-1 min-h-0 mt-2 space-y-2 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
                                        {processed.length > 0 ? renderGroupedCards(processed, true, "processed") : (
                                            <div className="text-[10px] text-zinc-600 font-mono px-2 py-2">No processed incidents.</div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Analyzing Frame */}
                            <div className={cn(
                                "min-h-0 flex flex-col border border-cyan-500/20 rounded-lg bg-cyan-950/10 p-2",
                                sectionExpanded.analyzing ? "flex-1" : "shrink-0"
                            )}>
                                <button
                                    onClick={() => toggleSection("analyzing")}
                                    className="shrink-0 w-full flex items-center justify-between px-2.5 py-2 rounded bg-cyan-500/20 hover:bg-cyan-500/25 transition-colors"
                                >
                                    <div className="flex items-center gap-2">
                                        <div className="relative">
                                            <div className="w-2 h-2 rounded-full bg-cyan-500" />
                                            <div className="absolute inset-0 w-2 h-2 rounded-full bg-cyan-500 animate-ping" />
                                        </div>
                                        <span className="text-[10px] font-bold text-cyan-100 uppercase tracking-widest">Analyzing</span>
                                        <span className="text-[9px] font-mono text-cyan-100 bg-cyan-600/50 px-1.5 py-0.5 rounded">({analyzing.length})</span>
                                    </div>
                                    {sectionExpanded.analyzing ? (
                                        <ChevronUp className="w-3 h-3 text-cyan-100/80" />
                                    ) : (
                                        <ChevronDown className="w-3 h-3 text-cyan-100/80" />
                                    )}
                                </button>
                                {sectionExpanded.analyzing && (
                                    <div className="flex-1 min-h-0 mt-2 space-y-2 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
                                        {analyzing.length > 0 ? renderGroupedCards(analyzing, false, "analyzing") : (
                                            <div className="text-[10px] text-zinc-600 font-mono px-2 py-2">No incidents currently analyzing.</div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Queued Frame */}
                            <div className={cn(
                                "min-h-0 flex flex-col border border-zinc-700/70 rounded-lg bg-zinc-900/40 p-2",
                                sectionExpanded.queued ? "flex-1" : "shrink-0"
                            )}>
                                <button
                                    onClick={() => toggleSection("queued")}
                                    className="shrink-0 w-full flex items-center justify-between px-2.5 py-2 rounded bg-zinc-700/35 hover:bg-zinc-700/50 transition-colors"
                                >
                                    <div className="flex items-center gap-2">
                                        <Clock className="w-3 h-3 text-zinc-500" />
                                        <span className="text-[10px] font-bold text-zinc-200 uppercase tracking-widest">Queued</span>
                                        <span className="text-[9px] font-mono text-zinc-100 bg-zinc-600/60 px-1.5 py-0.5 rounded">({pending.length})</span>
                                    </div>
                                    {sectionExpanded.queued ? (
                                        <ChevronUp className="w-3 h-3 text-zinc-200/80" />
                                    ) : (
                                        <ChevronDown className="w-3 h-3 text-zinc-200/80" />
                                    )}
                                </button>
                                {sectionExpanded.queued && (
                                    <div className="flex-1 min-h-0 mt-2 space-y-2 overflow-y-auto pr-1 opacity-80 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
                                        {pending.length > 0 ? renderGroupedCards(pending, false, "queued") : (
                                            <div className="text-[10px] text-zinc-600 font-mono px-2 py-2">No queued incidents.</div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </>
                    );
                })()}
            </div>

            {/* Media Overlay */}
            {mediaUrl && (
                <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur flex items-center justify-center p-4">
                    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-1 w-full max-w-2xl shadow-2xl">
                        <div className="flex justify-between items-center px-3 py-2 border-b border-white/5 mb-2 bg-black/20">
                            <span className="text-xs font-mono text-zinc-400 flex items-center gap-2">
                                {mediaType === 'video' ? <Video className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
                                MEDIA PLAYBACK
                            </span>
                            <button onClick={() => setMediaUrl(null)} className="text-zinc-500 hover:text-white">&times;</button>
                        </div>
                        <div className="p-2">
                            {mediaType === "video" ? (
                                <video controls autoPlay className="w-full rounded bg-black aspect-video">
                                    <source src={mediaUrl} />
                                </video>
                            ) : (
                                <div className="p-8 bg-zinc-950 rounded flex flex-col items-center gap-4">
                                    <div className="w-20 h-20 bg-zinc-900 rounded-full flex items-center justify-center">
                                        <Mic className="w-8 h-8 text-emerald-500 animate-pulse" />
                                    </div>
                                    <audio controls autoPlay className="w-full" src={mediaUrl} />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Transcript Overlay */}
            {transcriptText && (
                <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur flex items-center justify-center p-4">
                    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-1 w-full max-w-2xl shadow-2xl">
                        <div className="flex justify-between items-center px-3 py-2 border-b border-white/5 mb-2 bg-black/20">
                            <span className="text-xs font-mono text-amber-400 flex items-center gap-2">
                                <FileText className="w-3 h-3" />
                                RAW TRANSCRIPT
                            </span>
                            <button onClick={() => setTranscriptText(null)} className="text-zinc-500 hover:text-white text-xl">&times;</button>
                        </div>
                        <div className="p-4">
                            <div className="bg-black/50 border border-white/5 rounded-lg p-4 max-h-[60vh] overflow-y-auto">
                                <p className="text-sm text-zinc-300 font-mono leading-relaxed whitespace-pre-wrap">
                                    {transcriptText}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
