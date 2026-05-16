import { NextRequest, NextResponse } from "next/server";
import dataset from "@/seed/pakistan_city_area_topics.json";
import { fetchCurrentWeather, fetchForecastWeather } from "@/lib/weather-layer";

export const runtime = "nodejs";

interface AreaConfig {
    name: string;
    lat: number;
    lng: number;
    topics: string[];
}

interface CityConfig {
    city: string;
    areas: AreaConfig[];
}

function findArea(city: string, area: string): AreaConfig | null {
    const cityEntry = (dataset as CityConfig[]).find(
        (entry) => entry.city.toLowerCase() === city.toLowerCase(),
    );
    if (!cityEntry) return null;

    return cityEntry.areas.find((entry) => entry.name.toLowerCase() === area.toLowerCase()) || null;
}

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const city = searchParams.get("city");
        const area = searchParams.get("area");
        const days = Number(searchParams.get("days") || 3);

        if (!city || !area) {
            return NextResponse.json(
                { error: "Missing required query params: city, area" },
                { status: 400 },
            );
        }

        const areaConfig = findArea(city, area);
        if (!areaConfig) {
            return NextResponse.json(
                { error: `Area not found for city/area: ${city}/${area}` },
                { status: 404 },
            );
        }

        const [current, forecast] = await Promise.all([
            fetchCurrentWeather(areaConfig.lat, areaConfig.lng),
            fetchForecastWeather(areaConfig.lat, areaConfig.lng, days),
        ]);

        return NextResponse.json({
            city,
            area,
            lat: areaConfig.lat,
            lng: areaConfig.lng,
            topics: areaConfig.topics,
            weather: {
                current,
                forecast,
            },
        });
    } catch (error: any) {
        return NextResponse.json(
            { error: error?.message || "Failed to fetch area weather" },
            { status: 500 },
        );
    }
}
