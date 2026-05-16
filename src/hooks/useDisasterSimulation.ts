import { useEffect, useRef, useCallback } from "react";
import { useSimulationStore } from "@/lib/store";
import pakistanAreaTopics from "@/seed/pakistan_city_area_topics.json";
import { coordinateIncident } from "@/agents/coordinator";
import { MODELS } from "@/lib/constants";
import { type Incident } from "@/lib/types";

// Worker Pool Configuration
const MAX_CONCURRENT_WORKERS = 1;

// Throttle interval for streaming updates (ms) - prevents UI glitches from rapid updates
const STREAM_UPDATE_THROTTLE_MS = 50;
const AREA_PROCESSING_DELAY_MS = 1500;
const INTEL_API_DELAY_MS = Math.max(0, Number(process.env.NEXT_PUBLIC_INTEL_API_DELAY_MS || 1200));
const WEATHER_API_DELAY_MS = Math.max(0, Number(process.env.NEXT_PUBLIC_WEATHER_API_DELAY_MS || 1200));
const GEMINI_API_DELAY_MS = Math.max(0, Number(process.env.NEXT_PUBLIC_GEMINI_API_DELAY_MS || 2500));
const GEMINI_MAX_RPM = Math.max(1, Math.min(4, Number(process.env.NEXT_PUBLIC_GEMINI_MAX_RPM || 4)));
const GEMINI_MIN_INTERVAL_MS = Math.max(
    15000, // hard floor for free-tier safety
    Math.ceil(60000 / GEMINI_MAX_RPM)
);

type AreaTopicConfig = {
    name: string;
    lat: number;
    lng: number;
    topics: Array<string | { topic: string; place?: string }>;
};

type CityAreaTopicConfig = {
    city: string;
    areas: AreaTopicConfig[];
};

const cityAreaTopicConfig = pakistanAreaTopics as CityAreaTopicConfig[];

type TopicDescriptor = {
    topic: string;
    place?: string;
};

function buildId(value: string): string {
    return value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/(^-|-$)/g, "").toUpperCase();
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeTopicDescriptor(topic: string | { topic: string; place?: string }): TopicDescriptor {
    if (typeof topic === "string") {
        return { topic };
    }
    return {
        topic: topic.topic,
        place: topic.place,
    };
}

