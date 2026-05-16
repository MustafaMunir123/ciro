export interface CurrentWeatherSnapshot {
    location: {
        name: string;
        region: string;
        country: string;
        lat: number;
        lon: number;
        localtime: string;
    };
    current: {
        temp_c: number;
        feelslike_c: number;
        humidity: number;
        wind_kph: number;
        precip_mm: number;
        vis_km: number;
        uv: number;
        condition: string;
        condition_icon?: string;
    };
    raw: unknown;
}

export interface ForecastDaySummary {
    date: string;
    maxtemp_c: number;
    mintemp_c: number;
    avgtemp_c: number;
    maxwind_kph: number;
    totalprecip_mm: number;
    avghumidity: number;
    chance_of_rain: number;
    condition: string;
    condition_icon?: string;
}

export interface ForecastWeatherSnapshot {
    location: {
        name: string;
        region: string;
        country: string;
        lat: number;
        lon: number;
        localtime: string;
    };
    forecast_days: ForecastDaySummary[];
    alerts: unknown[];
    raw: unknown;
}

const WEATHER_API_BASE_URL = "https://api.weatherapi.com/v1";
const WEATHER_API_TLS_INSECURE_FALLBACK = process.env.WEATHER_API_TLS_INSECURE_FALLBACK !== "false";

function parseNumber(value: unknown, fallback = 0): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeLocation(payload: any) {
    const location = payload?.location ?? {};
    return {
        name: String(location.name ?? ""),
        region: String(location.region ?? ""),
        country: String(location.country ?? ""),
        lat: parseNumber(location.lat),
        lon: parseNumber(location.lon),
        localtime: String(location.localtime ?? ""),
    };
}

function buildFallbackLocation(lat: number, lng: number) {
    return {
        name: "",
        region: "",
        country: "",
        lat,
        lon: lng,
        localtime: "",
    };
}

function formatErrorMessage(error: unknown): string {
    if (error && typeof error === "object" && "message" in error && typeof (error as any).message === "string") {
        return (error as any).message;
    }
    return "Unknown weather provider error";
}

function isTlsIssuerError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const err = error as any;
    return (
        err?.code === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" ||
        err?.cause?.code === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"
    );
}

async function fetchWithInsecureTls(url: string): Promise<Response> {
    const https = await import("https");
    return new Promise((resolve, reject) => {
        const req = https.request(url, { method: "GET", rejectUnauthorized: false }, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            res.on("end", () => {
                const body = Buffer.concat(chunks).toString("utf8");
                resolve(
                    new Response(body, {
                        status: res.statusCode || 500,
                        headers: { "content-type": String(res.headers["content-type"] || "application/json") },
                    }),
                );
            });
        });
        req.on("error", reject);
        req.end();
    });
}

async function requestWeather(url: string): Promise<Response> {
    try {
        return await fetch(url, {
            method: "GET",
            cache: "no-store",
        });
    } catch (error: unknown) {
        if (WEATHER_API_TLS_INSECURE_FALLBACK && isTlsIssuerError(error)) {
            return fetchWithInsecureTls(url);
        }
        throw error;
    }
}