export function useDisasterSimulation() {
    const {
        time,
        isPlaying,
        setIsPlaying,
        incrementTime,
        addIncident,
        updateIncident,
        addLog,
        setIsMissionComplete,
        setRawThinkingProcess,
        rawThinkingProcess
    } = useSimulationStore();

    // Throttled streaming buffer - holds pending content between flushes
    const streamBufferRef = useRef<string>("");
    const streamFlushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastFlushTimeRef = useRef<number>(0);

    // Throttled setter for raw thinking process - prevents UI glitches from rapid streaming
    const throttledSetRawThinkingProcess = useCallback((content: string | null) => {
        // If null, immediately clear (end of stream)
        if (content === null) {
            streamBufferRef.current = "";
            if (streamFlushTimeoutRef.current) {
                clearTimeout(streamFlushTimeoutRef.current);
                streamFlushTimeoutRef.current = null;
            }
            setRawThinkingProcess(null);
            return;
        }

        // Update buffer with new content
        streamBufferRef.current = content;

        const now = Date.now();
        const timeSinceLastFlush = now - lastFlushTimeRef.current;

        // If enough time has passed, flush immediately
        if (timeSinceLastFlush >= STREAM_UPDATE_THROTTLE_MS) {
            lastFlushTimeRef.current = now;
            setRawThinkingProcess(streamBufferRef.current);
            return;
        }

        // Otherwise, schedule a flush if not already scheduled
        if (!streamFlushTimeoutRef.current) {
            streamFlushTimeoutRef.current = setTimeout(() => {
                lastFlushTimeRef.current = Date.now();
                setRawThinkingProcess(streamBufferRef.current);
                streamFlushTimeoutRef.current = null;
            }, STREAM_UPDATE_THROTTLE_MS - timeSinceLastFlush);
        }
    }, [setRawThinkingProcess]);

    // Worker Pool State - tracks how many workers are currently active
    const activeWorkerCountRef = useRef(0);
    // Track which incident IDs are currently being processed to avoid duplicates
    const processingIdsRef = useRef<Set<string>>(new Set());

    // Ref to preserve partial analysis results before abort (for Issue 2 fix)
    const partialResultRef = useRef<any>(null);

    // Master AbortController for all background fetches - allows stopping ALL processing at once
    const masterAbortControllerRef = useRef<AbortController | null>(null);

    // Track handled auths to prevent double-execution
    const handledAuthIds = useRef<Set<string>>(new Set());
    const dynamicEventStreamRef = useRef<Array<Partial<Incident>> | null>(null);
    const dynamicEventLoadInProgressRef = useRef(false);
    const lastGeminiRequestAtRef = useRef(0);

    const waitForGeminiSlot = useCallback(async () => {
        const now = Date.now();
        const elapsed = now - lastGeminiRequestAtRef.current;
        const remaining = GEMINI_MIN_INTERVAL_MS - elapsed;
        if (remaining > 0) {
            await delay(remaining);
        }
        lastGeminiRequestAtRef.current = Date.now();
    }, []);

    const buildDynamicEventStream = useCallback(async (): Promise<Array<Partial<Incident>>> => {
        const events: Array<Partial<Incident>> = [];
        const nowIso = new Date().toISOString();
        const weatherCache = new Map<string, {
            currentFetched: boolean;
            forecastFetched: boolean;
            currentSummary: { condition: string; temp_c: string | number; humidity: string | number; wind_kph: string | number };
            forecastSummary: { day1_condition: string; day1_rain_chance: string | number; day1_precip_mm: string | number };
        }>();
        const placeCache = new Map<string, { lat: number; lng: number; address: string }>();
        const log = (message: string) => {
            useSimulationStore.getState().addLog(`[${useSimulationStore.getState().time}s] ${message}`);
        };

        for (const cityEntry of cityAreaTopicConfig) {
            for (const areaEntry of cityEntry.areas) {
                log(`[AGENTIC-PIPELINE] CITY=${cityEntry.city} | AREA=${areaEntry.name} | TASK=START_AREA_SCAN`);

                // 1) Build per-topic intel payload.
                const topicDescriptors = areaEntry.topics.map(normalizeTopicDescriptor);
                const topicIntelPayload: Array<{
                    topic: string;
                    place?: string;
                    records: Array<{ source: string; headline: string; url?: string; published_at?: string; tags?: string[] }>;
                    fallback?: string;
                }> = [];
                for (let topicIndex = 0; topicIndex < topicDescriptors.length; topicIndex += 1) {
                    const topicDescriptor = topicDescriptors[topicIndex];
                    const topic = topicDescriptor.topic;
                    log(`[AGENTIC-PIPELINE] CITY=${cityEntry.city} | AREA=${areaEntry.name} | TASK=FETCH_NEWS_INTEL | TOPIC="${topic}"`);
                    try {
                        const intelResponse = await fetch("/api/intel/fetch", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                query: topic,
                                city: cityEntry.city,
                                area: areaEntry.name,
                                topic,
                            }),
                        });

                        if (!intelResponse.ok) {
                            let details = "";
                            try {
                                const errorJson = await intelResponse.json();
                                details = errorJson?.error || "";
                            } catch {
                                // Ignore parse failures and fallback to status.
                            }
                            throw new Error(`Intel fetch failed (${intelResponse.status})${details ? `: ${details}` : ""}`);
                        }

                        const intelJson = await intelResponse.json();
                        if (Array.isArray(intelJson?.provider_errors) && intelJson.provider_errors.length > 0) {
                            log(`[AGENTIC-PIPELINE] CITY=${cityEntry.city} | AREA=${areaEntry.name} | TASK=INTEL_PROVIDER_WARNING | DETAIL=${intelJson.provider_errors.join(" || ")}`);
                        }
                        const topRecords = Array.isArray(intelJson?.results) ? intelJson.results.slice(0, 3) : [];
                        topicIntelPayload.push({
                            topic,
                            place: topicDescriptor.place,
                            records: topRecords.map((record: any) => ({
                                source: record?.source || "TOPIC_FEED",
                                headline: record?.title || "Untitled",
                                url: record?.url || undefined,
                                published_at: record?.published_at || undefined,
                                tags: Array.isArray(record?.tags) ? record.tags : undefined,
                            })),
                        });
                    } catch (error: any) {
                        topicIntelPayload.push({
                            topic,
                            place: topicDescriptor.place,
                            records: [],
                            fallback: error?.message || "Unknown error",
                        });
                    }

                    if (INTEL_API_DELAY_MS > 0 && topicIndex < topicDescriptors.length - 1) {
                        log(`[AGENTIC-PIPELINE] CITY=${cityEntry.city} | AREA=${areaEntry.name} | TASK=INTEL_RATE_LIMIT_DELAY_${INTEL_API_DELAY_MS}MS`);
                        await delay(INTEL_API_DELAY_MS);
                    }
                }
                log(`[AGENTIC-PIPELINE] CITY=${cityEntry.city} | AREA=${areaEntry.name} | TASK=DISASTER_INTEL_READY`);

                for (const topicEntry of topicIntelPayload) {
                    const topicName = String(topicEntry.topic || `${areaEntry.name} Incident`);
                    const resolvedPlace = topicEntry.place?.trim() || topicName;
                    const placeQuery = `${resolvedPlace}, ${areaEntry.name}, ${cityEntry.city}, Pakistan`;
                    let eventCoords = {
                        lat: areaEntry.lat,
                        lng: areaEntry.lng,
                        address: `${resolvedPlace}, ${areaEntry.name}, ${cityEntry.city}`,
                    };

                    if (placeCache.has(placeQuery)) {
                        eventCoords = placeCache.get(placeQuery)!;
                    } else {
                        log(`[AGENTIC-PIPELINE] CITY=${cityEntry.city} | AREA=${areaEntry.name} | TASK=RESOLVE_TOPIC_PLACE | PLACE="${resolvedPlace}"`);
                        try {
                            const placeResponse = await fetch(`/api/maps/place-search?query=${encodeURIComponent(placeQuery)}`);
                            if (placeResponse.ok) {
                                const placeJson = await placeResponse.json();
                                eventCoords = {
                                    lat: Number(placeJson?.lat) || areaEntry.lat,
                                    lng: Number(placeJson?.lng) || areaEntry.lng,
                                    address: placeJson?.formatted_address || eventCoords.address,
                                };
                                placeCache.set(placeQuery, eventCoords);
                            }
                        } catch {
                            // Keep area fallback coords.
                        }
                    }

                    const weatherKey = `${eventCoords.lat.toFixed(4)},${eventCoords.lng.toFixed(4)}`;
                    let currentWeatherFetched = false;
                    let forecastWeatherFetched = false;
                    let currentWeatherSummary: { condition: string; temp_c: string | number; humidity: string | number; wind_kph: string | number } = {
                        condition: "Unknown",
                        temp_c: "N/A",
                        humidity: "N/A",
                        wind_kph: "N/A",
                    };
                    let forecastWeatherSummary: { day1_condition: string; day1_rain_chance: string | number; day1_precip_mm: string | number } = {
                        day1_condition: "Unknown",
                        day1_rain_chance: "N/A",
                        day1_precip_mm: "N/A",
                    };

                    if (weatherCache.has(weatherKey)) {
                        const cached = weatherCache.get(weatherKey)!;
                        currentWeatherFetched = cached.currentFetched;
                        forecastWeatherFetched = cached.forecastFetched;
                        currentWeatherSummary = cached.currentSummary;
                        forecastWeatherSummary = cached.forecastSummary;
                    } else {
                        log(`[AGENTIC-PIPELINE] CITY=${cityEntry.city} | AREA=${areaEntry.name} | TASK=FETCH_CURRENT_WEATHER | PLACE="${resolvedPlace}"`);
                        try {
                            const currentResponse = await fetch(`/api/weather/current?lat=${eventCoords.lat}&lng=${eventCoords.lng}`);
                            if (currentResponse.ok) {
                                const currentJson = await currentResponse.json();
                                const current = currentJson?.current;
                                currentWeatherSummary = {
                                    condition: current?.condition || "Unknown",
                                    temp_c: current?.temp_c ?? "N/A",
                                    humidity: current?.humidity ?? "N/A",
                                    wind_kph: current?.wind_kph ?? "N/A",
                                };
                                currentWeatherFetched = true;
                            }
                        } catch {
                            // Non-fatal.
                        }
                        if (WEATHER_API_DELAY_MS > 0) {
                            log(`[AGENTIC-PIPELINE] CITY=${cityEntry.city} | AREA=${areaEntry.name} | TASK=WEATHER_RATE_LIMIT_DELAY_${WEATHER_API_DELAY_MS}MS`);
                            await delay(WEATHER_API_DELAY_MS);
                        }
                        log(`[AGENTIC-PIPELINE] CITY=${cityEntry.city} | AREA=${areaEntry.name} | TASK=FETCH_FORECAST_WEATHER | PLACE="${resolvedPlace}"`);
                        try {
                            const forecastResponse = await fetch(`/api/weather/forecast?lat=${eventCoords.lat}&lng=${eventCoords.lng}&days=3`);
                            if (forecastResponse.ok) {
                                const forecastJson = await forecastResponse.json();
                                const firstDay = Array.isArray(forecastJson?.forecast_days) ? forecastJson.forecast_days[0] : null;
                                forecastWeatherSummary = {
                                    day1_condition: firstDay?.condition || "Unknown",
                                    day1_rain_chance: firstDay?.chance_of_rain ?? "N/A",
                                    day1_precip_mm: firstDay?.totalprecip_mm ?? "N/A",
                                };
                                forecastWeatherFetched = true;
                            }
                        } catch {
                            // Non-fatal.
                        }
                        weatherCache.set(weatherKey, {
                            currentFetched: currentWeatherFetched,
                            forecastFetched: forecastWeatherFetched,
                            currentSummary: currentWeatherSummary,
                            forecastSummary: forecastWeatherSummary,
                        });
                    }

                    const topicSignal = {
                        city: cityEntry.city,
                        area: areaEntry.name,
                        lat: areaEntry.lat,
                        lng: areaEntry.lng,
                        area_location: {
                            lat: areaEntry.lat,
                            lng: areaEntry.lng,
                            address: `${areaEntry.name}, ${cityEntry.city}`,
                        },
                        event_location: {
                            lat: eventCoords.lat,
                            lng: eventCoords.lng,
                            address: eventCoords.address,
                        },
                        place: resolvedPlace,
                        topic: topicName,
                        intel_by_topic: [topicEntry],
                        weather: {
                            current: currentWeatherSummary,
                            forecast_day1: forecastWeatherSummary,
                        },
                    };

                    const sourceTrailSet = new Set<string>();
                    const eventTagSet = new Set<string>();
                    const publishedAtCandidates: number[] = [];
                    const topicText = topicName.toLowerCase();

                    if (topicText.includes("road") || topicText.includes("gridlock") || topicText.includes("closure") || topicText.includes("block")) {
                        eventTagSet.add("roadblockage");
                    }
                    if (topicText.includes("fire") || topicText.includes("blast") || topicText.includes("smoke")) {
                        eventTagSet.add("fireHazard");
                    }
                    if (topicText.includes("flood") || topicText.includes("rainwater") || topicText.includes("monsoon")) {
                        eventTagSet.add("floodRisk");
                    }
                    if (topicText.includes("protest") || topicText.includes("sit-in") || topicText.includes("dharna") || topicText.includes("hartal")) {
                        eventTagSet.add("civilUnrest");
                    }

                    const topicRecords = Array.isArray(topicEntry.records) ? topicEntry.records : [];
                    topicRecords.forEach((record) => {
                        if (record.source) sourceTrailSet.add(String(record.source));
                        if (Array.isArray(record.tags)) {
                            record.tags.forEach((tag) => {
                                if (typeof tag === "string" && tag.trim().length > 0) {
                                    eventTagSet.add(tag.trim());
                                }
                            });
                        }
                        if (typeof record.published_at === "string") {
                            const ts = Date.parse(record.published_at);
                            if (Number.isFinite(ts)) publishedAtCandidates.push(ts);
                        }
                    });

                    if (currentWeatherFetched) sourceTrailSet.add("WEATHER_CURRENT");
                    if (forecastWeatherFetched) sourceTrailSet.add("WEATHER_FORECAST");
                    if (currentWeatherFetched || forecastWeatherFetched) eventTagSet.add("weather");

                    const newsDate = publishedAtCandidates.length > 0
                        ? new Date(Math.max(...publishedAtCandidates)).toISOString()
                        : undefined;

                    events.push({
                        id: `EVT-TOPIC-${buildId(cityEntry.city)}-${buildId(areaEntry.name)}-${buildId(topicName)}`,
                        type: "TEXT",
                        category: topicName,
                        place: resolvedPlace,
                        event_tags: Array.from(eventTagSet),
                        source_trail: Array.from(sourceTrailSet),
                        road_coords: {
                            lat: eventCoords.lat,
                            lng: eventCoords.lng,
                            source: "GOOGLE_PLACE_TEXT_SEARCH",
                        },
                        ai_summary: `Topic signal generated for ${topicName} in ${areaEntry.name}, ${cityEntry.city}.`,
                        scan_datetime: nowIso,
                        news_date: newsDate,
                        raw_input: JSON.stringify(topicSignal, null, 2),
                        timestamp: nowIso,
                        status: "PENDING",
                        location: {
                            lat: eventCoords.lat,
                            lng: eventCoords.lng,
                            address: eventCoords.address,
                        },
                        area_location: {
                            lat: areaEntry.lat,
                            lng: areaEntry.lng,
                            address: `${areaEntry.name}, ${cityEntry.city}`,
                        },
                        mission_context: "[TOPIC SIGNAL] Analyze this single topic with weather context and return structured response.",
                    });
                }
                log(`[AGENTIC-PIPELINE] CITY=${cityEntry.city} | AREA=${areaEntry.name} | TASK=TOPIC_SIGNALS_READY`);

                log(`[AGENTIC-PIPELINE] CITY=${cityEntry.city} | AREA=${areaEntry.name} | TASK=AREA_SCAN_COMPLETE`);
                log(`[AGENTIC-PIPELINE] CITY=${cityEntry.city} | AREA=${areaEntry.name} | TASK=AREA_SLEEP_${AREA_PROCESSING_DELAY_MS}MS`);
                await delay(AREA_PROCESSING_DELAY_MS);
            }
        }

        return events;
    }, []);

    // Cleanup effect: When simulation STOPS, abort all ongoing work and reset refs
    useEffect(() => {
        if (!isPlaying) {
            // Abort all background fetches
            if (masterAbortControllerRef.current) {
                masterAbortControllerRef.current.abort();
                masterAbortControllerRef.current = null;
            }
            // Reset worker tracking refs
            activeWorkerCountRef.current = 0;
            processingIdsRef.current.clear();
            handledAuthIds.current.clear();
            // Clear streaming buffer
            streamBufferRef.current = "";
            if (streamFlushTimeoutRef.current) {
                clearTimeout(streamFlushTimeoutRef.current);
                streamFlushTimeoutRef.current = null;
            }
            dynamicEventStreamRef.current = null;
            dynamicEventLoadInProgressRef.current = false;
        }
    }, [isPlaying]);

    // Build dynamic event stream once when simulation starts.
    useEffect(() => {
        if (!isPlaying) return;
        if (dynamicEventStreamRef.current || dynamicEventLoadInProgressRef.current) return;

        dynamicEventLoadInProgressRef.current = true;
        addLog(`[${time}s] [INTEL] Building live event stream (disaster + current weather + forecast)...`);

        (async () => {
            try {
                const events = await buildDynamicEventStream();
                dynamicEventStreamRef.current = events;
                addLog(`[${useSimulationStore.getState().time}s] [INTEL] Event stream ready: ${dynamicEventStreamRef.current.length} events.`);
            } catch (error: any) {
                dynamicEventStreamRef.current = [];
                addLog(`[${useSimulationStore.getState().time}s] [INTEL] Live stream failed. No fallback seed data is enabled. Reason: ${error?.message || "unknown"}`);
            } finally {
                dynamicEventLoadInProgressRef.current = false;
            }
        })();
    }, [isPlaying, buildDynamicEventStream, addLog, time]);


    // ------------------------------------------------------------------
    // 1. Mission Timer (Always runs, decoupled from processing)
    // ------------------------------------------------------------------
    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (isPlaying) {
            interval = setInterval(() => {
                // In Live Mode, we NEVER pause time for processing. Events spawn and queue up.
                // In Mock Mode, we might pause, but for now, let's keep it fluid.
                incrementTime();
            }, 1000);
        }
        return () => clearInterval(interval);
    }, [isPlaying, incrementTime]);

    // ------------------------------------------------------------------
    // 2. Event Spawner (Adds to PENDING list based on time)
    // ------------------------------------------------------------------
    const SPAWN_INTERVAL = 4; // Seconds between events
    const SPAWN_START_DELAY = 2; // Start after 2s

    useEffect(() => {
        const spawnEvents = () => {
            // Only use dynamic Karachi/Pakistan stream; do not fallback to legacy seed_data.
            if (!dynamicEventStreamRef.current || dynamicEventLoadInProgressRef.current) return;
            const activeEventStream = dynamicEventStreamRef.current;
            if (activeEventStream.length === 0) return;

            // Find events that match the current time based on INDEX
            // Formula: Time = (Index * Interval) + StartDelay
            const events = activeEventStream.filter((_, index) => {
                const triggerTime = (index * SPAWN_INTERVAL) + SPAWN_START_DELAY;
                return triggerTime <= time;
            });

            for (const event of events) {
                // Check if already added to avoid duplicates
                const exists = useSimulationStore.getState().incidents.find(i => i.id === event.id);
                if (exists) continue;

                const incident: Incident = {
                    ...event,

                    status: "PENDING", // Initial state
                    timestamp: new Date().toISOString(),
                    responder_status: "PENDING" // Default responder status
                } as unknown as Incident;

                // Safety Valve - REMOVED: Moved to post-analysis
                // if (incident.requires_human_auth) { ... }

                addLog(`[${time}s] [SYSTEM] Signal Detected: ${incident.id}`);
                addIncident(incident);
            }
        };

        if (isPlaying) spawnEvents();
    }, [time, isPlaying, addIncident, addLog]);


    // Select only what we need for the queue processor to avoid unnecessary re-runs
    const allIncidents = useSimulationStore(state => state.incidents);
    const isMockMode = useSimulationStore(state => state.isMockMode);

    // ------------------------------------------------------------------
    // 3. Queue Processor (SPOTLIGHT PROTOCOL: Parallel Batch Processing)
    // ------------------------------------------------------------------
    useEffect(() => {
        const processQueue = async () => {
            // Check if we should process: must be playing, not at max capacity
            // CRITICAL: Block standard queue if Voice Command is running high-priority work
            const isVoiceProcessing = useSimulationStore.getState().isVoiceProcessing;
            if (!isPlaying || isVoiceProcessing) return;

            // Check if we have available worker slots
            const availableSlots = MAX_CONCURRENT_WORKERS - activeWorkerCountRef.current;
            if (availableSlots <= 0) return;

            // Get the latest state to find pending incidents (exclude already processing)
            const currentIncidents = useSimulationStore.getState().incidents;
            const pendingIncidents = currentIncidents.filter(
                i => i.status === "PENDING" && !processingIdsRef.current.has(i.id)
            );

            if (pendingIncidents.length === 0) return;

            // Take only as many as we have slots for
            const batch = pendingIncidents.slice(0, availableSlots);

            // SPOTLIGHT LOCK: Check if spotlight is already occupied
            const currentSpotlightId = useSimulationStore.getState().spotlightId;

            let heroIncident = null;
            let heroId: string | null = null;

            if (!currentSpotlightId) {
                // Spotlight is FREE -> First incident becomes the Hero (FIFO)
                heroIncident = batch[0];
                heroId = heroIncident.id;
                useSimulationStore.getState().setSpotlightId(heroId);
                addLog(`[${time}s] [WORKER POOL] Processing ${batch.length} signal(s). Hero: ${heroId}. Active: ${activeWorkerCountRef.current + batch.length}/${MAX_CONCURRENT_WORKERS}`);
            } else {
                // Spotlight is BUSY -> ALL new events go to background (no stealing)
                addLog(`[${time}s] [WORKER POOL] Processing ${batch.length} signal(s) in BACKGROUND. (Spotlight held by: ${currentSpotlightId})`);
            }

            // Claim worker slots and track processing IDs BEFORE async work
            activeWorkerCountRef.current += batch.length;
            for (const incident of batch) {
                processingIdsRef.current.add(incident.id);
            }

            // Update processingBatch with ALL currently processing IDs (not just this batch)
            useSimulationStore.getState().setProcessingBatch(Array.from(processingIdsRef.current));

            try {
                // Create a master abort controller for this batch
                masterAbortControllerRef.current = new AbortController();
                const masterSignal = masterAbortControllerRef.current.signal;

                // Mark ALL batch incidents as ANALYZING immediately
                for (const incident of batch) {
                    updateIncident(incident.id, { status: "ANALYZING" });
                }

                // Give the UI a tiny bit of time to reflect the ANALYZING state before heavy AI work
                await new Promise(resolve => setTimeout(resolve, 50));

                // ============================================================
                // REAL-TIME STREAMING AI: Parallel processing with Hero focus
                // ============================================================
                // If we have a hero, everyone else is background. If no hero, EVERYONE is background.
                const backgroundIncidents = batch.filter(inc => inc.id !== heroId);

                const processBackgroundIncident = async (incident: typeof batch[0], abortSignal: AbortSignal) => {
                    try {
                        if (GEMINI_API_DELAY_MS > 0) {
                            await delay(GEMINI_API_DELAY_MS);
                        }
                        await waitForGeminiSlot();
                        const response = await fetch("/api/coordinate/stream", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ ...incident, status: "ANALYZING" }),
                            signal: abortSignal, // Attach abort signal
                        });

                        if (!response.body) throw new Error("No response body");

                        const reader = response.body.getReader();
                        const decoder = new TextDecoder();
                        let buffer = "";
                        let result: any = { ...incident };

                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;

                            buffer += decoder.decode(value, { stream: true });
                            const lines = buffer.split("\n");
                            buffer = lines.pop() || "";

                            for (const line of lines) {
                                if (!line.trim()) continue;
                                try {
                                    const event = JSON.parse(line);
                                    if (event.type === "result") {
                                        result = { ...result, ...event.data };
                                    } else if (event.type === "audit_log") {
                                        useSimulationStore.getState().addAgentAuditLog(event.entry);
                                    }
                                } catch (e) { /* ignore */ }
                            }
                        }

                        // PROTOCOL ZERO CHECK (Background)
                        let authUpdates = {};
                        if (incident.requires_human_auth) {
                            const currentTime = useSimulationStore.getState().time;
                            authUpdates = {
                                auth_status: "PENDING",
                                auth_timeout_at: currentTime + 30
                            };
                            addLog(`[${currentTime}s] [PROTOCOL ZERO] 🛑 PAUSED ${incident.id} for Authorization.`);
                        }

                        updateIncident(incident.id, { ...result, ...authUpdates, status: "TRIAGED" });
                        addLog(`[${time}s] [COORDINATOR] 📋 Background complete: ${incident.id}`);
                    } catch (error: any) {
                        // Silently ignore abort errors - they're expected when stopping
                        if (error.name === "AbortError") {
                            console.log(`[QUEUE] Background incident ${incident.id} aborted`);
                            return;
                        }
                        console.error(`Background incident ${incident.id} error:`, error);
                        updateIncident(incident.id, {
                            status: "TRIAGED",
                            priority: "MEDIUM",
                            reasoning_trace: `Background processing error: ${error.message}`
                        });
                    }
                };

                // Start background processing (don't await - run in parallel)
                const backgroundPromises = backgroundIncidents.map(inc => processBackgroundIncident(inc, masterSignal));

                // Process Hero with full streaming and UI updates (ONLY IF WE HAVE A HERO)
                if (heroIncident) {
                    throttledSetRawThinkingProcess("");

                    // 1. Setup AbortController for Interruption
                    const controller = new AbortController();
                    useSimulationStore.getState().setActiveAbortController(controller);

                    const readerRef = { current: null as ReadableStreamDefaultReader<Uint8Array> | null };

                    // Declare outside try block so it's accessible in catch for abort handling
                    let latestResult = { ...heroIncident, status: "ANALYZING" };

                    try {
                        if (GEMINI_API_DELAY_MS > 0) {
                            await delay(GEMINI_API_DELAY_MS);
                        }
                        await waitForGeminiSlot();
                        const response = await fetch("/api/coordinate/stream", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ ...heroIncident, status: "ANALYZING" }),
                            signal: controller.signal // <--- Bind Signal
                        });

                        if (!response.body) throw new Error("No response body");

                        const reader = response.body.getReader();
                        readerRef.current = reader;
                        const decoder = new TextDecoder();
                        let fullThinking = "";
                        let buffer = "";

                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;

                            buffer += decoder.decode(value, { stream: true });
                            const lines = buffer.split("\n");
                            buffer = lines.pop() || "";

                            for (const line of lines) {
                                if (!line.trim()) continue;
                                try {
                                    const event = JSON.parse(line);
                                    switch (event.type) {
                                        case "thought":
                                            fullThinking += event.content;
                                            throttledSetRawThinkingProcess(fullThinking);
                                            break;
                                        case "agent_info":
                                            useSimulationStore.getState().setActiveAgent(event.agent);
                                            useSimulationStore.getState().setActiveModel(event.model);
                                            break;
                                        case "result":
                                            // Merge the result data
                                            latestResult = { ...latestResult, ...event.data };
                                            break;
                                        case "audit_log":
                                            useSimulationStore.getState().addAgentAuditLog(event.entry);
                                            addLog(`[${time}s] [${event.entry.agent}] ${event.entry.action}`);
                                            break;
                                        case "error":
                                            if (typeof event.message === "string" && event.message.includes("\"code\":429")) {
                                                addLog(`[${time}s] [COORDINATOR] Gemini quota hit (429). Applying fallback triage for ${heroIncident.id}.`);
                                            } else {
                                                console.error("Stream Error:", event.message);
                                            }
                                            latestResult = {
                                                ...latestResult,
                                                reasoning_trace: `Analysis Error: ${event.message}. Falling back to manual triage protocol.`
                                            };
                                            break;
                                    }
                                } catch (e) { /* ignore */ }
                            }
                        }

                        // Normal Completion
                        // Preserve result for potential override merge
                        partialResultRef.current = latestResult;

                        // PROTOCOL ZERO CHECK (Hero)
                        let authUpdates = {};
                        if (heroIncident.requires_human_auth) {
                            const currentTime = useSimulationStore.getState().time;
                            authUpdates = {
                                auth_status: "PENDING",
                                auth_timeout_at: currentTime + 30
                            };
                            addLog(`[${currentTime}s] [PROTOCOL ZERO] 🛑 PAUSED ${heroIncident.id} for Authorization.`);
                        }

                        updateIncident(heroIncident.id, {
                            ...latestResult,
                            ...authUpdates,
                            status: "TRIAGED"
                        });
                        addLog(`[${time}s] [COORDINATOR] 🎯 Hero finalized: ${heroIncident.id}`);

                    } catch (error: any) {
                        if (error.name === "AbortError" || error.message?.includes("aborted")) {
                            // Preserve partial analysis before proceeding (for Issue 2 fix)
                            partialResultRef.current = latestResult;

                            // Check if this was a Context Injection (Same Incident) or Preemption (Different Incident)
                            const freshState = useSimulationStore.getState().incidents.find(i => i.id === heroIncident.id);

                            if (freshState?.transcript_context) {
                                // SAME INCIDENT OVERRIDE -> Proceed to "Deferred Context Injection" block below
                                addLog(`[${time}s] [COORDINATOR] ⚠️ Analysis Interrupted for Context Injection...`);

                                // Show "VOICE INTERPRETER ACTIVE" in ReasoningLog
                                useSimulationStore.getState().setIsVoiceProcessing(true);
                            } else {
                                // PREEMPTION -> Different incident took priority
                                addLog(`[${time}s] [COORDINATOR] ⏸️ Analysis SUSPENDED for Higher Priority Event.`);

                                // Reset this event to PENDING so it gets picked up again later
                                updateIncident(heroIncident.id, { status: "PENDING" });

                                // EXIT here so we don't run the deferred block
                                return;
                            }
                        } else {
                            throw error; // Re-throw real errors to be caught by outer catch
                        }
                    } finally {
                        useSimulationStore.getState().setActiveAbortController(null);
                    }

                    // ============================================================
                    // DEFERRED CONTEXT INJECTION (Runs even if Aborted!)
                    // ============================================================
                    const freshIncident = useSimulationStore.getState().incidents.find(i => i.id === heroIncident.id);
                    if (freshIncident?.transcript_context) {
                        addLog(`[${time}s] [COORDINATOR] 🗣️ User context detected. Running Override Pass...`);
                        throttledSetRawThinkingProcess(""); // Reset for new pass

                        try {
                            // Run a SECOND analysis pass with the user's context
                            if (GEMINI_API_DELAY_MS > 0) {
                                await delay(GEMINI_API_DELAY_MS);
                            }
                            await waitForGeminiSlot();
                            const overrideResponse = await fetch("/api/coordinate/stream", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    ...freshIncident,
                                    // FORCE ORIGINAL TYPE to ensure Coordinator routes correctly
                                    type: heroIncident.type,
                                    command_intent: freshIncident.transcript_context,
                                    mission_context: freshIncident.mission_context + `\n[USER CONTEXT]: ${freshIncident.transcript_context}`,
                                    status: "ANALYZING"
                                }),
                            });

                            if (overrideResponse.body) {
                                const overrideReader = overrideResponse.body.getReader();
                                const overrideDecoder = new TextDecoder();
                                let overrideBuffer = "";
                                let overrideResult: any = {};
                                let overrideThinking = "";

                                while (true) {
                                    const { done, value } = await overrideReader.read();
                                    if (done) break;

                                    overrideBuffer += overrideDecoder.decode(value, { stream: true });
                                    const lines = overrideBuffer.split("\n");
                                    overrideBuffer = lines.pop() || "";

                                    for (const line of lines) {
                                        if (!line.trim()) continue;
                                        try {
                                            const event = JSON.parse(line);
                                            switch (event.type) {
                                                case "thought":
                                                    overrideThinking += event.content;
                                                    throttledSetRawThinkingProcess(overrideThinking);
                                                    break;
                                                case "agent_info":
                                                    useSimulationStore.getState().setActiveAgent(event.agent);
                                                    useSimulationStore.getState().setActiveModel(event.model);
                                                    break;
                                                case "result":
                                                    overrideResult = event.data;
                                                    break;
                                                case "audit_log":
                                                    useSimulationStore.getState().addAgentAuditLog(event.entry);
                                                    addLog(`[${time}s] [${event.entry.agent}] ${event.entry.action}`);
                                                    break;
                                            }
                                        } catch (e) { /* ignore */ }
                                    }
                                }

                                // MERGE override result with original analysis
                                const preservedAnalysis = partialResultRef.current;
                                const cleanOriginalTrace = (preservedAnalysis?.reasoning_trace || freshIncident.reasoning_trace || "").trim();

                                // Merge Assets - use preserved data if available
                                const mergedAssets = Array.from(new Set([
                                    ...(preservedAnalysis?.assigned_assets || freshIncident.assigned_assets || []),
                                    ...(overrideResult.assigned_assets || []).filter((a: string) => a !== "SYSTEM_UPDATE")
                                ]));

                                updateIncident(heroIncident.id, {
                                    ...preservedAnalysis,
                                    ...freshIncident,
                                    ...overrideResult,
                                    reasoning_trace: `${cleanOriginalTrace}\n\n[COMMAND OVERRIDE]: ${overrideResult.command_intent || "Executed"}\n${overrideResult.reasoning_trace || ""}`.trim(),
                                    assigned_assets: mergedAssets,
                                    status: overrideResult.status || "TRIAGED",
                                    transcript_context: undefined
                                });
                                addLog(`[${time}s] [COORDINATOR] ✓ Override merged for ${heroIncident.id}`);
                            }
                        } catch (overrideError: any) {
                            console.error("Override pass failed:", overrideError);
                            addLog(`[${time}s] [COORDINATOR] ⚠️ Override pass failed: ${overrideError.message}`);
                            updateIncident(heroIncident.id, { status: "TRIAGED" });
                        } finally {
                            throttledSetRawThinkingProcess(null);
                            useSimulationStore.getState().setIsVoiceProcessing(false);
                            partialResultRef.current = null;
                        }
                    }
                }


                // HERO COMPLETE: Processing finished
                // Spotlight release moved to finally block to ensure atomic UI updates
                // HERO COMPLETE: Processing finished
                throttledSetRawThinkingProcess(null);
                useSimulationStore.getState().setActiveAgent(null);
                useSimulationStore.getState().setActiveModel(null);

                // CRITICAL FIX: Release Spotlight IMMEDIATELY so Auth Card can appear
                // Do not wait for background workers
                if (heroIncident) {
                    useSimulationStore.getState().setSpotlightId(null);
                }

                // Wait for all background incidents to complete
                await Promise.all(backgroundPromises);
            } catch (error: any) {
                console.error("[QUEUE] Critical error:", error);
                // Mark all batch incidents as errored
                for (const incident of batch) {
                    updateIncident(incident.id, {
                        status: "TRIAGED",
                        priority: "HIGH",
                        reasoning_trace: `Error: ${error.message || "Unknown processing error"}. Signal flagged for manual review.`
                    });
                }
            } finally {
                // Release worker slots and clear processing IDs
                activeWorkerCountRef.current -= batch.length;
                for (const incident of batch) {
                    processingIdsRef.current.delete(incident.id);
                }

                // Update UI batch to reflect remaining processing
                // CRITICAL: Update this BEFORE clearing spotlight so UI doesn't see [Spotlight=null, Batch=HeroID]
                const remainingBatch = Array.from(processingIdsRef.current);
                useSimulationStore.getState().setProcessingBatch(remainingBatch);

                // Note: Spotlight release moved up to ensure responsiveness
            }
        };

        processQueue();
    }, [time, isPlaying, allIncidents, isMockMode, updateIncident, addLog, throttledSetRawThinkingProcess, waitForGeminiSlot]);


    // PROTOCOL ZERO: Executor (Handles BOTH Manual and Auto-Approvals)
    useEffect(() => {
        if (!isPlaying) return;

        const processApprovals = async () => {
            const decidedIncidents = useSimulationStore.getState().incidents.filter(
                i => (i.auth_status === "APPROVED" || i.auth_status === "DENIED") && !handledAuthIds.current.has(i.id)
            );

            for (const inc of decidedIncidents) {
                handledAuthIds.current.add(inc.id);
                const isApproved = inc.auth_status === "APPROVED";
                const actionLog = isApproved ? "✅ Authorization Verified" : "🚫 Authorization DENIED";

                addLog(`[${time}s] [PROTOCOL ZERO] ${actionLog} for ${inc.id}. Processing decision...`);

                try {
                    const processed = await coordinateIncident({ ...inc, auth_status: inc.auth_status });
                    updateIncident(inc.id, processed);
                    addLog(`[${time}s] [LOGISTICS] Incident Resolution: ${inc.auth_status}`);
                } catch (e) {
                    console.error("Error resuming decided incident", e);
                }
            }
        };

        processApprovals();
    }, [time, isPlaying, updateIncident, addLog]); // Time dependency ensures periodic check

    // PROTOCOL ZERO: Timeout Monitor
    useEffect(() => {
        if (!isPlaying) return;

        const checkTimeouts = async () => {
            const pendingAuthIncidents = useSimulationStore.getState().incidents.filter(
                i => i.requires_human_auth && i.auth_status === "PENDING" && i.auth_timeout_at
            );

            for (const inc of pendingAuthIncidents) {
                if (inc.auth_timeout_at && time >= inc.auth_timeout_at) {
                    // TIMEOUT REACHED -> FAIL OPEN (AUTO-APPROVE)
                    addLog(`[${time}s] [PROTOCOL ZERO] ⚠️ TIMEOUT on ${inc.id}. AUTO-APPROVING action...`);

                    // Update Local State - Executor Effect will pick this up
                    updateIncident(inc.id, {
                        auth_status: "APPROVED",
                        reasoning_trace: inc.reasoning_trace + " [AUTO-APPROVED BY SYSTEM TIMEOUT]"
                    });
                }
            }
        };

        checkTimeouts();

    }, [time, isPlaying, updateIncident, addLog]);

    // Auto-Stop Logic
    useEffect(() => {
        if (!isPlaying) return;
        if (!dynamicEventStreamRef.current || dynamicEventLoadInProgressRef.current) return;

        // Auto-calculated last event time based on strict index staggering
        // Formula: Time = (Index * Interval) + StartDelay
        const activeEventStream = dynamicEventStreamRef.current;
        const lastIndex = activeEventStream.length - 1;
        const lastEventTime = (lastIndex * SPAWN_INTERVAL) + SPAWN_START_DELAY;

        // Add a buffer to allow for processing/reasoning visualization
        const END_BUFFER = 8;

        const allIncidents = useSimulationStore.getState().incidents;

        // Check if any Protocol Zero incidents are still pending - don't stop until they're resolved
        const pendingAuthIncidents = allIncidents.filter(
            i => i.requires_human_auth && i.auth_status === "PENDING"
        );

        // Check if any incidents are still being processed (PENDING or ANALYZING)
        const pendingTriageIncidents = allIncidents.filter(
            i => i.status === "PENDING" || i.status === "ANALYZING"
        );

        // If there are pending auth incidents or pending triage/analysis, don't stop the mission yet
        if (pendingAuthIncidents.length > 0 || pendingTriageIncidents.length > 0) {
            return; // Keep running until all decisions are made and all incidents triaged
        }

        if (time > lastEventTime + END_BUFFER) {
            setIsPlaying(false);
            setIsMissionComplete(true);
            addLog(`[${time}s] Mission Complete. Report Generation Available.`);
        }
    }, [time, isPlaying, setIsPlaying, addLog, setIsMissionComplete]);

    return { time, isPlaying };
}