export async function fetchCurrentWeather(lat: number, lng: number): Promise<CurrentWeatherSnapshot> {
    const key = process.env.WEATHER_API_KEY;
    if (!key) {
        return {
            location: buildFallbackLocation(lat, lng),
            current: {
                temp_c: 0,
                feelslike_c: 0,
                humidity: 0,
                wind_kph: 0,
                precip_mm: 0,
                vis_km: 0,
                uv: 0,
                condition: "Unavailable (WEATHER_API_KEY missing)",
            },
            raw: { provider_error: "WEATHER_API_KEY is missing" },
        };
    }

    const params = new URLSearchParams({
        key,
        q: `${lat},${lng}`,
        aqi: "yes",
    });

    const requestUrl = `${WEATHER_API_BASE_URL}/current.json?${params.toString()}`;
    let response: Response;
    try {
        response = await requestWeather(requestUrl);
    } catch (error: unknown) {
        return {
            location: buildFallbackLocation(lat, lng),
            current: {
                temp_c: 0,
                feelslike_c: 0,
                humidity: 0,
                wind_kph: 0,
                precip_mm: 0,
                vis_km: 0,
                uv: 0,
                condition: "Unavailable (provider request failed)",
            },
            raw: { provider_error: formatErrorMessage(error) },
        };
    }

    if (!response.ok) {
        const text = await response.text();
        return {
            location: buildFallbackLocation(lat, lng),
            current: {
                temp_c: 0,
                feelslike_c: 0,
                humidity: 0,
                wind_kph: 0,
                precip_mm: 0,
                vis_km: 0,
                uv: 0,
                condition: `Unavailable (provider status ${response.status})`,
            },
            raw: { provider_error: `Weather current API failed (${response.status}): ${text.substring(0, 200)}` },
        };
    }

    const json: any = await response.json();
    const current = json?.current ?? {};
    const condition = current?.condition ?? {};

    return {
        location: normalizeLocation(json),
        current: {
            temp_c: parseNumber(current.temp_c),
            feelslike_c: parseNumber(current.feelslike_c),
            humidity: parseNumber(current.humidity),
            wind_kph: parseNumber(current.wind_kph),
            precip_mm: parseNumber(current.precip_mm),
            vis_km: parseNumber(current.vis_km),
            uv: parseNumber(current.uv),
            condition: String(condition.text ?? ""),
            condition_icon: condition.icon ? String(condition.icon) : undefined,
        },
        raw: json,
    };
}

export async function fetchForecastWeather(lat: number, lng: number, days = 3): Promise<ForecastWeatherSnapshot> {
    const key = process.env.WEATHER_API_KEY;
    const safeDays = Math.max(1, Math.min(14, days));
    if (!key) {
        return {
            location: buildFallbackLocation(lat, lng),
            forecast_days: [],
            alerts: [],
            raw: { provider_error: "WEATHER_API_KEY is missing" },
        };
    }

    const params = new URLSearchParams({
        key,
        q: `${lat},${lng}`,
        days: String(safeDays),
        aqi: "yes",
        alerts: "yes",
    });

    const requestUrl = `${WEATHER_API_BASE_URL}/forecast.json?${params.toString()}`;
    let response: Response;
    try {
        response = await requestWeather(requestUrl);
    } catch (error: unknown) {
        return {
            location: buildFallbackLocation(lat, lng),
            forecast_days: [],
            alerts: [],
            raw: { provider_error: formatErrorMessage(error) },
        };
    }

    if (!response.ok) {
        const text = await response.text();
        return {
            location: buildFallbackLocation(lat, lng),
            forecast_days: [],
            alerts: [],
            raw: { provider_error: `Weather forecast API failed (${response.status}): ${text.substring(0, 200)}` },
        };
    }

    const json: any = await response.json();
    const forecastDays = Array.isArray(json?.forecast?.forecastday) ? json.forecast.forecastday : [];
    const alerts = Array.isArray(json?.alerts?.alert) ? json.alerts.alert : [];

    return {
        location: normalizeLocation(json),
        forecast_days: forecastDays.map((day: any) => ({
            date: String(day?.date ?? ""),
            maxtemp_c: parseNumber(day?.day?.maxtemp_c),
            mintemp_c: parseNumber(day?.day?.mintemp_c),
            avgtemp_c: parseNumber(day?.day?.avgtemp_c),
            maxwind_kph: parseNumber(day?.day?.maxwind_kph),
            totalprecip_mm: parseNumber(day?.day?.totalprecip_mm),
            avghumidity: parseNumber(day?.day?.avghumidity),
            chance_of_rain: parseNumber(day?.day?.daily_chance_of_rain),
            condition: String(day?.day?.condition?.text ?? ""),
            condition_icon: day?.day?.condition?.icon ? String(day.day.condition.icon) : undefined,
        })),
        alerts,
        raw: json,
    };
}
